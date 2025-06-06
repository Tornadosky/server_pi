// RPM Control Routes Module - Server-side closed-loop RPM control
// This module handles real-time RPM control with sensor feedback on the server

const express = require('express');
const router = express.Router();

// RPM Controller state (server-side)
const rpmControlState = {
    active: false,
    targetRPM: 0,
    currentRPM: 0,
    currentPWM: 0,
    error: 0,
    controlPin: 18,
    sensorNumber: 1,
    gain: 2.0,
    lastPulseCount: 0,
    lastUpdateTime: 0,
    controlInterval: null,
    PULSES_PER_ROTATION: 45, // Based on measurement
    UPDATE_RATE: 100, // Control loop update rate in ms (slower for stability)
    maxPWM: 255,
    minPWM: 0,
    baseKick: 4,       // reduced to just break static friction
    // Two-zone PID controller state
    integralTerm: 0,   // Integral accumulator (I_term)
    lastError: 0,
    satTimer: 0,       // Saturation timer for anti-windup
    // Control improvements
    errorDeadband: 1.0  // widen deadband to ±1 RPM
};

// Socket.IO instance for real-time updates
let io = null;
let sensorRoutes = null;

// Set Socket.IO instance and sensor routes reference
function setSocket(socketInstance) {
    io = socketInstance;
    console.log('🎯 RPM Control: Socket.IO instance set for real-time updates');
}

function setSensorRoutes(sensorRoutesInstance) {
    sensorRoutes = sensorRoutesInstance;
    console.log('🎯 RPM Control: Sensor routes reference set');
}

// Calculate current RPM from sensor data using filtered interrupt-based readings
function calculateCurrentRPM() {
    if (!sensorRoutes || !sensorRoutes.sensorState) {
        return 0;
    }
    
    const sensor = rpmControlState.sensorNumber;
    const sensorData = sensorRoutes.sensorState.activeSensors.get(sensor); // Fixed: use number not string
    
    if (!sensorData || !sensorData.enabled) {
        return 0;
    }
    
    // Use the filtered RPM from interrupt-based calculation - fall back to last valid reading
    if (sensorData.filteredRPM !== undefined && sensorData.filteredRPM > 0) {
        rpmControlState.currentRPM = Math.round(sensorData.filteredRPM * 10) / 10;
    } else if (rpmControlState.currentRPM > 0) {
        // Keep last valid RPM reading instead of falling back to 0
        // This prevents control disruption during brief sensor gaps
    } else {
        // Fallback to old calculation if no filtered RPM available and no previous reading
        const currentPulses = sensorData.pulses || 0;
        const currentTime = Date.now();
        
        if (rpmControlState.lastUpdateTime > 0) {
            const timeDelta = (currentTime - rpmControlState.lastUpdateTime) / 1000;
            const pulseDelta = currentPulses - rpmControlState.lastPulseCount;
            
            if (timeDelta > 0 && pulseDelta >= 0) {
                const pulsesPerSecond = pulseDelta / timeDelta;
                const rotationsPerSecond = pulsesPerSecond / rpmControlState.PULSES_PER_ROTATION;
                const instantRPM = rotationsPerSecond * 60;
                rpmControlState.currentRPM = Math.round(instantRPM * 10) / 10;
            }
        }
        
        rpmControlState.lastPulseCount = currentPulses;
        rpmControlState.lastUpdateTime = currentTime;
    }
    
    console.log(`🔍 [calculateCurrentRPM] sensor #${rpmControlState.sensorNumber} → rawPulses=${sensorData ? sensorData.pulses : 0}, filteredRPM=${sensorData ? (sensorData.filteredRPM ?? 0).toFixed(1) : 0}, currentRPM=${rpmControlState.currentRPM.toFixed(1)}`);
    return rpmControlState.currentRPM;
}

