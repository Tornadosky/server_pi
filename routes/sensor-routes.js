// Sensor Routes Module - GPIO input monitoring for wheel encoders
// This module handles reading sensor inputs from wheel encoders or other sensors

const express = require('express');
const router = express.Router();

// Global sensor state - tracks all active sensor monitoring
const sensorState = {
    activeSensors: new Map(), // Map of sensor -> { pin, enabled, pulses, rate, lastPulse, interval }
    pulseCounts: new Map(),   // Map of pin -> pulse count
    pulseRates: new Map(),    // Map of pin -> pulses per second
    lastPulseTimes: new Map() // Map of pin -> last pulse timestamp
};

// Socket.IO instance for real-time updates
let io = null;

// Set Socket.IO instance (called from main server)
function setSocket(socketInstance) {
    io = socketInstance;
    console.log('📡 Sensor routes: Socket.IO instance set for real-time sensor updates');
}

// Simulate GPIO input monitoring (replace with actual GPIO implementation)
function startGPIOMonitoring(pin, sensor) {
    console.log(`📡 Starting GPIO monitoring for pin ${pin} (Sensor ${sensor})`);
    
    // In a real implementation, this would set up GPIO interrupt monitoring
    // For simulation, we'll generate random pulse data
    const interval = setInterval(() => {
        if (sensorState.activeSensors.get(sensor)?.enabled) {
            simulatePulse(pin, sensor);
        }
    }, Math.random() * 2000 + 500); // Random interval between 500ms-2.5s
    
    // Store the interval reference
    if (sensorState.activeSensors.has(sensor)) {
        sensorState.activeSensors.get(sensor).interval = interval;
    }
}

function stopGPIOMonitoring(sensor) {
    const sensorData = sensorState.activeSensors.get(sensor);
    if (sensorData && sensorData.interval) {
        clearInterval(sensorData.interval);
        sensorData.interval = null;
        console.log(`📡 Stopped GPIO monitoring for Sensor ${sensor}`);
    }
}

// Simulate a sensor pulse (replace with actual GPIO pulse detection)
function simulatePulse(pin, sensor) {
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
        rate = Math.round(1 / timeDiff); // Pulses per second
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
            timestamp: timestamp
        });
    }
    
    console.log(`📊 Sensor ${sensor} (GPIO ${pin}): Pulse #${newCount}, Rate: ${rate}/sec`);
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
        
        console.log(`📡 Enabling sensor monitoring: Sensor ${sensor} on GPIO ${pin}`);
        
        // Initialize sensor data
        sensorState.activeSensors.set(sensor, {
            pin: pin,
            enabled: true,
            pulses: 0,
            rate: 0,
            lastPulse: null,
            interval: null
        });
        
        // Initialize counters for this pin
        sensorState.pulseCounts.set(pin, 0);
        sensorState.pulseRates.set(pin, 0);
        sensorState.lastPulseTimes.set(pin, null);
        
        // Start GPIO monitoring
        startGPIOMonitoring(pin, sensor);
        
        // Broadcast sensor state update
        if (io) {
            io.emit('sensorUpdate', {
                message: `Sensor ${sensor} (GPIO ${pin}) enabled`,
                sensor: sensor,
                enabled: true
            });
        }
        
        res.json({
            success: true,
            message: `Sensor ${sensor} monitoring enabled on GPIO ${pin}`,
            sensor: sensor,
            pin: pin
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
                lastPulse: data.lastPulse
            });
        });
        
        res.json({
            success: true,
            activeSensors: sensors,
            totalSensors: sensorState.activeSensors.size,
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
    
    // Clear all state
    sensorState.activeSensors.clear();
    sensorState.pulseCounts.clear();
    sensorState.pulseRates.clear();
    sensorState.lastPulseTimes.clear();
    
    console.log('✅ Sensor monitoring cleanup completed');
}

module.exports = {
    router,
    setSocket,
    cleanup,
    sensorState
}; 