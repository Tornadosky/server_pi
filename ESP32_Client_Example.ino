#include <WiFi.h>
#include <WebSocketsClient.h>
#include <ArduinoJson.h>

// Define LED_BUILTIN if not already defined (some ESP32 variants don't have it)
#ifndef LED_BUILTIN
#define LED_BUILTIN 2  // Most ESP32 boards have built-in LED on pin 2
#endif

// WiFi credentials - UPDATE THESE WITH YOUR NETWORK INFO
const char* ssid = "Futurenet";          // Your WiFi network name
const char* password = "smirnova1";  // Your WiFi password

// Server configuration - UPDATE WITH YOUR LAPTOP'S IP
const char* websocket_server = "192.168.0.171";  // Your laptop's IP address
const int websocket_port = 8081;

// Device configuration
String deviceId = "ESP32_Device_001";  // Unique device identifier

// Hardware configuration
const int PWM_PIN = 2;        // Default PWM pin (built-in LED on many ESP32s)
const int PWM_CHANNEL = 0;    // PWM channel (0-15)
const int PWM_FREQUENCY = 5000; // PWM frequency in Hz
const int PWM_RESOLUTION = 8;   // PWM resolution in bits (1-16)

// WebSocket client
WebSocketsClient webSocket;

// Status tracking
bool isConnected = false;
unsigned long lastHeartbeat = 0;
const unsigned long heartbeatInterval = 30000; // 30 seconds

void setup() {
  Serial.begin(115200);
  Serial.println("ESP32 Client Starting...");
  
  // Initialize built-in LED
  pinMode(LED_BUILTIN, OUTPUT);
  digitalWrite(LED_BUILTIN, LOW);
  
  // Initialize PWM with new API
  ledcAttach(PWM_PIN, PWM_FREQUENCY, PWM_RESOLUTION);
  
  // Connect to WiFi
  connectToWiFi();
  
  // Initialize WebSocket connection
  initWebSocket();
}

void loop() {
  webSocket.loop();
  
  // Send heartbeat periodically
  if (millis() - lastHeartbeat > heartbeatInterval) {
    sendHeartbeat();
    lastHeartbeat = millis();
  }
  
  // Blink status LED based on connection
  blinkStatusLED();
  
  delay(100);
}

void connectToWiFi() {
  Serial.print("Connecting to WiFi: ");
  Serial.println(ssid);
  
  WiFi.begin(ssid, password);
  
  while (WiFi.status() != WL_CONNECTED) {
    delay(1000);
    Serial.print(".");
  }
  
  Serial.println("");
  Serial.println("WiFi connected!");
  Serial.print("IP address: ");
  Serial.println(WiFi.localIP());
}

void initWebSocket() {
  // Configure WebSocket
  webSocket.begin(websocket_server, websocket_port, "/");
  
  // Set event handler
  webSocket.onEvent(webSocketEvent);
  
  // Set reconnect interval
  webSocket.setReconnectInterval(5000);
  
  Serial.println("WebSocket client initialized");
}

void webSocketEvent(WStype_t type, uint8_t * payload, size_t length) {
  switch(type) {
    case WStype_DISCONNECTED:
      Serial.println("WebSocket Disconnected");
      isConnected = false;
      break;
      
    case WStype_CONNECTED:
      Serial.printf("WebSocket Connected to: %s\n", payload);
      isConnected = true;
      registerDevice();
      break;
      
    case WStype_TEXT:
      Serial.printf("Received: %s\n", payload);
      handleMessage((char*)payload);
      break;
      
    case WStype_ERROR:
      Serial.printf("WebSocket Error: %s\n", payload);
      isConnected = false;
      break;
      
    default:
      break;
  }
}

void registerDevice() {
  DynamicJsonDocument doc(512);
  doc["type"] = "register";
  doc["deviceId"] = deviceId;
  doc["deviceType"] = "ESP32";
  doc["capabilities"] = "gpio,pwm,adc,sensor";
  doc["version"] = "1.0.0";
  
  String message;
  serializeJson(doc, message);
  webSocket.sendTXT(message);
  
  Serial.println("Device registration sent");
}

void sendHeartbeat() {
  if (!isConnected) return;
  
  DynamicJsonDocument doc(256);
  doc["type"] = "heartbeat";
  doc["deviceId"] = deviceId;
  doc["timestamp"] = millis();
  doc["freeHeap"] = ESP.getFreeHeap();
  doc["uptime"] = millis();
  
  String message;
  serializeJson(doc, message);
  webSocket.sendTXT(message);
  
  Serial.println("Heartbeat sent");
}

