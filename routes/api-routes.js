// API routes module
// Main application endpoints for business logic

const express = require('express');
const router = express.Router();

// ==============================================
// API ENDPOINTS
// ==============================================

// API root endpoint - provides API information
router.get('/', (req, res) => {
  res.json({
    message: 'Server Pi API v1.0 🚀',
    version: '1.0.0',
    endpoints: {
      users: '/api/users',
      data: '/api/data',
      test: '/api/test'
    },
    documentation: 'Add your API documentation URL here',
    timestamp: new Date().toISOString()
  });
});

// ==============================================
// EXAMPLE ENDPOINTS (Replace with your business logic)
// ==============================================

// Example users endpoint
router.get('/users', (req, res) => {
  // This is where you'd integrate with your database
  const mockUsers = [
    { id: 1, name: 'John Doe', email: 'john@example.com' },
    { id: 2, name: 'Jane Smith', email: 'jane@example.com' }
  ];

  res.json({
    success: true,
    data: mockUsers,
    count: mockUsers.length,
    timestamp: new Date().toISOString()
  });
});

// Example user creation endpoint
router.post('/users', (req, res) => {
  const { name, email } = req.body;

  // Basic validation
  if (!name || !email) {
    return res.status(400).json({
      success: false,
      error: 'Name and email are required',
      timestamp: new Date().toISOString()
    });
  }

  // Mock user creation response
  const newUser = {
    id: Date.now(), // Use proper ID generation in production
    name,
    email,
    createdAt: new Date().toISOString()
  };

  res.status(201).json({
    success: true,
    message: 'User created successfully',
    data: newUser,
    timestamp: new Date().toISOString()
  });
});

// Example data endpoint with query parameters
router.get('/data', (req, res) => {
  const { limit = 10, offset = 0, search } = req.query;

  // Mock data response
  const mockData = Array.from({ length: parseInt(limit) }, (_, index) => ({
    id: parseInt(offset) + index + 1,
    title: `Data Item ${parseInt(offset) + index + 1}`,
    description: `This is a sample data item ${search ? `matching "${search}"` : ''}`,
    createdAt: new Date().toISOString()
  }));

  res.json({
    success: true,
    data: mockData,
    pagination: {
      limit: parseInt(limit),
      offset: parseInt(offset),
      total: 100 // Mock total count
    },
    timestamp: new Date().toISOString()
  });
});

// Test endpoint for development
router.get('/test', (req, res) => {
  res.json({
    success: true,
    message: 'API test endpoint is working! ✅',
    request: {
      method: req.method,
      url: req.originalUrl,
      headers: req.headers,
      query: req.query
    },
    server: {
      nodeVersion: process.version,
      environment: process.env.NODE_ENV || 'development',
      uptime: process.uptime()
    },
    timestamp: new Date().toISOString()
  });
});

// Example POST endpoint for testing
router.post('/test', (req, res) => {
  res.json({
    success: true,
    message: 'POST test successful! ✅',
    receivedData: req.body,
    timestamp: new Date().toISOString()
  });
});

module.exports = router; 