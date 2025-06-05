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
    minRunningPWM: 40, // Minimum PWM needed to keep motor running
    startupPWM: 60,    // Initial PWM for startup
    // PID controller state - Optimized for smooth control
    integralError: 0,
    lastError: 0,
    kp: 0.8,   // Reduced proportional gain for smoother response
    ki: 0.02,  // Lower integral gain to prevent windup
    kd: 0.01,  // Minimal derivative gain for stability
    // Control improvements
    errorDeadband: 1.0, // Don't adjust PWM for small errors (±1 RPM)
    rpmHistory: [],     // For smoothing RPM readings
    HISTORY_SIZE: 5,    // Number of RPM readings to average
    outputFilter: 0.0,  // Smoothed PWM output
    filterAlpha: 0.3    // Filter coefficient for PWM smoothing
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

// Calculate current RPM from sensor data with improved smoothing
function calculateCurrentRPM() {
    if (!sensorRoutes || !sensorRoutes.sensorState) {
        return 0;
    }
    
    const sensor = rpmControlState.sensorNumber;
    const sensorData = sensorRoutes.sensorState.activeSensors.get(sensor.toString());
    
    if (!sensorData || !sensorData.enabled) {
        return 0;
    }
    
    const currentPulses = sensorData.pulses || 0;
    const currentTime = Date.now();
    
    // Calculate instantaneous RPM based on pulse rate
    if (rpmControlState.lastUpdateTime > 0) {
        const timeDelta = (currentTime - rpmControlState.lastUpdateTime) / 1000; // seconds
        const pulseDelta = currentPulses - rpmControlState.lastPulseCount;
        
        if (timeDelta > 0 && pulseDelta >= 0) {
            const pulsesPerSecond = pulseDelta / timeDelta;
            const rotationsPerSecond = pulsesPerSecond / rpmControlState.PULSES_PER_ROTATION;
            const instantRPM = rotationsPerSecond * 60;
            
            // Add to history buffer for smoothing
            rpmControlState.rpmHistory.push(instantRPM);
            if (rpmControlState.rpmHistory.length > rpmControlState.HISTORY_SIZE) {
                rpmControlState.rpmHistory.shift(); // Remove oldest reading
            }
            
            // Calculate smoothed RPM using moving average
            const avgRPM = rpmControlState.rpmHistory.reduce((sum, rpm) => sum + rpm, 0) / rpmControlState.rpmHistory.length;
            
            // Apply additional smoothing filter
            const alpha = 0.6; // Filter coefficient (higher = less smoothing)
            rpmControlState.currentRPM = alpha * avgRPM + (1 - alpha) * rpmControlState.currentRPM;
            rpmControlState.currentRPM = Math.round(rpmControlState.currentRPM * 10) / 10; // Round to 1 decimal
        }
    }
    
    rpmControlState.lastPulseCount = currentPulses;
    rpmControlState.lastUpdateTime = currentTime;
    
    return rpmControlState.currentRPM;
}

