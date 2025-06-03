# Server Pi 🚀

A clean, simple, and modular Node.js server built with ShipFast principles, featuring **Raspberry Pi PWM control** with a beautiful web interface.

## Features

- ✅ **Clean Architecture**: Modular route structure
- ✅ **Security**: Helmet middleware for security headers
- ✅ **CORS**: Cross-origin resource sharing enabled
- ✅ **Logging**: Morgan middleware for request logging
- ✅ **Error Handling**: Comprehensive error handling
- ✅ **Health Checks**: Multiple health check endpoints
- ✅ **Documentation**: Well-commented code throughout
- 🆕 **PWM Control**: Full Raspberry Pi GPIO PWM control
- 🆕 **Web Interface**: Beautiful HTML control panel
- 🆕 **Real-time Updates**: Live status monitoring

## Quick Start

### 1. Install Dependencies

```bash
npm install
```

### 2. Environment Setup

Create a `.env` file in the root directory:

```env
# Server Configuration
PORT=3001
NODE_ENV=development

# Frontend Configuration
FRONTEND_URL=http://localhost:3000
```

### 3. Start the Server

For development (with auto-restart):
```bash
npm run dev
```

For production:
```bash
npm start
```

### 4. Access the PWM Control Interface

Open your browser and go to: **http://localhost:3001/index.html**

## Available Endpoints

### Root Endpoints
- `GET /` - Welcome message and server info
- `GET /health` - Basic health check
- `GET /health/detailed` - Detailed health information
- `GET /health/ready` - Readiness check for load balancers
- `GET /health/live` - Liveness check for containers

### API Endpoints
- `GET /api` - API information and available endpoints
- `GET /api/users` - Get all users (mock data)
- `POST /api/users` - Create a new user
- `GET /api/data` - Get data with pagination and search
- `GET /api/test` - Test endpoint for development
- `POST /api/test` - POST test endpoint

### PWM Control Endpoints
- `GET /api/pwm/status` - Get PWM status and available pins
- `POST /api/pwm/set` - Set PWM signal (pin, dutyCycle, frequency)
- `POST /api/pwm/stop` - Stop PWM on specific pin
- `POST /api/pwm/stop-all` - Stop all PWM signals

### Web Interface
- `GET /index.html` - Beautiful PWM control interface

## PWM Control Features

### 🎛️ Web Interface
- **Pin Selection**: Choose from hardware PWM (12, 13, 18, 19) or software PWM pins
- **Duty Cycle Control**: Smooth slider with preset buttons (0%, 25%, 50%, 75%, 100%)
- **Frequency Selection**: Common frequencies from 50Hz (servo) to 8000Hz
- **Real-time Status**: Live monitoring of active pins and system status
- **Activity Log**: Color-coded logging of all PWM operations

### ⚙️ API Control
Control PWM signals programmatically:

```bash
# Set PWM on GPIO 18 at 50% duty cycle, 1000Hz
curl -X POST http://localhost:3001/api/pwm/set \
  -H "Content-Type: application/json" \
  -d '{"pin":18,"dutyCycle":128,"frequency":1000}'

# Stop PWM on GPIO 18
curl -X POST http://localhost:3001/api/pwm/stop \
  -H "Content-Type: application/json" \
  -d '{"pin":18}'

# Get status
curl http://localhost:3001/api/pwm/status
```

### 🔧 Hardware Support
- **Hardware PWM**: Pins 12, 13, 18, 19 (recommended for precision)
- **Software PWM**: All available GPIO pins
- **Automatic Detection**: Works on Raspberry Pi with pigpio, simulation mode elsewhere
- **Graceful Cleanup**: Proper GPIO cleanup on server shutdown

## Project Structure

```
server_pi/
├── routes/
│   ├── api-routes.js      # Main API endpoints
│   ├── health-routes.js   # Health check endpoints
│   └── pwm-routes.js      # PWM control endpoints
├── public/
│   └── index.html         # PWM control web interface
├── server.js              # Main server file
├── package.json           # Dependencies and scripts
└── README.md             # This file
```

