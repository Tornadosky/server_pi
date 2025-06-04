// Robot control routes module
// Handles 4-wheel robot speed control with total speed management

const express = require('express');
const router = express.Router();

// Robot configuration
const ROBOT_CONFIG = {
  wheels: {
    frontLeft: { pin: 18, name: 'Front Left' },    // Hardware PWM pins
    frontRight: { pin: 12, name: 'Front Right' },
    backLeft: { pin: 13, name: 'Back Left' },
    backRight: { pin: 19, name: 'Back Right' }
  },
  maxSpeed: 255,        // Maximum PWM duty cycle
  speedSmoothness: 10   // Adjustment step size for smooth speed changes
};

// Robot state tracking
let robotState = {
  totalSpeed: 0,           // Current total robot speed (0-100%)
  targetSpeed: 0,          // Target total robot speed
  wheels: {
    frontLeft: { speed: 0, adjustment: 0 },     // adjustment: -50 to +50%
    frontRight: { speed: 0, adjustment: 0 },
    backLeft: { speed: 0, adjustment: 0 },
    backRight: { speed: 0, adjustment: 0 }
  },
  isMoving: false,
  direction: 'stopped'     // stopped, forward, backward, left, right
};

// Socket.IO instance (will be set from server.js)
let socketIO = null;

// Initialize socket connection
function setSocket(io) {
  socketIO = io;
  console.log('🔌 Robot routes: Socket.IO connection established');
}

// ==============================================
// ROBOT SPEED CALCULATION FUNCTIONS
// ==============================================

// Calculate individual wheel speeds based on total speed and adjustments
function calculateWheelSpeeds(totalSpeedPercent) {
  const baseSpeed = (totalSpeedPercent / 100) * ROBOT_CONFIG.maxSpeed;
  
  Object.keys(robotState.wheels).forEach(wheelKey => {
    const wheel = robotState.wheels[wheelKey];
    
    // Apply individual wheel adjustment (-50% to +50%)
    const adjustmentFactor = 1 + (wheel.adjustment / 100);
    let adjustedSpeed = baseSpeed * adjustmentFactor;
    
    // Ensure speed stays within valid PWM range
    adjustedSpeed = Math.max(0, Math.min(ROBOT_CONFIG.maxSpeed, adjustedSpeed));
    
    wheel.speed = Math.round(adjustedSpeed);
  });
}

// Apply calculated speeds to actual PWM pins using fetch to PWM endpoints
async function applyWheelSpeeds() {
  const pwmPromises = [];
  
  Object.keys(ROBOT_CONFIG.wheels).forEach(wheelKey => {
    const wheelConfig = ROBOT_CONFIG.wheels[wheelKey];
    const wheelState = robotState.wheels[wheelKey];
    
    // Create HTTP request to set PWM for this wheel
    const pwmRequest = fetch('/api/pwm/set', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        pin: wheelConfig.pin,
        dutyCycle: wheelState.speed,
        frequency: 1000,
        enabled: wheelState.speed > 0
      })
    });
    
    pwmPromises.push(pwmRequest);
  });
  
  try {
    const responses = await Promise.all(pwmPromises);
    
    // Check if all requests were successful
    for (let response of responses) {
      if (!response.ok) {
        const errorData = await response.json();
        console.error('PWM request failed:', errorData);
        return false;
      }
    }
    
    console.log('✅ All wheel speeds applied successfully');
    return true;
  } catch (error) {
    console.error('Error applying wheel speeds:', error);
    return false;
  }
}

// ==============================================
// ROBOT CONTROL ENDPOINTS
// ==============================================

// Get robot status
router.get('/status', (req, res) => {
  res.json({
    success: true,
    robotState: robotState,
    wheelConfiguration: ROBOT_CONFIG.wheels,
    timestamp: new Date().toISOString()
  });
});

