// Health check routes module
// Used for monitoring server status and uptime

const express = require('express');
const router = express.Router();

// ==============================================
// HEALTH CHECK ENDPOINTS
// ==============================================

// Basic health check - returns server status
router.get('/', (req, res) => {
  res.status(200).json({
    status: 'healthy',
    message: 'Server is running perfectly! ✅',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    memory: process.memoryUsage(),
    version: process.version
  });
});

// Detailed health check - includes system information
router.get('/detailed', (req, res) => {
  res.status(200).json({
    status: 'healthy',
    server: {
      name: 'Server Pi',
      version: '1.0.0',
      environment: process.env.NODE_ENV || 'development',
      uptime: process.uptime(),
      timestamp: new Date().toISOString()
    },
    system: {
      nodeVersion: process.version,
      platform: process.platform,
      architecture: process.arch,
      memory: process.memoryUsage(),
      cpu: process.cpuUsage()
    }
  });
});

// Ready check - for load balancers and orchestrators
router.get('/ready', (req, res) => {
  // Add any database or external service checks here
  const isReady = true; // Replace with actual readiness checks
  
  if (isReady) {
    res.status(200).json({
      status: 'ready',
      message: 'Server is ready to accept requests',
      timestamp: new Date().toISOString()
    });
  } else {
    res.status(503).json({
      status: 'not ready',
      message: 'Server is not ready to accept requests',
      timestamp: new Date().toISOString()
    });
  }
});

// Liveness check - for container orchestrators
router.get('/live', (req, res) => {
  res.status(200).json({
    status: 'alive',
    message: 'Server is alive and responding',
    timestamp: new Date().toISOString()
  });
});

module.exports = router; 