## Raspberry Pi Setup

### Prerequisites
1. **Raspberry Pi 4 Model B** (or any compatible Pi)
2. **pigpio daemon** for GPIO access

### Installation on Raspberry Pi
```bash
# Install pigpio daemon
sudo apt-get update
sudo apt-get install pigpio

# Start pigpio daemon (required for GPIO access)
sudo pigpiod

# Clone and setup the server
git clone <your-repo>
cd server_pi
npm install
npm start
```

### GPIO Pin Reference (Pi 4)
| GPIO | Physical Pin | Type | Description |
|------|--------------|------|-------------|
| 12   | 32          | HW   | Hardware PWM (recommended) |
| 13   | 33          | HW   | Hardware PWM (recommended) |
| 18   | 12          | HW   | Hardware PWM (recommended) |
| 19   | 35          | HW   | Hardware PWM (recommended) |
| 2-27 | Various     | SW   | Software PWM (flexible) |

## Testing the Server

### Using the Web Interface (Recommended)
1. Open: `http://localhost:3001/index.html`
2. Select a GPIO pin (start with hardware PWM pins)
3. Adjust duty cycle with slider or preset buttons
4. Set frequency as needed
5. Click "Set PWM" to activate
6. Monitor real-time status in the interface

### Using curl
```bash
# Test server
curl http://localhost:3001

# Test PWM status
curl http://localhost:3001/api/pwm/status

# Set PWM (50% duty cycle at 1kHz on GPIO 18)
curl -X POST http://localhost:3001/api/pwm/set \
  -H "Content-Type: application/json" \
  -d '{"pin":18,"dutyCycle":128,"frequency":1000,"enabled":true}'
```

## Development Guidelines

This server follows ShipFast principles:

1. **Keep it Simple**: Clean, readable code over complexity
2. **Modular Design**: Each route module handles specific functionality
3. **Comprehensive Comments**: Every section is well-documented
4. **Error Handling**: Proper error responses for all scenarios
5. **Security First**: Helmet and CORS configured for production use
6. **Graceful Cleanup**: Proper GPIO cleanup on shutdown

## Common Use Cases

### Servo Control
```javascript
// 50Hz for standard servos
// Duty cycle 2.5-12.5% for 0-180° range
fetch('/api/pwm/set', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    pin: 18,
    frequency: 50,
    dutyCycle: 13  // ~5% for 90° position
  })
});
```

### LED Brightness Control
```javascript
// High frequency for smooth LED dimming
fetch('/api/pwm/set', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    pin: 18,
    frequency: 1000,
    dutyCycle: 128  // 50% brightness
  })
});
```

### Motor Speed Control
```javascript
// Medium frequency for motor control
fetch('/api/pwm/set', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    pin: 18,
    frequency: 500,
    dutyCycle: 191  // 75% speed
  })
});
```

## Troubleshooting

### pigpio Issues
```bash
# Check if pigpiod is running
sudo systemctl status pigpiod

# Start pigpiod manually
sudo pigpiod

# Check permissions
sudo usermod -a -G gpio $USER
```

### Common Errors
- **"pigpio not available"**: Normal when not on Raspberry Pi (simulation mode)
- **"Permission denied"**: Ensure pigpiod is running and user has GPIO permissions
- **"Pin already in use"**: Stop existing PWM before reassigning pins

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `PORT` | Server port | `3001` |
| `NODE_ENV` | Environment | `development` |
| `FRONTEND_URL` | Frontend URL for CORS | `http://localhost:3000` |

## Contributing

When adding new features:
1. Keep files under 200 lines
2. Add comprehensive comments
3. Follow the modular structure
4. Test your changes
5. Update this README if needed

---

Built with ❤️ using ShipFast principles for Raspberry Pi PWM control 