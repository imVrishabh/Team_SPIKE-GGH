/*
  VIVA bedroom LED controller

  Arduino Uno wiring:
  - D7 -> 220-330 ohm resistor -> LED anode; LED cathode -> GND
  - HC-05 TXD -> D10 (SoftwareSerial RX)
  - D11 (SoftwareSerial TX) -> voltage divider -> HC-05 RXD
  - HC-05 VCC -> 5V; HC-05 GND -> GND

  USB Serial and HC-05 accept STATUS, LIGHT_ON, and LIGHT_OFF commands,
  each terminated by a newline. Replies are newline-terminated:
  OK STATUS ON/OFF, OK LIGHT_ON, OK LIGHT_OFF, or ERR UNKNOWN.
  SoftwareSerial keeps Bluetooth separate from USB Serial debugging.
*/

#include <SoftwareSerial.h>

const int LED_PIN = 7;
const int BT_RX_PIN = 10;
const int BT_TX_PIN = 11;

SoftwareSerial btSerial(BT_RX_PIN, BT_TX_PIN);
String usbCommand;
String bluetoothCommand;

bool readCommand(Stream &serialPort, String &buffer) {
  while (serialPort.available()) {
    char ch = (char)serialPort.read();
    if (ch == '\n') {
      buffer.trim();
      return buffer.length() > 0;
    }
    if (ch == '\r') continue;
    if (buffer.length() < 48) buffer += ch;
    else buffer = "";
  }
  return false;
}

void processCommand(String command, Stream &replyPort) {
  command.trim();
  if (command == "LIGHT_ON") {
    digitalWrite(LED_PIN, HIGH);
    replyPort.println("OK LIGHT_ON");
  } else if (command == "LIGHT_OFF") {
    digitalWrite(LED_PIN, LOW);
    replyPort.println("OK LIGHT_OFF");
  } else if (command == "STATUS") {
    replyPort.print("OK STATUS ");
    replyPort.println(digitalRead(LED_PIN) == HIGH ? "ON" : "OFF");
  } else {
    replyPort.println("ERR UNKNOWN");
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
  if (readCommand(Serial, usbCommand)) {
    processCommand(usbCommand, Serial);
    usbCommand = "";
  }
  if (readCommand(btSerial, bluetoothCommand)) {
    processCommand(bluetoothCommand, btSerial);
    bluetoothCommand = "";
  }
}
