// Load environment variables from .env file
require('dotenv').config();

// Import required packages
const express = require('express');
const cors = require('cors');
const morgan = require('morgan');
const path = require('path');
const http = require('http');
const fs = require('fs');
const { Server } = require('socket.io'); // Add Socket.IO import

// Import route modules (modular approach)
const apiRoutes = require('./routes/api-routes');
const healthRoutes = require('./routes/health-routes');
const pwmRoutes = require('./routes/pwm-routes');
const robotRoutes = require('./routes/robot-routes'); // Add robot routes
const sensorRoutes = require('./routes/sensor-routes'); // Add sensor routes
const rpmControlRoutes = require('./routes/rpm-control-routes'); // Add RPM control routes

// Create Express application instance
const app = express();

// Server configuration
const PORT = process.env.PORT || 8080; // Changed from 3001 to 8080

// ==============================================
// MIDDLEWARE SETUP
// ==============================================

// CORS middleware - enables cross-origin requests
app.use(cors({
  origin: true, // Allow all origins
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

// Request logging middleware for development
if (process.env.NODE_ENV !== 'production') {
  app.use(morgan('dev'));
}

// Parse JSON request bodies
app.use(express.json({ limit: '10mb' }));

// Parse URL-encoded request bodies
app.use(express.urlencoded({ extended: true }));

// Serve static files from public directory
app.use(express.static(path.join(__dirname, 'public')));

// ==============================================
// ROUTE SETUP (Modular routing)
// ==============================================

// Health check routes - for monitoring server status
app.use('/health', healthRoutes);

// API routes - main application endpoints
app.use('/api', apiRoutes);

// PWM control routes - Raspberry Pi GPIO PWM control
app.use('/api/pwm', pwmRoutes);

// Robot control routes - 4-wheel robot speed management
app.use('/api/robot', robotRoutes);

// Sensor routes - GPIO input monitoring for wheel encoders
app.use('/api/sensors', sensorRoutes.router);

// RPM control routes - Server-side closed-loop RPM control
app.use('/api/rpm-control', rpmControlRoutes.router);

// Root endpoint - simple welcome message
app.get('/', (req, res) => {
  const protocol = req.secure ? 'https' : 'http';
  const host = req.get('host');
  
  res.json({
    message: 'Server Pi is running successfully! 🚀',
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || 'development',
    features: {
      pwmControl: 'Available at /api/pwm',
      robotControl: 'Available at /api/robot',
      webInterface: `Available at ${protocol}://${host}/test.html`,
      robotDashboard: `Available at ${protocol}://${host}/robot.html`,
      healthCheck: 'Available at /health',
      websocket: 'Real-time updates via Socket.IO'
    },
    ssl: req.secure ? 'Secure HTTPS connection' : 'HTTP connection'
  });
});

// ==============================================
// ERROR HANDLING MIDDLEWARE
// ==============================================

// Handle 404 errors - route not found
app.use('*', (req, res) => {
  res.status(404).json({
    error: 'Route not found',
    message: `The endpoint ${req.originalUrl} does not exist`,
    availableEndpoints: [
      'GET /',
      'GET /health',
      'GET /api',
      'GET /api/pwm/status',
      'POST /api/pwm/set',
      'POST /api/pwm/stop',
      'POST /api/pwm/stop-all',
      'GET /api/robot/status',
      'POST /api/robot/speed',
      'POST /api/robot/wheel',
      'POST /api/robot/stop',
      'POST /api/robot/reset-adjustments'
    ]
  });
});

// Global error handler - catches all errors
app.use((error, req, res, next) => {
  console.error('Server Error:', error);
  
  res.status(error.status || 500).json({
    error: 'Internal Server Error',
    message: process.env.NODE_ENV === 'production' 
      ? 'Something went wrong on our end' 
      : error.message,
    timestamp: new Date().toISOString()
  });
});

// ==============================================
// SERVER STARTUP (HTTP + WebSocket)
// ==============================================

// Create HTTP server
const httpServer = http.createServer(app);

// Initialize Socket.IO server
const io = new Server(httpServer, {
  cors: {
    origin: true,
    methods: ["GET", "POST"],
    credentials: true
  }
});

// WebSocket connection handling
io.on('connection', (socket) => {
  console.log(`🔌 WebSocket client connected: ${socket.id}`);
  
  // Send current robot state to newly connected client
  const { robotState } = require('./routes/robot-routes');
  socket.emit('robotUpdate', {
    type: 'initialState',
    robotState: robotState,
    timestamp: new Date().toISOString()
  });
  
  // Handle client disconnect
  socket.on('disconnect', () => {
    console.log(`❌ WebSocket client disconnected: ${socket.id}`);
  });
  
  // Handle real-time speed control from client
  socket.on('setRobotSpeed', async (data) => {
    console.log(`🎮 Real-time speed control: ${data.speed}% from ${socket.id}`);
    
    // Broadcast speed change to all other clients
    socket.broadcast.emit('robotUpdate', {
      type: 'speedChange',
      speed: data.speed,
      source: 'realtime',
      timestamp: new Date().toISOString()
    });
  });
  
  // Handle real-time wheel adjustment from client
  socket.on('setWheelAdjustment', async (data) => {
    console.log(`⚙️  Real-time wheel adjustment: ${data.wheel} ${data.adjustment}% from ${socket.id}`);
    
    // Broadcast wheel adjustment to all other clients
    socket.broadcast.emit('robotUpdate', {
      type: 'wheelAdjustment',
      wheel: data.wheel,
      adjustment: data.adjustment,
      source: 'realtime',
      timestamp: new Date().toISOString()
    });
  });
  
  // Handle real-time PWM control from client
  socket.on('setPWM', async (data) => {
    const { pin, dutyCycle, frequency = 1000 } = data;
    console.log(`🎛️  Real-time PWM control: GPIO ${pin} = ${dutyCycle} (${Math.round((dutyCycle/255)*100)}%) from ${socket.id}`);
    
    // Validate PWM data
    if (pin >= 0 && pin <= 27 && dutyCycle >= 0 && dutyCycle <= 255) {
      // Broadcast PWM update to all other clients for real-time sync
      socket.broadcast.emit('pwmUpdate', {
        pin: pin,
        dutyCycle: dutyCycle,
        frequency: frequency,
        source: 'realtime',
        timestamp: new Date().toISOString()
      });
    } else {
      console.log(`❌ Invalid PWM data from ${socket.id}: pin=${pin}, dutyCycle=${dutyCycle}`);
    }
  });
  
  // Handle emergency stop from WebSocket
  socket.on('emergencyStop', async () => {
    console.log(`🛑 Emergency stop triggered via WebSocket from ${socket.id}`);
    
    // Broadcast emergency stop to all clients
    io.emit('emergencyStop', {
      source: 'websocket',
      triggeredBy: socket.id,
      timestamp: new Date().toISOString()
    });
  });
});

// Set Socket.IO instance in robot routes for broadcasting
robotRoutes.setSocket(io);

// Set Socket.IO instance in sensor routes for real-time sensor updates
sensorRoutes.setSocket(io);

// Set Socket.IO instance and sensor routes reference in RPM control
rpmControlRoutes.setSocket(io);
rpmControlRoutes.setSensorRoutes(sensorRoutes);

// Start HTTP server with WebSocket support
httpServer.listen(PORT, '0.0.0.0', () => {
  console.log(`🌐 HTTP Server running on port ${PORT}`);
  console.log(`🔗 PWM Test Page: http://192.168.0.12:${PORT}/test.html`);
  console.log(`🤖 Robot Dashboard: http://192.168.0.12:${PORT}/robot.html`);
  console.log(`⚡ WebSocket server ready for real-time control!`);
});

// Store server for cleanup (HTTP + WebSocket)
global.servers = { httpServer, io };

console.log(`🚀 Server Pi is running with WebSocket support!`);
console.log(`📝 Environment: ${process.env.NODE_ENV || 'development'}`);
console.log(`⚡ Ready to handle requests from any device!`);
console.log(`💡 Access your PWM controller at: http://192.168.0.12:${PORT}/test.html`);
console.log(`🤖 Access your Robot Dashboard at: http://192.168.0.12:${PORT}/robot.html`);

// ==============================================
// GRACEFUL SHUTDOWN HANDLING
// ==============================================

// Cleanup function for graceful shutdown
function gracefulShutdown(signal) {
  console.log(`👋 ${signal} received, shutting down gracefully...`);
  
  const servers = global.servers || {};
  const serverPromises = [];
  
  // Close WebSocket connections
  if (servers.io) {
    console.log('🔌 Closing WebSocket connections...');
    servers.io.close();
  }
  
  // Close HTTP server
  if (servers.httpServer) {
    serverPromises.push(new Promise((resolve) => {
      servers.httpServer.close(() => {
        console.log('🔌 HTTP server closed');
        resolve();
      });
    }));
  }
  
  // Wait for all servers to close
  Promise.all(serverPromises).then(() => {
    // Cleanup PWM pins
    if (pwmRoutes.cleanup) {
      pwmRoutes.cleanup();
    }
    
    // Cleanup sensor monitoring
    if (sensorRoutes.cleanup) {
      sensorRoutes.cleanup();
    }
    
    // Cleanup RPM control
    if (rpmControlRoutes.cleanup) {
      rpmControlRoutes.cleanup();
    }
    
    console.log('✅ Cleanup completed');
    process.exit(0);
  });
  
  // Force close after 10 seconds
  setTimeout(() => {
    console.error('⚠️  Could not close connections in time, forcefully shutting down');
    process.exit(1);
  }, 10000);
}

// Handle different shutdown signals
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
  console.error('Uncaught Exception:', error);
  gracefulShutdown('UNCAUGHT_EXCEPTION');
});

// Handle unhandled promise rejections
process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
  gracefulShutdown('UNHANDLED_REJECTION');
}); 