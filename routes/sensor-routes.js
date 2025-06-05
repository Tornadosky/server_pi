// Sensor Routes Module - Real GPIO input monitoring for wheel encoders
// This module handles reading sensor inputs from wheel encoders using polling

const express = require('express');
const router = express.Router();

// Initialize pigpio for real GPIO monitoring
let Gpio;
let pigpioAvailable = false;

try {
    Gpio = require('pigpio').Gpio;
    pigpioAvailable = true;
    console.log('📡 Sensor routes: pigpio library loaded for real GPIO monitoring');
} catch (error) {
    console.log('📡 Sensor routes: pigpio not available - cannot monitor GPIO inputs');
    console.log('   To enable real GPIO: sudo apt-get install pigpio && sudo systemctl start pigpio');
}

// Global sensor state - tracks all active sensor monitoring
const sensorState = {
    activeSensors: new Map(), // Map of sensor -> { pin, enabled, pulses, rate, lastPulse, gpio, polling }
    pulseCounts: new Map(),   // Map of pin -> pulse count
    pulseRates: new Map(),    // Map of pin -> pulses per second
    lastPulseTimes: new Map(), // Map of pin -> last pulse timestamp
    lastPinStates: new Map(), // Map of pin -> last digital state (for edge detection)
    pollingIntervals: new Map() // Map of pin -> polling interval reference
};

// Socket.IO instance for real-time updates
let io = null;

// Set Socket.IO instance (called from main server)
function setSocket(socketInstance) {
    io = socketInstance;
    console.log('📡 Sensor routes: Socket.IO instance set for real-time sensor updates');
}

// Real GPIO input monitoring using polling (more reliable than interrupts)
function startGPIOMonitoring(pin, sensor) {
    console.log(`📡 Starting real GPIO monitoring for pin ${pin} (Sensor ${sensor})`);
    
    if (!pigpioAvailable) {
        console.log(`❌ pigpio not available, cannot monitor GPIO ${pin}.`);
        return false;
    }
    
    try {
        // Create GPIO instance for input monitoring
        const gpio = new Gpio(pin, {
            mode: Gpio.INPUT,
            pullUpDown: Gpio.PUD_UP // Use internal pull-up resistor
        });
        
        // Initialize pin state tracking
        const initialState = gpio.digitalRead();
        sensorState.lastPinStates.set(pin, initialState);
        
        console.log(`🔧 GPIO ${pin} initialized: Current state = ${initialState}`);
        
        // Start polling for state changes (edge detection)
        const pollingInterval = setInterval(() => {
            if (sensorState.activeSensors.get(sensor)?.enabled) {
                pollGPIOState(pin, sensor, gpio);
            }
        }, 10); // Poll every 10ms for fast response
        
        // Store references for cleanup
        sensorState.pollingIntervals.set(pin, pollingInterval);
        
        // Update sensor state
        if (sensorState.activeSensors.has(sensor)) {
            const sensorData = sensorState.activeSensors.get(sensor);
            sensorData.gpio = gpio;
            sensorData.polling = pollingInterval;
        }
        
        console.log(`✅ Real GPIO monitoring active on pin ${pin} for Sensor ${sensor} (Polling mode, 10ms interval)`);
        return true;
        
    } catch (error) {
        console.error(`❌ Failed to setup GPIO monitoring on pin ${pin}:`, error);
        return false;
    }
}

// Poll GPIO state and detect edges (rising edge = pulse)
function pollGPIOState(pin, sensor, gpio) {
    try {
        const currentState = gpio.digitalRead();
        const lastState = sensorState.lastPinStates.get(pin);
        
        // Detect rising edge (0 -> 1 transition = wheel encoder pulse)
        if (lastState === 0 && currentState === 1) {
            detectRealPulse(pin, sensor);
        }
        
        // Update last state
        sensorState.lastPinStates.set(pin, currentState);
        
    } catch (error) {
        console.error(`❌ Error polling GPIO ${pin}:`, error);
    }
}