// Set total robot speed (0-100%)
router.post('/speed', async (req, res) => {
  const { speed } = req.body;
  
  // Validate speed input
  if (speed === undefined || speed < 0 || speed > 100) {
    return res.status(400).json({
      success: false,
      error: 'Invalid speed. Must be between 0-100%',
      timestamp: new Date().toISOString()
    });
  }
  
  try {
    // Update robot state
    robotState.targetSpeed = speed;
    robotState.totalSpeed = speed;
    robotState.isMoving = speed > 0;
    robotState.direction = speed > 0 ? 'forward' : 'stopped';
    
    // Calculate and apply new wheel speeds
    calculateWheelSpeeds(speed);
    const success = await applyWheelSpeeds();
    
    if (success) {
      // Broadcast to all connected clients via WebSocket
      if (socketIO) {
        socketIO.emit('robotUpdate', {
          type: 'speedChange',
          robotState: robotState,
          timestamp: new Date().toISOString()
        });
      }
      
      res.json({
        success: true,
        message: `Robot speed set to ${speed}%`,
        robotState: robotState,
        wheelDetails: Object.keys(ROBOT_CONFIG.wheels).map(wheelKey => ({
          wheel: wheelKey,
          pin: ROBOT_CONFIG.wheels[wheelKey].pin,
          speed: robotState.wheels[wheelKey].speed,
          pwmDutyCycle: robotState.wheels[wheelKey].speed,
          adjustment: robotState.wheels[wheelKey].adjustment
        })),
        timestamp: new Date().toISOString()
      });
    } else {
      throw new Error('Failed to apply wheel speeds to PWM pins');
    }
    
  } catch (error) {
    console.error('Robot speed control error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to set robot speed',
      details: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// Adjust individual wheel speed (-50% to +50% of total speed)
router.post('/wheel', async (req, res) => {
  const { wheel, adjustment } = req.body;
  
  // Validate inputs
  if (!wheel || !ROBOT_CONFIG.wheels[wheel]) {
    return res.status(400).json({
      success: false,
      error: 'Invalid wheel. Must be one of: frontLeft, frontRight, backLeft, backRight',
      timestamp: new Date().toISOString()
    });
  }
  
  if (adjustment === undefined || adjustment < -50 || adjustment > 50) {
    return res.status(400).json({
      success: false,
      error: 'Invalid adjustment. Must be between -50% to +50%',
      timestamp: new Date().toISOString()
    });
  }
  
  try {
    // Update wheel adjustment
    robotState.wheels[wheel].adjustment = adjustment;
    
    // Recalculate all wheel speeds based on current total speed
    calculateWheelSpeeds(robotState.totalSpeed);
    const success = await applyWheelSpeeds();
    
    if (success) {
      // Broadcast to all connected clients via WebSocket
      if (socketIO) {
        socketIO.emit('robotUpdate', {
          type: 'wheelAdjustment',
          wheel: wheel,
          adjustment: adjustment,
          robotState: robotState,
          timestamp: new Date().toISOString()
        });
      }
      
      res.json({
        success: true,
        message: `${ROBOT_CONFIG.wheels[wheel].name} wheel adjusted by ${adjustment}%`,
        wheel: wheel,
        adjustment: adjustment,
        pin: ROBOT_CONFIG.wheels[wheel].pin,
        newSpeed: robotState.wheels[wheel].speed,
        robotState: robotState,
        timestamp: new Date().toISOString()
      });
    } else {
      throw new Error('Failed to apply wheel adjustment to PWM pins');
    }
    
  } catch (error) {
    console.error('Wheel adjustment error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to adjust wheel speed',
      details: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// Emergency stop - immediately stop all wheels
router.post('/stop', async (req, res) => {
  try {
    // Reset robot state
    robotState.totalSpeed = 0;
    robotState.targetSpeed = 0;
    robotState.isMoving = false;
    robotState.direction = 'stopped';
    
    // Reset all wheels
    Object.keys(robotState.wheels).forEach(wheelKey => {
      robotState.wheels[wheelKey].speed = 0;
      // Keep adjustments for next movement
    });
    
    // Apply zero speeds to all wheels
    const success = await applyWheelSpeeds();
    
    if (success) {
      // Broadcast emergency stop to all connected clients
      if (socketIO) {
        socketIO.emit('robotUpdate', {
          type: 'emergencyStop',
          robotState: robotState,
          timestamp: new Date().toISOString()
        });
      }
      
      res.json({
        success: true,
        message: 'Emergency stop executed - all wheels stopped',
        robotState: robotState,
        stoppedPins: Object.values(ROBOT_CONFIG.wheels).map(wheel => wheel.pin),
        timestamp: new Date().toISOString()
      });
    } else {
      throw new Error('Failed to stop all wheels via PWM');
    }
    
  } catch (error) {
    console.error('Emergency stop error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to execute emergency stop',
      details: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// Reset all wheel adjustments to 0
router.post('/reset-adjustments', async (req, res) => {
  try {
    // Reset all wheel adjustments
    Object.keys(robotState.wheels).forEach(wheelKey => {
      robotState.wheels[wheelKey].adjustment = 0;
    });
    
    // Recalculate speeds with no adjustments
    calculateWheelSpeeds(robotState.totalSpeed);
    const success = await applyWheelSpeeds();
    
    if (success) {
      // Broadcast adjustment reset to all connected clients
      if (socketIO) {
        socketIO.emit('robotUpdate', {
          type: 'adjustmentsReset',
          robotState: robotState,
          timestamp: new Date().toISOString()
        });
      }
      
      res.json({
        success: true,
        message: 'All wheel adjustments reset to 0%',
        robotState: robotState,
        wheelDetails: Object.keys(ROBOT_CONFIG.wheels).map(wheelKey => ({
          wheel: wheelKey,
          pin: ROBOT_CONFIG.wheels[wheelKey].pin,
          speed: robotState.wheels[wheelKey].speed,
          adjustment: robotState.wheels[wheelKey].adjustment
        })),
        timestamp: new Date().toISOString()
      });
    } else {
      throw new Error('Failed to apply reset adjustments to PWM pins');
    }
    
  } catch (error) {
    console.error('Reset adjustments error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to reset wheel adjustments',
      details: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// Export router and helper functions
module.exports = router;
module.exports.setSocket = setSocket;
module.exports.robotState = robotState;
module.exports.ROBOT_CONFIG = ROBOT_CONFIG; 