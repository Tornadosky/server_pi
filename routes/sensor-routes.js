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
    activeSensors: new Map(), // Map of sensor -> { pin, enabled, pulses, rate, lastPulse, gpio, filteredRPM }
    pulseCounts: new Map(),   // Map of pin -> pulse count
    pulseRates: new Map(),    // Map of pin -> pulses per second
    lastPulseTimes: new Map(), // Map of pin -> last pulse timestamp
    pulseTimes: new Map(),    // Map of pin -> array of recent pulse timestamps for rolling window
    rpmFilters: new Map(),    // Map of pin -> filtered RPM value
    lastEdgeTick: new Map()   // Map of pin -> last edge tick for debouncing
};

// Socket.IO instance for real-time updates
let io = null;

// Set Socket.IO instance (called from main server)
function setSocket(socketInstance) {
    io = socketInstance;
    console.log('📡 Sensor routes: Socket.IO instance set for real-time sensor updates');
}

// Real GPIO input monitoring using pigpio alerts (interrupt-based)
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
            pullUpDown: Gpio.PUD_UP, // Use internal pull-up resistor
            alert: true // Enable alerts for interrupt-based detection
        });
        
        // Initialize pulse timing for accurate RPM calculation
        if (!sensorState.pulseTimes) {
            sensorState.pulseTimes = new Map();
        }
        if (!sensorState.rpmFilters) {
            sensorState.rpmFilters = new Map();
        }
        
        sensorState.pulseTimes.set(pin, []);
        sensorState.rpmFilters.set(pin, 0);
        
        // Set up interrupt-based edge detection
        const sensorKey = parseInt(sensor);
        gpio.on('alert', (level, tick) => {
            if (level === 1 && sensorState.activeSensors.get(sensorKey)?.enabled) {
                detectRealPulseInterrupt(pin, sensorKey, tick);
            }
        });
        
        console.log(`🔧 GPIO ${pin} initialized with interrupt-based detection`);
        
        // Update sensor state
        if (sensorState.activeSensors.has(sensorKey)) {
            const sensorData = sensorState.activeSensors.get(sensorKey);
            sensorData.gpio = gpio;
            sensorData.polling = null; // No polling needed with interrupts
        }
        
        console.log(`✅ Real GPIO monitoring active on pin ${pin} for Sensor ${sensor} (Interrupt mode)`);
        return true;
        
    } catch (error) {
        console.error(`❌ Failed to setup GPIO monitoring on pin ${pin}:`, error);
        return false;
    }
}

