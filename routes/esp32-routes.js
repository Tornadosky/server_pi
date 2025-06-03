// ESP32 control routes module
// Handles ESP32 microcontroller communication and control

const express = require('express');
const axios = require('axios');
const router = express.Router();

// ESP32 GPIO pin configurations
const ESP32_PINS = {
  // Digital GPIO pins (INPUT/OUTPUT)
  digital: [0, 1, 2, 3, 4, 5, 12, 13, 14, 15, 16, 17, 18, 19, 21, 22, 23, 25, 26, 27, 32, 33],
  
  // PWM capable pins (LEDC - up to 16 channels)
  pwm: [0, 1, 2, 3, 4, 5, 12, 13, 14, 15, 16, 17, 18, 19, 21, 22, 23, 25, 26, 27, 32, 33],
  
  // ADC pins (Analog input)
  adc: [32, 33, 34, 35, 36, 37, 38, 39], // ADC1: 32-39, ADC2: 0,2,4,12-15,25-27
  
  // Touch sensor pins
  touch: [0, 2, 4, 12, 13, 14, 15, 27, 32, 33],
  
  // Special pins (avoid unless necessary)
  reserved: [6, 7, 8, 9, 10, 11], // Connected to SPI flash
  
  // Built-in LED (varies by board)
  builtin_led: 2
};

// ==============================================
// DEVICE MANAGEMENT ENDPOINTS
// ==============================================

// Get all connected ESP32 devices
router.get('/devices', (req, res) => {
  const devices = Array.from(req.connectedDevices.entries()).map(([id, device]) => ({
    id: id,
    status: device.status,
    lastSeen: device.lastSeen,
    capabilities: device.capabilities,
    sensorData: device.sensorData || {},
    uptime: device.uptime || 0,
    freeHeap: device.freeHeap || 0,
    wifiSignal: device.wifiSignal || 0
  }));

  res.json({
    success: true,
    count: devices.length,
    devices: devices,
    timestamp: new Date().toISOString()
  });
});

// Get specific device status
router.get('/status/:deviceId', (req, res) => {
  const { deviceId } = req.params;
  
  if (!req.connectedDevices.has(deviceId)) {
    return res.status(404).json({
      success: false,
      error: 'Device not found',
      message: `ESP32 device '${deviceId}' is not connected`,
      timestamp: new Date().toISOString()
    });
  }

  const device = req.connectedDevices.get(deviceId);
  
  res.json({
    success: true,
    device: {
      id: deviceId,
      status: device.status,
      lastSeen: device.lastSeen,
      capabilities: device.capabilities,
      sensorData: device.sensorData || {},
      uptime: device.uptime || 0,
      freeHeap: device.freeHeap || 0,
      wifiSignal: device.wifiSignal || 0
    },
    timestamp: new Date().toISOString()
  });
});

// ==============================================
// GPIO CONTROL ENDPOINTS
// ==============================================

