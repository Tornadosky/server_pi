// Load environment variables from .env file
require('dotenv').config();

// Import required packages
const express = require('express');
const cors = require('cors');
const morgan = require('morgan');
const path = require('path');
const http = require('http');
const WebSocket = require('ws');
const axios = require('axios');

// Import route modules (modular approach)
const apiRoutes = require('./routes/api-routes');
const healthRoutes = require('./routes/health-routes');
const esp32Routes = require('./routes/esp32-routes');

// Create Express application instance
const app = express();

// Server configuration
const PORT = process.env.PORT || 8080;
const WS_PORT = process.env.WS_PORT || 8081;

// ESP32 device registry - stores connected ESP32 devices
const connectedDevices = new Map();

// ==============================================
// MIDDLEWARE SETUP
// ==============================================

// CORS middleware - enables cross-origin requests
app.use(cors({
  origin: true, // Allow all origins
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Device-ID']
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

// Add device registry to request object for routes
app.use((req, res, next) => {
  req.connectedDevices = connectedDevices;
  next();
});

// ==============================================
// ROUTE SETUP (Modular routing)
// ==============================================

// Health check routes - for monitoring server status
app.use('/health', healthRoutes);

// API routes - main application endpoints
app.use('/api', apiRoutes);

// ESP32 control routes - microcontroller GPIO and peripheral control
app.use('/api/esp32', esp32Routes);

// Root endpoint - simple welcome message
app.get('/', (req, res) => {
  const protocol = req.secure ? 'https' : 'http';
  const host = req.get('host');
  
  res.json({
    message: 'ESP32 Control Server is running successfully! 🚀',
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || 'development',
    features: {
      esp32Control: 'Available at /api/esp32',
      webInterface: `Available at ${protocol}://${host}/test.html`,
      healthCheck: 'Available at /health',
      websocket: `ws://${host.split(':')[0]}:${WS_PORT}`,
      deviceManagement: 'Real-time ESP32 device registry'
    },
    connectedDevices: connectedDevices.size,
    ssl: req.secure ? 'Secure HTTPS connection' : 'HTTP connection'
  });
});

// ==============================================
// WEBSOCKET SERVER SETUP
// ==============================================

// Create WebSocket server for real-time communication with ESP32 devices
const wss = new WebSocket.Server({ port: WS_PORT });

console.log(`🔌 WebSocket server started on port ${WS_PORT}`);

// Handle WebSocket connections
wss.on('connection', (ws, req) => {
  console.log('📱 New WebSocket connection established');
  
  // Handle incoming messages from ESP32 devices
  ws.on('message', (data) => {
    try {
      const message = JSON.parse(data.toString());
      handleESP32Message(ws, message);
    } catch (error) {
      console.error('❌ Invalid JSON received:', error);
      ws.send(JSON.stringify({
        type: 'error',
        message: 'Invalid JSON format'
      }));
    }
  });

  // Handle connection close
  ws.on('close', () => {
    // Remove device from registry if it was registered
    for (const [deviceId, device] of connectedDevices.entries()) {
      if (device.websocket === ws) {
        connectedDevices.delete(deviceId);
        console.log(`📱 ESP32 device ${deviceId} disconnected`);
        break;
      }
    }
  });

  // Send welcome message
  ws.send(JSON.stringify({
    type: 'welcome',
    message: 'Connected to ESP32 Control Server',
    timestamp: new Date().toISOString()
  }));
});

// Handle messages from ESP32 devices
function handleESP32Message(ws, message) {
  const { type, deviceId, data } = message;

  switch (type) {
    case 'register':
      // Register new ESP32 device
      if (!deviceId) {
        ws.send(JSON.stringify({
          type: 'error',
          message: 'Device ID required for registration'
        }));
        return;
      }

      const deviceInfo = {
        id: deviceId,
        websocket: ws,
        lastSeen: new Date(),
        capabilities: data?.capabilities || {},
        status: 'connected',
        ...data
      };

      connectedDevices.set(deviceId, deviceInfo);
      console.log(`✅ ESP32 device registered: ${deviceId}`);

      ws.send(JSON.stringify({
        type: 'registered',
        deviceId: deviceId,
        message: 'Device registered successfully'
      }));
      break;

    case 'status_update':
      // Update device status
      if (connectedDevices.has(deviceId)) {
        const device = connectedDevices.get(deviceId);
        device.lastSeen = new Date();
        device.status = data?.status || 'connected';
        device.sensorData = data?.sensors || {};
        
        console.log(`📊 Status update from ${deviceId}:`, data);
      }
      break;

    case 'heartbeat':
      // Keep connection alive
      if (connectedDevices.has(deviceId)) {
        connectedDevices.get(deviceId).lastSeen = new Date();
      }
      
      ws.send(JSON.stringify({
        type: 'heartbeat_ack',
        timestamp: new Date().toISOString()
      }));
      break;

    default:
      console.log(`❓ Unknown message type from ESP32: ${type}`);
  }
}

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
      'GET /api/esp32/devices',
      'GET /api/esp32/status/{deviceId}',
      'POST /api/esp32/gpio/{deviceId}',
      'POST /api/esp32/pwm/{deviceId}',
      'POST /api/esp32/command/{deviceId}'
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
// SERVER STARTUP
// ==============================================

// Create HTTP server
const httpServer = http.createServer(app);

// Start HTTP server
httpServer.listen(PORT, '0.0.0.0', () => {
  console.log(`🌐 HTTP Server running on port ${PORT}`);
  console.log(`🎛️  ESP32 Control Interface: http://localhost:${PORT}/test.html`);
});

// Store servers for cleanup
global.servers = { httpServer, wss };

console.log(`🚀 ESP32 Control Server is running!`);
console.log(`📝 Environment: ${process.env.NODE_ENV || 'development'}`);
console.log(`⚡ Ready to communicate with ESP32 devices!`);
console.log(`💡 WebSocket endpoint: ws://localhost:${WS_PORT}`);
console.log(`🔗 Device management: http://localhost:${PORT}/api/esp32/devices`);

// ==============================================
// DEVICE HEALTH MONITORING
// ==============================================

// Periodic cleanup of stale devices (every 30 seconds)
setInterval(() => {
  const now = new Date();
  const staleThreshold = 60000; // 1 minute

  for (const [deviceId, device] of connectedDevices.entries()) {
    if (now - device.lastSeen > staleThreshold) {
      console.log(`🗑️  Removing stale device: ${deviceId}`);
      connectedDevices.delete(deviceId);
    }
  }
}, 30000);

// ==============================================
// GRACEFUL SHUTDOWN HANDLING
// ==============================================

// Cleanup function for graceful shutdown
function gracefulShutdown(signal) {
  console.log(`👋 ${signal} received, shutting down gracefully...`);
  
  const servers = global.servers || {};
  const serverPromises = [];
  
  // Close WebSocket server
  if (servers.wss) {
    servers.wss.close(() => {
      console.log('🔌 WebSocket server closed');
    });
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

// Export device registry for testing
module.exports = { connectedDevices }; 