// Enhanced PID Controller with smooth operation
function updateRPMController() {
    if (!rpmControlState.active) return;
    
    // Calculate current RPM from sensor data
    const currentRPM = calculateCurrentRPM();
    
    // Calculate error
    const error = rpmControlState.targetRPM - currentRPM;
    
    // Apply deadband to reduce oscillation for small errors
    if (Math.abs(error) < rpmControlState.errorDeadband) {
        // Small error - don't adjust PWM, just maintain current output
        rpmControlState.error = Math.round(error * 10) / 10;
        broadcastRPMStatus();
        return;
    }
    
    // PID calculations with improved integral handling
    const dt = rpmControlState.UPDATE_RATE / 1000; // Convert to seconds
    
    // Proportional term
    const proportional = rpmControlState.kp * error;
    
    // Integral term with windup protection
    rpmControlState.integralError += error * dt;
    // Limit integral term to prevent windup
    const maxIntegral = 50; // Maximum integral contribution
    rpmControlState.integralError = Math.max(-maxIntegral, Math.min(maxIntegral, rpmControlState.integralError));
    const integral = rpmControlState.ki * rpmControlState.integralError;
    
    // Derivative term
    const derivative = rpmControlState.kd * (error - rpmControlState.lastError) / dt;
    
    // PID output
    const pidOutput = proportional + integral + derivative;
    
    // Apply PID output to PWM with smooth filtering
    let newPWM = rpmControlState.currentPWM + pidOutput;
    
    // Special handling for startup - ensure minimum torque
    if (rpmControlState.targetRPM > 0 && newPWM < rpmControlState.minRunningPWM) {
        newPWM = rpmControlState.minRunningPWM;
    }
    
    // Clamp PWM to valid range
    newPWM = Math.max(rpmControlState.minPWM, Math.min(rpmControlState.maxPWM, newPWM));
    
    // Apply output filtering for smoother PWM changes
    rpmControlState.outputFilter = rpmControlState.filterAlpha * newPWM + 
                                  (1 - rpmControlState.filterAlpha) * rpmControlState.outputFilter;
    
    rpmControlState.currentPWM = Math.round(rpmControlState.outputFilter);
    
    // Reset integral term if output is saturated (anti-windup)
    if (rpmControlState.currentPWM >= rpmControlState.maxPWM || 
        (rpmControlState.currentPWM <= rpmControlState.minPWM && rpmControlState.targetRPM > 0)) {
        rpmControlState.integralError *= 0.8; // Reduce integral term
    }
    
    // Send PWM command to motor
    sendPWMCommand(rpmControlState.controlPin, rpmControlState.currentPWM);
    
    // Update state
    rpmControlState.error = Math.round(error * 10) / 10;
    rpmControlState.lastError = error;
    
    // Broadcast status update to clients
    broadcastRPMStatus();
    
    // Log control activity (less frequent logging)
    if (Math.abs(error) > 2) {
        console.log(`🎯 RPM Control: Target=${rpmControlState.targetRPM}, Current=${currentRPM.toFixed(1)}, Error=${error.toFixed(1)}, PWM=${rpmControlState.currentPWM}, P=${proportional.toFixed(2)}, I=${integral.toFixed(2)}, D=${derivative.toFixed(2)}`);
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
        
        // Check if sensor is enabled
        const sensorData = sensorRoutes.sensorState.activeSensors.get(sensorNumber.toString());
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
        rpmControlState.kp = gain || 0.8;
        rpmControlState.active = true;
        
        // Smart startup PWM based on target RPM
        if (targetRPM <= 10) {
            rpmControlState.currentPWM = rpmControlState.minRunningPWM; // Low RPM - minimal PWM
        } else if (targetRPM <= 30) {
            rpmControlState.currentPWM = rpmControlState.startupPWM;    // Medium RPM - moderate startup
        } else {
            rpmControlState.currentPWM = Math.min(80, rpmControlState.startupPWM + (targetRPM * 0.3)); // High RPM - higher startup
        }
        
        rpmControlState.outputFilter = rpmControlState.currentPWM; // Initialize filter
        rpmControlState.lastPulseCount = sensorData.pulses || 0;
        rpmControlState.lastUpdateTime = Date.now();
        rpmControlState.integralError = 0; // Reset integral term
        rpmControlState.lastError = 0;
        rpmControlState.rpmHistory = []; // Clear RPM history
        
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
                gain: rpmControlState.kp,
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
        rpmControlState.integralError = 0;
        rpmControlState.lastError = 0;
        
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
        
        if (gain !== undefined) {
            rpmControlState.kp = gain;
        }
        
        if (controlPin !== undefined) {
            rpmControlState.controlPin = controlPin;
        }
        
        if (sensorNumber !== undefined) {
            rpmControlState.sensorNumber = sensorNumber;
        }
        
        console.log(`🎯 RPM Control parameters updated: Gain=${rpmControlState.kp}, Pin=${rpmControlState.controlPin}, Sensor=${rpmControlState.sensorNumber}`);
        
        // Broadcast updated status
        broadcastRPMStatus();
        
        res.json({
            success: true,
            message: 'Control parameters updated',
            parameters: {
                gain: rpmControlState.kp,
                controlPin: rpmControlState.controlPin,
                sensorNumber: rpmControlState.sensorNumber
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
                gain: rpmControlState.kp,
                updateRate: rpmControlState.UPDATE_RATE,
                pulsesPerRotation: rpmControlState.PULSES_PER_ROTATION
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
    
    console.log('✅ RPM control cleanup completed');
}

module.exports = {
    router,
    setSocket,
    setSensorRoutes,
    cleanup,
    rpmControlState
}; 