// Two-zone PID Controller with feed-forward start torque
function updateRPMController() {
    if (!rpmControlState.active) return;
    
    // Calculate current RPM from sensor data
    const currentRPM = calculateCurrentRPM();
    const sd = sensorRoutes.sensorState.activeSensors.get(rpmControlState.sensorNumber) || {};
    console.log(`🔍 [PID Loop] target=${rpmControlState.targetRPM}, rawCurrentRPM=${currentRPM.toFixed(1)}, rawPulses=${sd.pulses || 0}, filteredRPM=${(sd.filteredRPM||0).toFixed(1)}`);
    
    // Calculate error
    const error = rpmControlState.targetRPM - currentRPM;
    
    // Apply deadband to reduce oscillation for small errors
    if (Math.abs(error) < rpmControlState.errorDeadband) {
        // Small error - don't adjust PWM, just maintain current output
        rpmControlState.error = Math.round(error * 10) / 10;
        broadcastRPMStatus();
        return;
    }
    
    // Two-zone PID gains based on target RPM
    const LOW_SPEED = 20; // rpm threshold
    const gainsLow  = {kp: 0.35, ki: 0.05, kd: 0};  // remove derivative on very low speed
    const gainsHigh = {kp: 2.5, ki: 0.35, kd: 0.04};  // Aggressive gains for high speed
    const g = (rpmControlState.targetRPM < LOW_SPEED) ? gainsLow : gainsHigh;
    
    // PID calculations with improved integral handling
    const dt = rpmControlState.UPDATE_RATE / 1000; // Convert to seconds
    
    // Proportional term
    const proportional = g.kp * error;
    
    // Integral term with proper scaling and clamping
    rpmControlState.integralTerm += g.ki * error * dt;
    rpmControlState.integralTerm = Math.max(-100, Math.min(100, rpmControlState.integralTerm));
    
    // Derivative term - avoid spike on first iteration
    let derivative = 0;
    if (rpmControlState.lastError !== rpmControlState.targetRPM) {
        derivative = g.kd * (error - rpmControlState.lastError) / dt;
    }
    
    // Absolute‑output PID
    let u = proportional + rpmControlState.integralTerm + derivative;

    // Feed‑forward kick proportional to target RPM
    const kick = rpmControlState.baseKick + 0.15 * rpmControlState.targetRPM;  // lower feed-forward
    if (error > 0 && u < kick) u = kick;

    // ── Dynamic lower clamp ──────────────────────────────────
    // Need to accelerate → guarantee static‑friction break‑away.
    // Need to decelerate (error<0) → allow 0 so wheel can slow.
    const minAllowed = (error > 0) ? kick : rpmControlState.minPWM;

    // Clamp to actuator limits
    u = Math.max(minAllowed, Math.min(rpmControlState.maxPWM, u));
    rpmControlState.currentPWM = Math.round(u);
    
    // Anti‑wind‑up: if PWM has been hard‑clamped for >250 ms, bleed off ITerm
    const saturated =
          rpmControlState.currentPWM === rpmControlState.maxPWM
       || rpmControlState.currentPWM === rpmControlState.minPWM;
    rpmControlState.satTimer = saturated ? (rpmControlState.satTimer ?? 0) + dt : 0;
    if (rpmControlState.satTimer > 0.25) {
        rpmControlState.integralTerm *= 0.7;
    }
    
    // Send PWM command to motor
    console.log(`🔍 [PID OUTPUT] P=${proportional.toFixed(2)}, I=${rpmControlState.integralTerm.toFixed(2)}, D=${derivative.toFixed(2)}, PWM=${rpmControlState.currentPWM}`);
    sendPWMCommand(rpmControlState.controlPin, rpmControlState.currentPWM);
    
    // Update state
    rpmControlState.error = Math.round(error * 10) / 10;
    rpmControlState.lastError = error;
    
    // Broadcast status update to clients
    broadcastRPMStatus();
    
    // Enhanced logging with filteredRPM and final PWM
    if (Math.abs(error) > 1) {
        const sensorData = sensorRoutes.sensorState.activeSensors.get(rpmControlState.sensorNumber);
        const pulseCount = sensorData ? sensorData.pulses : 'N/A';
        const filteredRPM = sensorData ? (sensorData.filteredRPM || 0) : 0;
        const gainZone = (rpmControlState.targetRPM < LOW_SPEED) ? 'LOW' : 'HIGH';
        console.log(`🎯 RPM Control [${gainZone}]: Target=${rpmControlState.targetRPM}, Current=${currentRPM.toFixed(1)}, Filtered=${filteredRPM.toFixed(1)}, Error=${error.toFixed(1)}, PWM=${rpmControlState.currentPWM}, P=${proportional.toFixed(2)}, I=${rpmControlState.integralTerm.toFixed(2)}, D=${derivative.toFixed(2)}, Pulses=${pulseCount}`);
    }
}