void handleMessage(String message) {
  DynamicJsonDocument doc(1024);
  DeserializationError error = deserializeJson(doc, message);
  
  if (error) {
    Serial.print("JSON parsing failed: ");
    Serial.println(error.c_str());
    return;
  }
  
  String type = doc["type"];
  String commandId = doc["id"] | doc["commandId"] | "";
  
  // Handle different message types
  if (type == "command") {
    // Handle nested command structure from server
    JsonObject command = doc["command"];
    String commandType = command["type"];
    
    if (commandType == "gpio") {
      handleGpioCommandFromServer(command, commandId);
    } else if (commandType == "pwm") {
      handlePwmCommandFromServer(command, commandId);
    } else if (commandType == "pwm_stop") {
      handlePwmStopCommandFromServer(command, commandId);
    } else if (commandType == "adc_read") {
      handleAdcCommandFromServer(command, commandId);
    } else {
      Serial.println("Unknown nested command type: " + commandType);
    }
  } else if (type == "gpio") {
    handleGpioCommand(doc.as<JsonObject>(), commandId);
  } else if (type == "pwm") {
    handlePwmCommand(doc.as<JsonObject>(), commandId);
  } else if (type == "pwm_stop") {
    handlePwmStopCommand(doc.as<JsonObject>(), commandId);
  } else if (type == "adc") {
    handleAdcCommand(doc.as<JsonObject>(), commandId);
  } else if (type == "status") {
    handleStatusRequest(commandId);
  } else if (type == "welcome" || type == "registered" || type == "heartbeat_ack") {
    // These are server info messages, just log them
    Serial.println("Server message: " + type);
  } else {
    Serial.println("Unknown command type: " + type);
  }
}

// New handlers for server command format
void handleGpioCommandFromServer(JsonObject cmd, String commandId) {
  int pin = cmd["pin"];
  String mode = cmd["mode"];
  int state = cmd["state"] | 0;
  
  Serial.printf("GPIO Command (Server) - Pin: %d, Mode: %s, State: %d\n", pin, mode.c_str(), state);
  
  if (mode == "OUTPUT") {
    pinMode(pin, OUTPUT);
    digitalWrite(pin, state);
    sendCommandResponse(commandId, true, "GPIO pin set successfully");
  } else if (mode == "INPUT") {
    pinMode(pin, INPUT);
    int reading = digitalRead(pin);
    sendCommandResponseWithData(commandId, true, "GPIO read successful", reading);
  } else {
    sendCommandResponse(commandId, false, "Invalid GPIO mode");
  }
}

void handlePwmCommandFromServer(JsonObject cmd, String commandId) {
  int pin = cmd["pin"];
  int frequency = cmd["frequency"] | 5000;
  int resolution = cmd["resolution"] | 8;
  int dutyCycle = cmd["dutyCycle"] | 0;
  
  Serial.printf("PWM Command (Server) - Pin: %d, Freq: %d, Duty: %d\n", 
                pin, frequency, dutyCycle);
  
  // Configure PWM with new API
  ledcAttach(pin, frequency, resolution);
  ledcWrite(pin, dutyCycle);
  
  sendCommandResponse(commandId, true, "PWM configured successfully");
}

void handlePwmStopCommandFromServer(JsonObject cmd, String commandId) {
  int pin = cmd["pin"];
  
  Serial.printf("PWM Stop Command (Server) - Pin: %d\n", pin);
  
  // Detach PWM with new API
  ledcDetach(pin);
  
  sendCommandResponse(commandId, true, "PWM stopped successfully");
}

void handleAdcCommandFromServer(JsonObject cmd, String commandId) {
  int pin = cmd["pin"];
  
  Serial.printf("ADC Command (Server) - Pin: %d\n", pin);
  
  int value = analogRead(pin);
  float voltage = (value * 3.3) / 4095.0;
  
  DynamicJsonDocument response(256);
  response["id"] = commandId;
  response["success"] = true;
  response["message"] = "ADC read successful";
  response["data"]["rawValue"] = value;
  response["data"]["voltage"] = voltage;
  
  String responseStr;
  serializeJson(response, responseStr);
  webSocket.sendTXT(responseStr);
}

