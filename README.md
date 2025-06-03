# ESP32 Control Server 🚀

A simple, clean, and powerful Node.js server for controlling ESP32 microcontrollers using the ShipFast boilerplate principles. This server provides real-time communication with ESP32 devices via WebSocket and comprehensive REST API endpoints for GPIO, PWM, ADC, and sensor control.

## 🌟 Features

### ESP32 Control Capabilities
- **GPIO Control**: Digital input/output pin management
- **PWM Output**: Advanced PWM control with up to 16 channels (LEDC)
- **ADC Reading**: 12-bit analog input with voltage conversion
- **Sensor Integration**: Real-time sensor data collection
- **Touch Sensing**: Capacitive touch pin monitoring
- **Device Management**: Multi-device registry and monitoring

### Communication Features
- **WebSocket**: Real-time bidirectional communication
- **REST API**: Comprehensive HTTP endpoints
- **Device Registry**: Automatic ESP32 device discovery and management
- **Health Monitoring**: Automatic stale device cleanup
- **Command Tracking**: Unique command ID system with response tracking

### Built-in ESP32 Support
- **Pin Mapping**: Complete ESP32 GPIO pin configuration
- **Hardware Validation**: Pin capability validation (GPIO, PWM, ADC, Touch)
- **Error Handling**: Comprehensive error responses with helpful messages
- **Status Monitoring**: Device uptime, memory usage, WiFi signal strength

## 🔧 ESP32 Pin Configuration

### Digital GPIO Pins
**Available pins**: 0, 1, 2, 3, 4, 5, 12, 13, 14, 15, 16, 17, 18, 19, 21, 22, 23, 25, 26, 27, 32, 33

### PWM Capable Pins (LEDC)
**All digital GPIO pins support PWM** with up to 16 channels
- **Resolution**: 1-16 bits (configurable)
- **Frequency**: 1 Hz to 40 MHz
- **Channels**: 0-15 (auto-assigned or manual)

### ADC Pins (Analog Input)
**ADC1**: 32, 33, 34, 35, 36, 37, 38, 39 *(recommended)*
**ADC2**: 0, 2, 4, 12, 13, 14, 15, 25, 26, 27 *(avoid when using WiFi)*

### Touch Sensor Pins
**Available pins**: 0, 2, 4, 12, 13, 14, 15, 27, 32, 33

### Reserved Pins (Avoid)
**Pins 6-11**: Connected to SPI flash memory

## 🚀 Quick Start

### 1. Installation
```bash
# Clone the repository
git clone <repository-url>
cd esp32-server

# Install dependencies
npm install

# Start the server
npm start
```

### 2. Server Endpoints
- **HTTP Server**: `http://localhost:8080`
- **WebSocket Server**: `ws://localhost:8081`
- **Health Check**: `http://localhost:8080/health`
- **Device Management**: `http://localhost:8080/api/esp32/devices`

## 📡 API Reference

### Device Management

#### Get All Connected Devices
```http
GET /api/esp32/devices
```

#### Get Device Status
```http
GET /api/esp32/status/{deviceId}
```

### GPIO Control

#### Set GPIO Pin State
```http
POST /api/esp32/gpio/{deviceId}
Content-Type: application/json

{
  "pin": 2,
  "state": 1,
  "mode": "OUTPUT"
}
```

**Parameters:**
- `pin`: GPIO pin number (0-33)
- `state`: Pin state (0, 1, true, false)
- `mode`: Pin mode ("INPUT", "OUTPUT", "INPUT_PULLUP", "INPUT_PULLDOWN")

### PWM Control

#### Set PWM Output
```http
POST /api/esp32/pwm/{deviceId}
Content-Type: application/json

{
  "pin": 2,
  "dutyCycle": 128,
  "frequency": 1000,
  "resolution": 8,
  "channel": 0
}
```

**Parameters:**
- `pin`: PWM capable pin number
- `dutyCycle`: Duty cycle value (0 to 2^resolution - 1)
- `frequency`: PWM frequency (1 Hz to 40 MHz)
- `resolution`: PWM resolution (1-16 bits)
- `channel`: LEDC channel (0-15, optional)

#### Stop PWM Output
```http
POST /api/esp32/pwm/{deviceId}/stop
Content-Type: application/json

{
  "pin": 2,
  "channel": 0
}
```

### Analog Reading

#### Read ADC Pin
```http
GET /api/esp32/analog/{deviceId}/{pin}
```

### Sensor Data

#### Get All Sensor Readings
```http
GET /api/esp32/sensors/{deviceId}
```

### Custom Commands

#### Send Custom Command
```http
POST /api/esp32/command/{deviceId}
Content-Type: application/json

{
  "type": "custom_command",
  "data": {
    "command": "your_custom_command",
    "parameters": {}
  }
}
```

### ESP32 Capabilities

#### Get Pin Configuration and Features
```http
GET /api/esp32/capabilities
```

## 🔌 WebSocket Communication

### ESP32 Device Registration
```javascript
// ESP32 sends registration message
{
  "type": "register",
  "deviceId": "ESP32_001",
  "data": {
    "capabilities": {
      "gpio": true,
      "pwm": true,
      "adc": true,
      "touch": true
    },
    "boardType": "ESP32-WROOM-32",
    "firmwareVersion": "1.0.0"
  }
}
```

### Status Updates
```javascript
// ESP32 sends periodic status updates
{
  "type": "status_update",
  "deviceId": "ESP32_001",
  "data": {
    "status": "connected",
    "uptime": 12345,
    "freeHeap": 180000,
    "wifiSignal": -45,
    "sensors": {
      "temperature": 25.6,
      "humidity": 60.2
    }
  }
}
```