// Interrupt-based pulse detection with rolling window RPM calculation
function detectRealPulseInterrupt(pin, sensor, tick) {
    const timestamp = Date.now();
    // pigpio tick is µs since boot → convert once to seconds
    const tickTime = tick / 1_000_000;

    // ── Debounce: ignore edges <1 ms apart ─────────────────────
    sensorState.lastEdgeTick ??= new Map();
    const lastTick = sensorState.lastEdgeTick.get(pin) ?? 0;
    if (tick - lastTick < 5_000) return;  // increase debounce to 5 ms
    sensorState.lastEdgeTick.set(pin, tick);
    
    // Increment pulse count
    const currentCount = sensorState.pulseCounts.get(pin) || 0;
    const newCount = currentCount + 1;
    sensorState.pulseCounts.set(pin, newCount);
    // ── DIAGNOSTIC LOG ──
    const fr = sensorState.rpmFilters.get(pin) ?? 0;
    console.log(`🔍 [Sensor ${sensor}] pulse #${newCount} on GPIO ${pin}, filteredRPM=${fr.toFixed(1)}, timestamp=${timestamp}`);
    
    // Rolling window RPM calculation for better accuracy
    const pulseTimes = sensorState.pulseTimes.get(pin) || [];
    pulseTimes.push(tickTime);
    
    // Keep a 1 s window of timestamps
    while (pulseTimes.length && (tickTime - pulseTimes[0]) > 1.0) {
        pulseTimes.shift();
    }
    
    let rate = 0;
    let instantRPM = 0;
    
    // Debug timing for first few pulses
    if (newCount <= 10) {
        console.log(`🔧 Pulse ${newCount}: tickTime=${tickTime.toFixed(6)}s, pulseTimes.length=${pulseTimes.length}`);
    }
    
    if (pulseTimes.length >= 2) { // Require at least 2 pulses for calculation
        // Calculate RPM from rolling window period
        const windowTime = pulseTimes[pulseTimes.length - 1] - pulseTimes[0]; // already in seconds
        const windowPulses = pulseTimes.length - 1;
        
        // Debug the window calculation
        if (newCount <= 10) {
            console.log(`🔧 Window: ${windowPulses} pulses in ${windowTime.toFixed(6)}s`);
        }
        
        if (windowTime > 0.025) {           // >=25 ms window
            const pulsesPerSecond = windowPulses / windowTime;
            rate = Math.round(pulsesPerSecond);
            instantRPM = (pulsesPerSecond * 60) / 45; // 45 pulses per rotation
            
            // Apply single-pole IIR filter for smoothing - start with first valid RPM, never 0
            const currentFilter = sensorState.rpmFilters.get(pin) ?? instantRPM;
            const filteredRPM = currentFilter * 0.6 + instantRPM * 0.4;
            sensorState.rpmFilters.set(pin, filteredRPM);
            
            // Debug logging for calculations
            if (newCount <= 10) {
                console.log(`🔧 RPM Calc: ${pulsesPerSecond.toFixed(1)} pps = ${instantRPM.toFixed(1)} RPM, filtered: ${filteredRPM.toFixed(1)}`);
            }
        } else {
            // keep previous filteredRPM so controller never sees 0
        }
    }
    
    sensorState.pulseTimes.set(pin, pulseTimes);
    sensorState.lastPulseTimes.set(pin, timestamp);
    sensorState.pulseRates.set(pin, rate);
    
    // Update sensor state (ensure sensor key is number) - always publish filteredRPM
    const sensorKey = parseInt(sensor);
    if (sensorState.activeSensors.has(sensorKey)) {
        const sensorData = sensorState.activeSensors.get(sensorKey);
        sensorData.pulses = newCount;
        sensorData.rate = rate;
        sensorData.lastPulse = timestamp;
        sensorData.filteredRPM = sensorState.rpmFilters.get(pin) ?? 0;
        console.log(`🔍 [Sensor ${sensor}] → sensorState.activeSensors.get(${sensor}).pulses=${sensorData.pulses}, filteredRPM=${sensorData.filteredRPM.toFixed(1)}`);
    }
    
    // Log first few pulses for diagnostics
    if (newCount <= 5) {
        console.log(`🔄 Sensor ${sensor}: Pulse #${newCount} detected on GPIO ${pin}, RPM: ${(sensorState.rpmFilters.get(pin) ?? 0).toFixed(1)}`);
    }
    
    // Broadcast sensor pulse to all WebSocket clients
    if (io) {
        io.emit('sensorPulse', {
            sensor: sensor,
            pin: pin,
            pulses: newCount,
            rate: rate,
            rpm: sensorState.rpmFilters.get(pin) ?? 0,
            timestamp: timestamp,
            source: 'real_gpio_interrupt'
        });
    }
    

}

function stopGPIOMonitoring(sensor) {
    const sensorData = sensorState.activeSensors.get(parseInt(sensor));
    if (!sensorData) return;
    
    const pin = sensorData.pin;
    
    // Remove alert listener and clean up GPIO
    if (sensorData.gpio) {
        sensorData.gpio.removeAllListeners('alert');
        sensorData.gpio = null;
        console.log(`📡 Stopped GPIO interrupt monitoring for Sensor ${sensor} (GPIO ${pin})`);
    }
    
    // Clear pulse timing data
    if (sensorState.pulseTimes) {
        sensorState.pulseTimes.delete(pin);
    }
    if (sensorState.rpmFilters) {
        sensorState.rpmFilters.delete(pin);
    }
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
        
        // Initialize sensor data (ensure sensor is stored as number)
        sensorState.activeSensors.set(parseInt(sensor), {
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
        const sensorKey = parseInt(sensor);
        if (sensorState.activeSensors.has(sensorKey)) {
            const sensorData = sensorState.activeSensors.get(sensorKey);
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
        const sensorKey = parseInt(sensor);
        if (sensorState.activeSensors.has(sensorKey)) {
            const sensorData = sensorState.activeSensors.get(sensorKey);
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
    
    // Clean up interrupt listeners
    sensorState.activeSensors.forEach((data, sensor) => {
        if (data.gpio) {
            data.gpio.removeAllListeners('alert');
        }
    });
    
    // Clear all state
    sensorState.activeSensors.clear();
    sensorState.pulseCounts.clear();
    sensorState.pulseRates.clear();
    sensorState.lastPulseTimes.clear();
    
    if (sensorState.pulseTimes) {
        sensorState.pulseTimes.clear();
    }
    if (sensorState.rpmFilters) {
        sensorState.rpmFilters.clear();
    }
    if (sensorState.lastEdgeTick) {
        sensorState.lastEdgeTick.clear();
    }
    
    console.log('✅ Sensor monitoring cleanup completed');
}

module.exports = {
    router,
    setSocket,
    cleanup,
    sensorState
}; 