function stopGPIOMonitoring(sensor) {
    const sensorData = sensorState.activeSensors.get(sensor);
    if (!sensorData) return;
    
    const pin = sensorData.pin;
    
    // Stop polling
    if (sensorState.pollingIntervals.has(pin)) {
        clearInterval(sensorState.pollingIntervals.get(pin));
        sensorState.pollingIntervals.delete(pin);
        console.log(`📡 Stopped GPIO polling for Sensor ${sensor} (GPIO ${pin})`);
    }
    
    // Clean up GPIO reference (don't terminate, might be used elsewhere)
    if (sensorData.gpio) {
        sensorData.gpio = null;
    }
    
    // Clear state tracking
    sensorState.lastPinStates.delete(pin);
}

// Handle real GPIO pulse detection
function detectRealPulse(pin, sensor) {
    const timestamp = Date.now();
    
    // Increment pulse count
    const currentCount = sensorState.pulseCounts.get(pin) || 0;
    const newCount = currentCount + 1;
    sensorState.pulseCounts.set(pin, newCount);
    
    // Calculate pulse rate (pulses per second)
    const lastTime = sensorState.lastPulseTimes.get(pin);
    let rate = 0;
    
    if (lastTime) {
        const timeDiff = (timestamp - lastTime) / 1000; // Convert to seconds
        if (timeDiff > 0) {
            rate = Math.round(1 / timeDiff); // Pulses per second
        }
    }
    
    sensorState.lastPulseTimes.set(pin, timestamp);
    sensorState.pulseRates.set(pin, rate);
    
    // Update sensor state
    if (sensorState.activeSensors.has(sensor)) {
        const sensorData = sensorState.activeSensors.get(sensor);
        sensorData.pulses = newCount;
        sensorData.rate = rate;
        sensorData.lastPulse = timestamp;
    }
    
    // Broadcast sensor pulse to all WebSocket clients
    if (io) {
        io.emit('sensorPulse', {
            sensor: sensor,
            pin: pin,
            pulses: newCount,
            rate: rate,
            timestamp: timestamp,
            source: 'real_gpio'
        });
    }
    
    console.log(`🔄 REAL PULSE: Sensor ${sensor} (GPIO ${pin}): Pulse #${newCount}, Rate: ${rate}/sec`);
}

// Enable sensor monitoring
router.post('/enable', (req, res) => {
    try {
        const { sensor, pin } = req.body;
        
        if (!sensor || pin === undefined) {
            return res.status(400).json({
                success: false,
                error: 'Missing sensor or pin parameter'
            });
        }
        
        if (!pigpioAvailable) {
            return res.status(500).json({
                success: false,
                error: 'GPIO monitoring not available - pigpio library not loaded'
            });
        }
        
        console.log(`📡 Enabling sensor monitoring: Sensor ${sensor} on GPIO ${pin}`);
        
        // Initialize sensor data
        sensorState.activeSensors.set(sensor, {
            pin: pin,
            enabled: true,
            pulses: 0,
            rate: 0,
            lastPulse: null,
            gpio: null,
            polling: null
        });
        
        // Initialize counters for this pin
        sensorState.pulseCounts.set(pin, 0);
        sensorState.pulseRates.set(pin, 0);
        sensorState.lastPulseTimes.set(pin, null);
        
        // Start GPIO monitoring
        const success = startGPIOMonitoring(pin, sensor);
        
        if (!success) {
            return res.status(500).json({
                success: false,
                error: 'Failed to initialize GPIO monitoring'
            });
        }
        
        // Broadcast sensor state update
        if (io) {
            io.emit('sensorUpdate', {
                message: `Sensor ${sensor} (GPIO ${pin}) enabled - Real GPIO monitoring active`,
                sensor: sensor,
                enabled: true
            });
        }
        
        res.json({
            success: true,
            message: `Sensor ${sensor} monitoring enabled on GPIO ${pin}`,
            sensor: sensor,
            pin: pin,
            mode: 'real_gpio_polling'
        });
        
    } catch (error) {
        console.error('Sensor enable error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to enable sensor monitoring'
        });
    }
});

