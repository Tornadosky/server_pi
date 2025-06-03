// Load environment variables from .env file
require('dotenv').config();

// Import required packages
const express = require('express');
const cors = require('cors');
const morgan = require('morgan');
const path = require('path');
const http = require('http');
const fs = require('fs');

// Import route modules (modular approach)
const apiRoutes = require('./routes/api-routes');
const healthRoutes = require('./routes/health-routes');
const pwmRoutes = require('./routes/pwm-routes');

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
      webInterface: `Available at ${protocol}://${host}/test.html`,
      healthCheck: 'Available at /health'
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
      'POST /api/pwm/stop-all'
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
// SERVER STARTUP (HTTP ONLY)
// ==============================================

// Create HTTP server
const httpServer = http.createServer(app);

// Start HTTP server
httpServer.listen(PORT, '0.0.0.0', () => {
  console.log(`🌐 HTTP Server running on port ${PORT}`);
  console.log(`🔗 PWM Test Page: http://192.168.0.12:${PORT}/test.html`);
});

// Store server for cleanup (HTTP-only mode)
global.servers = { httpServer };

console.log(`🚀 Server Pi is running in HTTP-only mode!`);
console.log(`📝 Environment: ${process.env.NODE_ENV || 'development'}`);
console.log(`⚡ Ready to handle requests from any device!`);
console.log(`💡 Access your PWM controller at: http://192.168.0.12:${PORT}/test.html`);

// ==============================================
// GRACEFUL SHUTDOWN HANDLING
// ==============================================

// Cleanup function for graceful shutdown
function gracefulShutdown(signal) {
  console.log(`👋 ${signal} received, shutting down gracefully...`);
  
  const servers = global.servers || {};
  const serverPromises = [];
  
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