### Command Response
```javascript
// ESP32 responds to server commands
{
  "id": "command_id_123",
  "success": true,
  "data": {
    "pin": 2,
    "state": 1
  }
}
```

## 🛠️ ESP32 Arduino Code Example

Here's a basic ESP32 Arduino sketch to connect to the server:

```cpp
#include <WiFi.h>
#include <WebSocketsClient.h>
#include <ArduinoJson.h>

const char* ssid = "your_wifi_ssid";
const char* password = "your_wifi_password";
const char* websocket_server = "192.168.1.100";
const int websocket_port = 8081;

WebSocketsClient webSocket;
String deviceId = "ESP32_001";

void setup() {
  Serial.begin(115200);
  
  // Connect to WiFi
  WiFi.begin(ssid, password);
  while (WiFi.status() != WL_CONNECTED) {
    delay(1000);
    Serial.println("Connecting to WiFi...");
  }
  
  // Initialize WebSocket
  webSocket.begin(websocket_server, websocket_port, "/");
  webSocket.onEvent(webSocketEvent);
  webSocket.setReconnectInterval(5000);
  
  // Register device
  registerDevice();
}

void loop() {
  webSocket.loop();
  
  // Send heartbeat every 30 seconds
  static unsigned long lastHeartbeat = 0;
  if (millis() - lastHeartbeat > 30000) {
    sendHeartbeat();
    lastHeartbeat = millis();
  }
}

void webSocketEvent(WStype_t type, uint8_t * payload, size_t length) {
  switch(type) {
    case WStype_CONNECTED:
      Serial.println("Connected to server");
      registerDevice();
      break;
      
    case WStype_TEXT:
      handleCommand((char*)payload);
      break;
      
    case WStype_DISCONNECTED:
      Serial.println("Disconnected from server");
      break;
  }
}

void registerDevice() {
  DynamicJsonDocument doc(1024);
  doc["type"] = "register";
  doc["deviceId"] = deviceId;
  doc["data"]["capabilities"]["gpio"] = true;
  doc["data"]["capabilities"]["pwm"] = true;
  doc["data"]["capabilities"]["adc"] = true;
  doc["data"]["boardType"] = "ESP32-WROOM-32";
  
  String message;
  serializeJson(doc, message);
  webSocket.sendTXT(message);
}

void handleCommand(String payload) {
  DynamicJsonDocument doc(1024);
  deserializeJson(doc, payload);
  
  if (doc["type"] == "command") {
    String commandId = doc["id"];
    JsonObject command = doc["command"];
    
    // Handle different command types
    if (command["type"] == "gpio") {
      handleGpioCommand(command, commandId);
    } else if (command["type"] == "pwm") {
      handlePwmCommand(command, commandId);
    } else if (command["type"] == "adc_read") {
      handleAdcCommand(command, commandId);
    }
  }
}

void handleGpioCommand(JsonObject command, String commandId) {
  int pin = command["pin"];
  String mode = command["mode"];
  
  if (mode == "OUTPUT") {
    pinMode(pin, OUTPUT);
    if (command.containsKey("state")) {
      digitalWrite(pin, command["state"]);
    }
  } else if (mode == "INPUT") {
    pinMode(pin, INPUT);
  }
  
  // Send response
  sendCommandResponse(commandId, true, "GPIO command executed");
}

void sendCommandResponse(String commandId, bool success, String message) {
  DynamicJsonDocument doc(512);
  doc["id"] = commandId;
  doc["success"] = success;
  doc["message"] = message;
  
  String response;
  serializeJson(doc, response);
  webSocket.sendTXT(response);
}
```

## 📊 Monitoring and Health

### Device Health Monitoring
- **Automatic Cleanup**: Removes stale devices after 1 minute of inactivity
- **Heartbeat System**: Keep-alive mechanism for connected devices
- **Connection Status**: Real-time device connection monitoring
- **Memory Monitoring**: Track ESP32 free heap memory
- **WiFi Signal**: Monitor WiFi signal strength

### Error Handling
- **Comprehensive Validation**: Pin capability and parameter validation
- **Helpful Error Messages**: Clear error descriptions with valid options
- **Graceful Degradation**: Server continues operating even if devices disconnect
- **Command Timeout**: 5-second timeout for ESP32 command responses

## 🔧 Configuration

### Environment Variables
Create a `.env` file:
```env
NODE_ENV=development
PORT=8080
WS_PORT=8081
```

### Server Configuration
- **HTTP Port**: Default 8080 (configurable via PORT env var)
- **WebSocket Port**: Default 8081 (configurable via WS_PORT env var)
- **CORS**: Enabled for all origins
- **JSON Limit**: 10MB request body limit

## 🚦 Development

### Running in Development Mode
```bash
npm run dev  # Uses nodemon for auto-restart
```

### Testing the Server
1. Start the server: `npm start`
2. Check health: `curl http://localhost:8080/health`
3. View capabilities: `curl http://localhost:8080/api/esp32/capabilities`
4. Monitor devices: `curl http://localhost:8080/api/esp32/devices`

## 📝 Project Structure

```
esp32-server/
├── routes/
│   ├── api-routes.js      # General API routes
│   ├── health-routes.js   # Health check endpoints
│   └── esp32-routes.js    # ESP32 specific routes
├── public/                # Static files (web interface)
├── server.js             # Main server file
├── package.json          # Dependencies and scripts
└── README.md            # This file
```

## 🤝 Contributing

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## 📄 License

This project is licensed under the MIT License - see the LICENSE file for details.

## 🙏 Acknowledgments

- Built with **ShipFast** principles for clean, simple, and readable code
- Designed for **ESP32** microcontroller ecosystem
- Inspired by modern IoT development practices

---

**Ready to control your ESP32 devices!** 🎛️✨ 