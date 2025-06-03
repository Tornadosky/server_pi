// PWM control routes module
// Handles Raspberry Pi GPIO PWM pin control

const express = require('express');
const router = express.Router();

// Initialize pigpio for GPIO control
let Gpio;
let pigpioAvailable = false;
let activePins = new Map(); // Track active PWM pins

// Try to initialize pigpio (will work on Raspberry Pi)
try {
  const pigpio = require('pigpio');
  Gpio = pigpio.Gpio;
  
  // Test if pigpio can actually work by creating a test GPIO instance
  try {
    // Try to create a test GPIO instance - this is the real test for Node.js pigpio
    const testPin = new Gpio(18, { mode: Gpio.OUTPUT });
    testPin.digitalWrite(0); // Set to low (safe state)
    
    pigpioAvailable = true;
    console.log('✅ pigpio initialized successfully - Hardware PWM control available');
    console.log('🎛️  Ready to control real GPIO pins!');
    console.log('🚀 pigpiod daemon is running properly');
    
  } catch (initError) {
    console.log('⚠️  pigpio hardware not available - running in simulation mode');
    console.log('   Reason:', initError.message);
    
    // Check if we're on a Raspberry Pi but pigpiod isn't running
    const fs = require('fs');
    if (fs.existsSync('/proc/cpuinfo')) {
      const cpuinfo = fs.readFileSync('/proc/cpuinfo', 'utf8');
      if (cpuinfo.includes('Raspberry Pi')) {
        console.log('🔧 You\'re on a Raspberry Pi! Make sure pigpiod is running:');
        console.log('   sudo systemctl status pigpiod');
        console.log('   sudo systemctl start pigpiod');
        console.log('   sudo systemctl enable pigpiod');
      }
    }
    
    pigpioAvailable = false;
  }
} catch (error) {
  console.log('⚠️  pigpio module not available - running in simulation mode');
  console.log('   This is normal when not running on a Raspberry Pi');
  console.log('   Install with: npm install pigpio');
  pigpioAvailable = false;
}

// ==============================================
// PWM CONTROL ENDPOINTS
// ==============================================

// Get PWM status and available pins
router.get('/status', (req, res) => {
  const pwmPins = [12, 13, 18, 19]; // Hardware PWM pins on Pi 4
  const softwarePwmPins = [2, 3, 4, 14, 15, 17, 18, 27, 22, 23, 24, 10, 9, 25, 11, 8, 7, 1, 0, 5, 6, 12, 13, 19, 16, 26, 20, 21];
  
  const activePinsList = Array.from(activePins.keys()).map(pin => ({
    pin: pin,
    dutyCycle: activePins.get(pin).dutyCycle,
    frequency: activePins.get(pin).frequency,
    enabled: activePins.get(pin).enabled
  }));

  res.json({
    success: true,
    pigpioAvailable: pigpioAvailable,
    hardwarePwmPins: pwmPins,
    softwarePwmPins: softwarePwmPins,
    activePins: activePinsList,
    message: pigpioAvailable ? 'PWM control ready' : 'Running in simulation mode',
    timestamp: new Date().toISOString()
  });
});

// Set PWM on a specific pin
router.post('/set', (req, res) => {
  const { pin, dutyCycle, frequency = 1000, enabled = true } = req.body;

  // Validation - fix to allow pin 0 and dutyCycle 0
  if (pin === undefined || pin === null || pin < 0 || pin > 27) {
    return res.status(400).json({
      success: false,
      error: 'Invalid pin number. Must be between 0-27',
      timestamp: new Date().toISOString()
    });
  }

  if (dutyCycle === undefined || dutyCycle === null || dutyCycle < 0 || dutyCycle > 255) {
    return res.status(400).json({
      success: false,
      error: 'Invalid duty cycle. Must be between 0-255',
      timestamp: new Date().toISOString()
    });
  }

  if (frequency < 1 || frequency > 8000) {
    return res.status(400).json({
      success: false,
      error: 'Invalid frequency. Must be between 1-8000 Hz',
      timestamp: new Date().toISOString()
    });
  }

  try {
    if (pigpioAvailable && Gpio) {
      // Real Raspberry Pi - set actual PWM
      if (!activePins.has(pin)) {
        // Initialize new pin
        const gpioPin = new Gpio(pin, { mode: Gpio.OUTPUT });
        activePins.set(pin, {
          gpio: gpioPin,
          dutyCycle: 0,
          frequency: 1000,
          enabled: false
        });
      }

      const pinData = activePins.get(pin);
      
      if (enabled) {
        // Set PWM frequency and duty cycle
        pinData.gpio.pwmFrequency(frequency);
        pinData.gpio.pwmWrite(dutyCycle);
        pinData.enabled = true;
      } else {
        // Disable PWM (set to 0)
        pinData.gpio.pwmWrite(0);
        pinData.enabled = false;
      }

      // Update stored values
      pinData.dutyCycle = dutyCycle;
      pinData.frequency = frequency;

    } else {
      // Simulation mode - just store the values
      activePins.set(pin, {
        gpio: null,
        dutyCycle: dutyCycle,
        frequency: frequency,
        enabled: enabled
      });
    }

    res.json({
      success: true,
      message: enabled ? 'PWM signal set successfully' : 'PWM disabled',
      pin: pin,
      dutyCycle: dutyCycle,
      frequency: frequency,
      enabled: enabled,
      dutyPercentage: Math.round((dutyCycle / 255) * 100),
      mode: pigpioAvailable ? 'hardware' : 'simulation',
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('PWM Error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to set PWM',
      details: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// Stop PWM on a specific pin
router.post('/stop', (req, res) => {
  const { pin } = req.body;

  if (pin === undefined || pin === null || pin < 0 || pin > 27) {
    return res.status(400).json({
      success: false,
      error: 'Invalid pin number. Must be between 0-27',
      timestamp: new Date().toISOString()
    });
  }

  try {
    if (activePins.has(pin)) {
      const pinData = activePins.get(pin);
      
      if (pigpioAvailable && pinData.gpio) {
        // Stop PWM and clean up GPIO
        pinData.gpio.pwmWrite(0);
        pinData.gpio = null;
      }
      
      // Remove from active pins
      activePins.delete(pin);
    }

    res.json({
      success: true,
      message: 'PWM stopped successfully',
      pin: pin,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('PWM Stop Error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to stop PWM',
      details: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// Stop all PWM signals
router.post('/stop-all', (req, res) => {
  try {
    let stoppedPins = [];

    for (const [pin, pinData] of activePins) {
      if (pigpioAvailable && pinData.gpio) {
        pinData.gpio.pwmWrite(0);
        pinData.gpio = null;
      }
      stoppedPins.push(pin);
    }

    activePins.clear();

    res.json({
      success: true,
      message: 'All PWM signals stopped',
      stoppedPins: stoppedPins,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('PWM Stop All Error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to stop all PWM signals',
      details: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// Cleanup function for graceful shutdown
function cleanup() {
  console.log('🧹 Cleaning up PWM pins...');
  for (const [pin, pinData] of activePins) {
    if (pigpioAvailable && pinData.gpio) {
      try {
        pinData.gpio.pwmWrite(0);
        pinData.gpio = null;
      } catch (error) {
        console.error(`Error cleaning up pin ${pin}:`, error);
      }
    }
  }
  activePins.clear();
}

// Export cleanup function for use in main server
router.cleanup = cleanup;

module.exports = router; 