// Disable sensor monitoring
router.post('/disable', (req, res) => {
    try {
        const { sensor, pin } = req.body;
        
        if (!sensor) {
            return res.status(400).json({
                success: false,
                error: 'Missing sensor parameter'
            });
        }
        
        console.log(`📡 Disabling sensor monitoring: Sensor ${sensor}`);
        
        // Stop GPIO monitoring
        stopGPIOMonitoring(sensor);
        
        // Update sensor state
        if (sensorState.activeSensors.has(sensor)) {
            const sensorData = sensorState.activeSensors.get(sensor);
            sensorData.enabled = false;
        }
        
        // Broadcast sensor state update
        if (io) {
            io.emit('sensorUpdate', {
                message: `Sensor ${sensor} disabled`,
                sensor: sensor,
                enabled: false
            });
        }
        
        res.json({
            success: true,
            message: `Sensor ${sensor} monitoring disabled`,
            sensor: sensor
        });
        
    } catch (error) {
        console.error('Sensor disable error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to disable sensor monitoring'
        });
    }
});

// Reset sensor counters
router.post('/reset', (req, res) => {
    try {
        const { sensor, pin } = req.body;
        
        if (!sensor) {
            return res.status(400).json({
                success: false,
                error: 'Missing sensor parameter'
            });
        }
        
        console.log(`📡 Resetting sensor counters: Sensor ${sensor}`);
        
        // Reset counters
        if (sensorState.activeSensors.has(sensor)) {
            const sensorData = sensorState.activeSensors.get(sensor);
            const pin = sensorData.pin;
            
            sensorData.pulses = 0;
            sensorData.rate = 0;
            sensorData.lastPulse = null;
            
            sensorState.pulseCounts.set(pin, 0);
            sensorState.pulseRates.set(pin, 0);
            sensorState.lastPulseTimes.set(pin, null);
        }
        
        // Broadcast sensor state update
        if (io) {
            io.emit('sensorUpdate', {
                message: `Sensor ${sensor} counters reset`,
                sensor: sensor,
                reset: true
            });
        }
        
        res.json({
            success: true,
            message: `Sensor ${sensor} counters reset`,
            sensor: sensor
        });
        
    } catch (error) {
        console.error('Sensor reset error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to reset sensor counters'
        });
    }
});

// Get sensor status
router.get('/status', (req, res) => {
    try {
        const sensors = [];
        
        sensorState.activeSensors.forEach((data, sensor) => {
            sensors.push({
                sensor: sensor,
                pin: data.pin,
                enabled: data.enabled,
                pulses: data.pulses,
                rate: data.rate,
                lastPulse: data.lastPulse,
                mode: 'real_gpio_polling'
            });
        });
        
        res.json({
            success: true,
            activeSensors: sensors,
            totalSensors: sensorState.activeSensors.size,
            pigpioAvailable: pigpioAvailable,
            message: 'Sensor status retrieved successfully'
        });
        
    } catch (error) {
        console.error('Sensor status error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to get sensor status'
        });
    }
});

// Cleanup function for graceful shutdown
function cleanup() {
    console.log('📡 Cleaning up sensor monitoring...');
    
    // Stop all GPIO monitoring
    sensorState.activeSensors.forEach((data, sensor) => {
        stopGPIOMonitoring(sensor);
    });
    
    // Clear all intervals
    sensorState.pollingIntervals.forEach((interval, pin) => {
        clearInterval(interval);
    });
    
    // Clear all state
    sensorState.activeSensors.clear();
    sensorState.pulseCounts.clear();
    sensorState.pulseRates.clear();
    sensorState.lastPulseTimes.clear();
    sensorState.lastPinStates.clear();
    sensorState.pollingIntervals.clear();
    
    console.log('✅ Sensor monitoring cleanup completed');
}

module.exports = {
    router,
    setSocket,
    cleanup,
    sensorState
}; 