// Send PWM command (placeholder - will use PWM routes)
async function sendPWMCommand(pin, dutyCycle) {
    try {
        // This will be integrated with the PWM routes
        // For now, we'll use a direct approach
        const pwmRoutes = require('./pwm-routes');
        if (pwmRoutes.setPWMDirect) {
            await pwmRoutes.setPWMDirect(pin, dutyCycle, 1000);
        }
    } catch (error) {
        console.error(`❌ RPM Control: Failed to set PWM on pin ${pin}:`, error);
    }
}

// Broadcast RPM status to all connected clients
function broadcastRPMStatus() {
    if (io) {
        io.emit('rpmStatus', {
            active: rpmControlState.active,
            targetRPM: rpmControlState.targetRPM,
            currentRPM: rpmControlState.currentRPM,
            currentPWM: rpmControlState.currentPWM,
            error: rpmControlState.error,
            controlPin: rpmControlState.controlPin,
            sensorNumber: rpmControlState.sensorNumber,
            timestamp: Date.now()
        });
    }
}

// Start RPM control
router.post('/start', (req, res) => {
    try {
        const { targetRPM, controlPin, sensorNumber, gain } = req.body;
        
        if (!targetRPM || targetRPM <= 0) {
            return res.status(400).json({
                success: false,
                error: 'Target RPM must be greater than 0'
            });
        }
        
        if (!sensorRoutes || !sensorRoutes.sensorState) {
            return res.status(500).json({
                success: false,
                error: 'Sensor system not available'
            });
        }
        
        // Check if sensor is enabled (use number key to match sensor storage)
        const sensorData = sensorRoutes.sensorState.activeSensors.get(sensorNumber);
        if (!sensorData || !sensorData.enabled) {
            return res.status(400).json({
                success: false,
                error: `Sensor ${sensorNumber} is not enabled. Please enable it first.`
            });
        }
        
        // Stop any existing control
        if (rpmControlState.controlInterval) {
            clearInterval(rpmControlState.controlInterval);
        }
        
        // Update control parameters
        rpmControlState.targetRPM = targetRPM;
        rpmControlState.controlPin = controlPin || 18;
        rpmControlState.sensorNumber = sensorNumber || 1;
        // Note: gain parameter now handled by two-zone system, kept for compatibility
        rpmControlState.active = true;
        
        // Initialize startup PWM with proportional kick
        rpmControlState.currentPWM = rpmControlState.baseKick + 0.15 * targetRPM;  // match reduced kick
        rpmControlState.lastPulseCount = sensorData.pulses || 0;
        rpmControlState.lastUpdateTime = Date.now();
        rpmControlState.integralTerm = 0; // Reset integral accumulator
        rpmControlState.lastError = targetRPM; // Initialize to target to prevent derivative spike
        rpmControlState.satTimer = 0;     // Reset saturation timer
        
        // Reset sensor RPM filter to avoid stale readings
        if (sensorRoutes.sensorState.rpmFilters) {
            sensorRoutes.sensorState.rpmFilters.set(sensorData.pin, 0);
        }
        
        // Start control loop
        rpmControlState.controlInterval = setInterval(updateRPMController, rpmControlState.UPDATE_RATE);
        
        console.log(`🎯 RPM Control Started: Target=${targetRPM} RPM, Pin=GPIO ${rpmControlState.controlPin}, Sensor=${sensorNumber}, Gain=${gain}`);
        
        // Broadcast initial status
        broadcastRPMStatus();
        
        res.json({
            success: true,
            message: `RPM control started: ${targetRPM} RPM on GPIO ${rpmControlState.controlPin}`,
            controlState: {
                targetRPM: rpmControlState.targetRPM,
                controlPin: rpmControlState.controlPin,
                sensorNumber: rpmControlState.sensorNumber,
                gainZone: (targetRPM < 20) ? 'LOW_SPEED' : 'HIGH_SPEED',
                baseKick: rpmControlState.baseKick,
                updateRate: rpmControlState.UPDATE_RATE
            }
        });
        
    } catch (error) {
        console.error('RPM control start error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to start RPM control'
        });
    }
});