// Set digital GPIO pin state
router.post('/gpio/:deviceId', async (req, res) => {
  const { deviceId } = req.params;
  const { pin, state, mode = 'OUTPUT' } = req.body;

  // Validation
  if (!ESP32_PINS.digital.includes(pin)) {
    return res.status(400).json({
      success: false,
      error: 'Invalid GPIO pin',
      message: `Pin ${pin} is not a valid digital GPIO pin`,
      validPins: ESP32_PINS.digital,
      timestamp: new Date().toISOString()
    });
  }

  if (state !== undefined && ![0, 1, true, false].includes(state)) {
    return res.status(400).json({
      success: false,
      error: 'Invalid state',
      message: 'State must be 0, 1, true, or false',
      timestamp: new Date().toISOString()
    });
  }

  if (!['INPUT', 'OUTPUT', 'INPUT_PULLUP', 'INPUT_PULLDOWN'].includes(mode)) {
    return res.status(400).json({
      success: false,
      error: 'Invalid pin mode',
      message: 'Mode must be INPUT, OUTPUT, INPUT_PULLUP, or INPUT_PULLDOWN',
      timestamp: new Date().toISOString()
    });
  }

  try {
    await sendCommandToESP32(req.connectedDevices, deviceId, {
      type: 'gpio',
      pin: pin,
      mode: mode,
      state: state
    });

    res.json({
      success: true,
      message: 'GPIO command sent successfully',
      deviceId: deviceId,
      pin: pin,
      mode: mode,
      state: state,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Failed to send GPIO command',
      message: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// ==============================================
// PWM CONTROL ENDPOINTS
// ==============================================

// Set PWM on ESP32 pin
router.post('/pwm/:deviceId', async (req, res) => {
  const { deviceId } = req.params;
  const { 
    pin, 
    dutyCycle = 0, 
    frequency = 1000, 
    resolution = 8,
    channel 
  } = req.body;

  // Validation
  if (!ESP32_PINS.pwm.includes(pin)) {
    return res.status(400).json({
      success: false,
      error: 'Invalid PWM pin',
      message: `Pin ${pin} is not PWM capable`,
      validPins: ESP32_PINS.pwm,
      timestamp: new Date().toISOString()
    });
  }

  // ESP32 PWM validation
  const maxDutyCycle = Math.pow(2, resolution) - 1;
  if (dutyCycle < 0 || dutyCycle > maxDutyCycle) {
    return res.status(400).json({
      success: false,
      error: 'Invalid duty cycle',
      message: `Duty cycle must be between 0 and ${maxDutyCycle} for ${resolution}-bit resolution`,
      timestamp: new Date().toISOString()
    });
  }

  if (frequency < 1 || frequency > 40000000) {
    return res.status(400).json({
      success: false,
      error: 'Invalid frequency',
      message: 'Frequency must be between 1 Hz and 40 MHz',
      timestamp: new Date().toISOString()
    });
  }

  if (resolution < 1 || resolution > 16) {
    return res.status(400).json({
      success: false,
      error: 'Invalid resolution',
      message: 'Resolution must be between 1 and 16 bits',
      timestamp: new Date().toISOString()
    });
  }

  try {
    await sendCommandToESP32(req.connectedDevices, deviceId, {
      type: 'pwm',
      pin: pin,
      dutyCycle: dutyCycle,
      frequency: frequency,
      resolution: resolution,
      channel: channel
    });

    const dutyPercentage = Math.round((dutyCycle / maxDutyCycle) * 100);

    res.json({
      success: true,
      message: 'PWM command sent successfully',
      deviceId: deviceId,
      pin: pin,
      dutyCycle: dutyCycle,
      dutyPercentage: dutyPercentage,
      frequency: frequency,
      resolution: resolution,
      channel: channel,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Failed to send PWM command',
      message: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// Stop PWM on specific pin
router.post('/pwm/:deviceId/stop', async (req, res) => {
  const { deviceId } = req.params;
  const { pin, channel } = req.body;

  if (!ESP32_PINS.pwm.includes(pin)) {
    return res.status(400).json({
      success: false,
      error: 'Invalid PWM pin',
      message: `Pin ${pin} is not PWM capable`,
      timestamp: new Date().toISOString()
    });
  }

  try {
    await sendCommandToESP32(req.connectedDevices, deviceId, {
      type: 'pwm_stop',
      pin: pin,
      channel: channel
    });

    res.json({
      success: true,
      message: 'PWM stopped successfully',
      deviceId: deviceId,
      pin: pin,
      channel: channel,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Failed to stop PWM',
      message: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// ==============================================
// ANALOG/SENSOR ENDPOINTS
// ==============================================

// Read analog pin (ADC)
router.get('/analog/:deviceId/:pin', async (req, res) => {
  const { deviceId, pin } = req.params;
  const pinNum = parseInt(pin);

  if (!ESP32_PINS.adc.includes(pinNum)) {
    return res.status(400).json({
      success: false,
      error: 'Invalid ADC pin',
      message: `Pin ${pinNum} is not an ADC pin`,
      validPins: ESP32_PINS.adc,
      timestamp: new Date().toISOString()
    });
  }

  try {
    const response = await sendCommandToESP32(req.connectedDevices, deviceId, {
      type: 'adc_read',
      pin: pinNum
    });

    res.json({
      success: true,
      deviceId: deviceId,
      pin: pinNum,
      rawValue: response.rawValue || 0,
      voltage: response.voltage || 0,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Failed to read analog pin',
      message: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// Get sensor readings
router.get('/sensors/:deviceId', (req, res) => {
  const { deviceId } = req.params;
  
  if (!req.connectedDevices.has(deviceId)) {
    return res.status(404).json({
      success: false,
      error: 'Device not found',
      timestamp: new Date().toISOString()
    });
  }

  const device = req.connectedDevices.get(deviceId);
  
  res.json({
    success: true,
    deviceId: deviceId,
    sensors: device.sensorData || {},
    lastUpdate: device.lastSeen,
    timestamp: new Date().toISOString()
  });
});

// ==============================================
// GENERAL COMMAND ENDPOINT
// ==============================================

// Send custom command to ESP32
router.post('/command/:deviceId', async (req, res) => {
  const { deviceId } = req.params;
  const command = req.body;

  try {
    const response = await sendCommandToESP32(req.connectedDevices, deviceId, command);
    
    res.json({
      success: true,
      message: 'Command sent successfully',
      deviceId: deviceId,
      command: command,
      response: response,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Failed to send command',
      message: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// ==============================================
// ESP32 CAPABILITIES ENDPOINT
// ==============================================

// Get ESP32 pin configurations and capabilities
router.get('/capabilities', (req, res) => {
  res.json({
    success: true,
    esp32Pins: ESP32_PINS,
    features: {
      gpio: 'Digital input/output control',
      pwm: 'PWM output (LEDC - up to 16 channels)',
      adc: 'Analog input reading (12-bit resolution)',
      touch: 'Capacitive touch sensing',
      wifi: 'Built-in WiFi connectivity',
      bluetooth: 'Built-in Bluetooth support',
      rtc: 'Real-time clock',
      deepSleep: 'Ultra-low power deep sleep',
      spi: 'SPI communication',
      i2c: 'I2C communication',
      uart: 'UART serial communication'
    },
    specifications: {
      cpu: 'Dual-core 32-bit LX6 microprocessor',
      clockSpeed: 'Up to 240 MHz',
      flash: '4MB (typical)',
      ram: '520KB SRAM',
      gpio: '34 programmable GPIOs',
      pwmChannels: '16 channels',
      adcChannels: '18 channels (12-bit)',
      touchPins: '10 capacitive touch pins'
    },
    timestamp: new Date().toISOString()
  });
});

// ==============================================
// UTILITY FUNCTIONS
// ==============================================

// Send command to ESP32 device via WebSocket
async function sendCommandToESP32(connectedDevices, deviceId, command) {
  return new Promise((resolve, reject) => {
    if (!connectedDevices.has(deviceId)) {
      reject(new Error(`ESP32 device '${deviceId}' is not connected`));
      return;
    }

    const device = connectedDevices.get(deviceId);
    const ws = device.websocket;

    if (!ws || ws.readyState !== ws.OPEN) {
      reject(new Error(`ESP32 device '${deviceId}' WebSocket is not open`));
      return;
    }

    // Generate unique command ID for response tracking
    const commandId = Date.now().toString(36) + Math.random().toString(36).substr(2);
    
    const message = {
      id: commandId,
      type: 'command',
      command: command,
      timestamp: new Date().toISOString()
    };

    // Set up response handler
    const responseTimeout = setTimeout(() => {
      reject(new Error('Command timeout - no response from ESP32'));
    }, 5000); // 5 second timeout

    // Store response handler
    const originalOnMessage = ws.onmessage;
    ws.onmessage = (event) => {
      try {
        const response = JSON.parse(event.data);
        if (response.id === commandId) {
          clearTimeout(responseTimeout);
          ws.onmessage = originalOnMessage; // Restore original handler
          
          if (response.success) {
            resolve(response.data || {});
          } else {
            reject(new Error(response.error || 'ESP32 command failed'));
          }
        } else if (originalOnMessage) {
          originalOnMessage(event);
        }
      } catch (error) {
        // Not our response, pass to original handler
        if (originalOnMessage) {
          originalOnMessage(event);
        }
      }
    };

    // Send command
    ws.send(JSON.stringify(message));
  });
}

// Export router and utilities
module.exports = router; 