// Helper functions for server command responses
void sendCommandResponse(String commandId, bool success, String message) {
  DynamicJsonDocument response(256);
  response["id"] = commandId;
  response["success"] = success;
  response["message"] = message;
  
  String responseStr;
  serializeJson(response, responseStr);
  webSocket.sendTXT(responseStr);
}

void sendCommandResponseWithData(String commandId, bool success, String message, int value) {
  DynamicJsonDocument response(256);
  response["id"] = commandId;
  response["success"] = success;
  response["message"] = message;
  response["data"]["value"] = value;
  
  String responseStr;
  serializeJson(response, responseStr);
  webSocket.sendTXT(responseStr);
}

void handleGpioCommand(JsonObject cmd, String commandId) {
  int pin = cmd["pin"];
  String mode = cmd["mode"];
  int value = cmd["value"] | 0;
  
  Serial.printf("GPIO Command - Pin: %d, Mode: %s, Value: %d\n", pin, mode.c_str(), value);
  
  if (mode == "output") {
    pinMode(pin, OUTPUT);
    digitalWrite(pin, value);
    sendResponse(commandId, "success", "GPIO pin set successfully");
  } else if (mode == "input") {
    pinMode(pin, INPUT);
    int reading = digitalRead(pin);
    
    DynamicJsonDocument response(256);
    response["commandId"] = commandId;
    response["status"] = "success";
    response["data"]["value"] = reading;
    
    String responseStr;
    serializeJson(response, responseStr);
    webSocket.sendTXT(responseStr);
  } else {
    sendResponse(commandId, "error", "Invalid GPIO mode");
  }
}

void handlePwmCommand(JsonObject cmd, String commandId) {
  int pin = cmd["pin"];
  int channel = cmd["channel"] | 0;
  int frequency = cmd["frequency"] | 5000;
  int resolution = cmd["resolution"] | 8;
  int dutyCycle = cmd["dutyCycle"] | 0;
  
  Serial.printf("PWM Command - Pin: %d, Channel: %d, Freq: %d, Duty: %d\n", 
                pin, channel, frequency, dutyCycle);
  
  // Configure PWM with new API
  ledcAttach(pin, frequency, resolution);
  ledcWrite(pin, dutyCycle);
  
  sendResponse(commandId, "success", "PWM configured successfully");
}

void handlePwmStopCommand(JsonObject cmd, String commandId) {
  int pin = cmd["pin"];
  
  Serial.printf("PWM Stop Command - Pin: %d\n", pin);
  
  // Detach PWM with new API
  ledcDetach(pin);
  
  sendResponse(commandId, "success", "PWM stopped successfully");
}

void handleAdcCommand(JsonObject cmd, String commandId) {
  int pin = cmd["pin"];
  
  Serial.printf("ADC Command - Pin: %d\n", pin);
  
  int value = analogRead(pin);
  
  DynamicJsonDocument response(256);
  response["commandId"] = commandId;
  response["status"] = "success";
  response["data"]["value"] = value;
  response["data"]["voltage"] = (value * 3.3) / 4095.0;
  
  String responseStr;
  serializeJson(response, responseStr);
  webSocket.sendTXT(responseStr);
}

void handleStatusRequest(String commandId) {
  DynamicJsonDocument response(512);
  response["commandId"] = commandId;
  response["status"] = "success";
  response["data"]["deviceId"] = deviceId;
  response["data"]["uptime"] = millis();
  response["data"]["freeHeap"] = ESP.getFreeHeap();
  response["data"]["wifiStrength"] = WiFi.RSSI();
  response["data"]["ipAddress"] = WiFi.localIP().toString();
  
  String responseStr;
  serializeJson(response, responseStr);
  webSocket.sendTXT(responseStr);
}

void sendResponse(String commandId, String status, String message) {
  DynamicJsonDocument response(256);
  response["commandId"] = commandId;
  response["status"] = status;
  response["message"] = message;
  
  String responseStr;
  serializeJson(response, responseStr);
  webSocket.sendTXT(responseStr);
}

void blinkStatusLED() {
  static unsigned long lastBlink = 0;
  static bool ledState = false;
  
  unsigned long interval = isConnected ? 2000 : 500; // Slow blink when connected, fast when disconnected
  
  if (millis() - lastBlink > interval) {
    ledState = !ledState;
    digitalWrite(LED_BUILTIN, ledState);
    lastBlink = millis();
  }
} 