// Stop RPM control
router.post('/stop', (req, res) => {
    try {
        rpmControlState.active = false;
        
        if (rpmControlState.controlInterval) {
            clearInterval(rpmControlState.controlInterval);
            rpmControlState.controlInterval = null;
        }
        
        // Stop motor
        sendPWMCommand(rpmControlState.controlPin, 0);
        rpmControlState.currentPWM = 0;
        rpmControlState.integralTerm = 0;
        rpmControlState.lastError = 0;
        rpmControlState.satTimer = 0;
        
        console.log('🎯 RPM Control Stopped');
        
        // Broadcast final status
        broadcastRPMStatus();
        
        res.json({
            success: true,
            message: 'RPM control stopped'
        });
        
    } catch (error) {
        console.error('RPM control stop error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to stop RPM control'
        });
    }
});

// Update RPM target
router.post('/set-rpm', (req, res) => {
    try {
        const { targetRPM } = req.body;
        
        if (!targetRPM || targetRPM < 0) {
            return res.status(400).json({
                success: false,
                error: 'Invalid target RPM'
            });
        }
        
        rpmControlState.targetRPM = targetRPM;
        
        if (targetRPM === 0 && rpmControlState.active) {
            // Stop control if RPM set to 0
            rpmControlState.active = false;
            if (rpmControlState.controlInterval) {
                clearInterval(rpmControlState.controlInterval);
                rpmControlState.controlInterval = null;
            }
            sendPWMCommand(rpmControlState.controlPin, 0);
            rpmControlState.currentPWM = 0;
        }
        
        console.log(`🎯 RPM Target updated: ${targetRPM} RPM`);
        
        // Broadcast updated status
        broadcastRPMStatus();
        
        res.json({
            success: true,
            message: `Target RPM updated to ${targetRPM}`,
            targetRPM: targetRPM
        });
        
    } catch (error) {
        console.error('RPM set error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to set target RPM'
        });
    }
});

// Update control parameters
router.post('/set-params', (req, res) => {
    try {
        const { gain, controlPin, sensorNumber } = req.body;
        
        // Note: Individual gain parameter deprecated in favor of two-zone system
        
        if (controlPin !== undefined) {
            rpmControlState.controlPin = controlPin;
        }
        
        if (sensorNumber !== undefined) {
            rpmControlState.sensorNumber = sensorNumber;
        }
        
        console.log(`🎯 RPM Control parameters updated: Pin=${rpmControlState.controlPin}, Sensor=${rpmControlState.sensorNumber}`);
        
        // Broadcast updated status
        broadcastRPMStatus();
        
        res.json({
            success: true,
            message: 'Control parameters updated',
            parameters: {
                controlPin: rpmControlState.controlPin,
                sensorNumber: rpmControlState.sensorNumber,
                baseKick: rpmControlState.baseKick
            }
        });
        
    } catch (error) {
        console.error('RPM params update error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to update control parameters'
        });
    }
});

// Get RPM control status
router.get('/status', (req, res) => {
    try {
        res.json({
            success: true,
            rpmControl: {
                active: rpmControlState.active,
                targetRPM: rpmControlState.targetRPM,
                currentRPM: rpmControlState.currentRPM,
                currentPWM: rpmControlState.currentPWM,
                error: rpmControlState.error,
                controlPin: rpmControlState.controlPin,
                sensorNumber: rpmControlState.sensorNumber,
                baseKick: rpmControlState.baseKick,
                updateRate: rpmControlState.UPDATE_RATE,
                pulsesPerRotation: rpmControlState.PULSES_PER_ROTATION,
                gainZones: {
                    lowSpeed: { threshold: 20, kp: 0.35, ki: 0.05, kd: 0 },
                    highSpeed: { threshold: 20, kp: 2.5, ki: 0.35, kd: 0.04 }
                }
            }
        });
        
    } catch (error) {
        console.error('RPM status error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to get RPM control status'
        });
    }
});

// Cleanup function for graceful shutdown
function cleanup() {
    console.log('🎯 Cleaning up RPM control...');
    
    if (rpmControlState.controlInterval) {
        clearInterval(rpmControlState.controlInterval);
        rpmControlState.controlInterval = null;
    }
    
    rpmControlState.active = false;
    rpmControlState.currentPWM = 0;
    rpmControlState.integralTerm = 0;
    rpmControlState.satTimer = 0;
    
    console.log('✅ RPM control cleanup completed');
}

module.exports = {
    router,
    setSocket,
    setSensorRoutes,
    cleanup,
    rpmControlState
}; 