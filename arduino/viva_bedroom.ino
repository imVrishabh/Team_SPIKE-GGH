/*
  VIVA bedroom LED controller

  Wiring (Arduino Uno):
  - Arduino D7 -> 220–330 ohm resistor -> LED anode
  - LED cathode -> Arduino GND
  - HC-05 Bluetooth module:
      HC-05 TX -> Arduino D11 (SoftwareSerial RX)
      HC-05 RX -> Arduino D10 (SoftwareSerial TX)
      HC-05 VCC -> Arduino 5V
      HC-05 GND -> Arduino GND

  Commands accepted over USB and Bluetooth serial:
  - LIGHT_ON
  - LIGHT_OFF
  - STATUS

  Commands must end with newline. The sketch replies with status strings such as:
  - OK:LIGHT_ON
  - OK:LIGHT_OFF
  - STATUS:ON
  - STATUS:OFF
  - UNKNOWN

  This sketch uses SoftwareSerial for Bluetooth to avoid conflicts with the USB serial monitor.
*/

#include <SoftwareSerial.h>

const int LED_PIN = 7;
const int BT_RX_PIN = 10;
const int BT_TX_PIN = 11;

SoftwareSerial btSerial(BT_RX_PIN, BT_TX_PIN);

String readSerial(Stream &serialPort) {
  String incoming = "";
  while (serialPort.available()) {
    char ch = serialPort.read();
    if (ch == '\n' || ch == '\r') {
      if (incoming.length() > 0) {
        break;
      }
      continue;
    }
    incoming += ch;
  }
  return incoming;
}

void processCommand(String command) {
  command.trim();
  if (command == "LIGHT_ON") {
    digitalWrite(LED_PIN, HIGH);
    Serial.println("OK:LIGHT_ON");
    btSerial.println("OK:LIGHT_ON");
  } else if (command == "LIGHT_OFF") {
    digitalWrite(LED_PIN, LOW);
    Serial.println("OK:LIGHT_OFF");
    btSerial.println("OK:LIGHT_OFF");
  } else if (command == "STATUS") {
    int state = digitalRead(LED_PIN) == HIGH ? 1 : 0;
    String statusText = state ? "STATUS:ON" : "STATUS:OFF";
    Serial.println(statusText);
    btSerial.println(statusText);
  } else {
    Serial.println("UNKNOWN");
    btSerial.println("UNKNOWN");
  }
}

void setup() {
  pinMode(LED_PIN, OUTPUT);
  digitalWrite(LED_PIN, LOW);

  Serial.begin(9600);
  btSerial.begin(9600);

  Serial.println("VIVA: ready");
  btSerial.println("VIVA: ready");
}

void loop() {
  if (Serial.available()) {
    String command = readSerial(Serial);
    if (command.length() > 0) {
      processCommand(command);
    }
  }

  if (btSerial.available()) {
    String command = readSerial(btSerial);
    if (command.length() > 0) {
      processCommand(command);
    }
  }
}
