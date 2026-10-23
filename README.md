# VIVA MVP

VIVA is a smart home companion that lets you control a bedroom LED, create reminders, use phone voice input, and optionally ask Gemini to describe a photo from your phone camera. It is designed for a quick hackathon build and is meant to run locally on a Windows laptop and Android phone.

## What VIVA does

- Understands natural-language commands such as "turn on the bedroom light"
- Controls an Arduino Uno LED over USB serial or HC-05 Bluetooth
- Creates and tracks reminders in SQLite using Asia/Kolkata time
- Speaks responses using browser speech synthesis
- Accepts voice commands in browsers that support Web Speech API
- Captures a snapshot from your phone camera and optionally describes it with Gemini
- Works in simulation mode when hardware is disconnected

## Setup on Windows

1. Install Python 3.11+ from python.org and ensure it is added to PATH.
2. Open a terminal in the project folder.
3. Create a virtual environment:
   `python -m venv .venv`
4. Activate it:
   `.venv\Scripts\activate`
5. Install dependencies:
   `pip install -r requirements.txt`
6. Copy `.env.example` to `.env` and fill in the values.
7. Start the app:
   `uvicorn app.main:app --host 0.0.0.0 --port 8000`
   or use the provided `run.bat` wrapper.
8. Open `http://localhost:8000/` in the browser on the laptop.

## Gemini API setup

1. Go to https://aistudio.google.com/
2. Create or sign in to a Google account.
3. Open Google AI Studio and create a Gemini API key.
4. Keep it in your local `.env` file only. Never store it in frontend JavaScript.
5. Use a supported free-tier model such as `gemini-2.0-flash` if it is available for your API key.
6. Check the Google AI Studio model list and quota page before assuming a model is available for free usage.

## Environment variables

- `GEMINI_API_KEY`: your Gemini key
- `GEMINI_MODEL`: use a free-tier model currently available to your key; current default is `gemini-3.8-flash` and should be verified in Google AI Studio
- `HARDWARE_MODE`: `simulation`, `usb`, or `bluetooth`
- `ARDUINO_PORT`: COM port for USB or paired HC-05 module
- `ARDUINO_BAUD`: default `9600`
- `REMINDER_DB_PATH`: path to the SQLite database
- `TIMEZONE`: default `Asia/Kolkata`

## Arduino wiring and upload

Use the sketch in `arduino/viva_bedroom.ino`.

- Arduino D7 -> 220–330 ohm resistor -> LED anode
- LED cathode -> Arduino GND
- USB serial: connect via the USB cable for the first working setup
- HC-05 Bluetooth: D10 and D11 are used for SoftwareSerial
  - HC-05 TX -> Arduino D11
  - HC-05 RX -> Arduino D10
  - HC-05 VCC -> Arduino 5V
  - HC-05 GND -> Arduino GND

Upload the sketch from Arduino IDE. In Windows, open Device Manager and note the COM port assigned to the Arduino.

## Testing USB serial

1. Set `HARDWARE_MODE=usb`
2. Set `ARDUINO_PORT` to the Arduino COM port, for example `COM3`
3. Start the app
4. Use the dashboard buttons or API to send `LIGHT_ON` and `LIGHT_OFF`
5. Verify the LED changes only after the Arduino acknowledges the command

## Switching to HC-05 Bluetooth

1. Pair the HC-05 to the laptop or phone.
2. Note the assigned Windows COM port from Bluetooth devices or Device Manager.
3. Set `HARDWARE_MODE=bluetooth`
4. Set `ARDUINO_PORT` to that COM port
5. Use 9600 baud
6. Do not claim a real LED change if the hardware is not connected or the port is unavailable

## Accessing the app from your Android phone

- Connect the laptop and phone to the same local Wi‑Fi or hotspot.
- Start the backend with `uvicorn app.main:app --host 0.0.0.0 --port 8000`.
- On the phone, open `http://<laptop-ip>:8000/`.
- If the phone cannot connect, check the laptop firewall and Windows network profile.

## Windows firewall and local testing

- Bind to `0.0.0.0` only for local-network testing.
- Do not expose the app publicly.
- If the phone cannot reach the server, allow Python/uvicorn through Windows Defender Firewall.
- Use a private home network and avoid public/shared networks.

## Reminders

- Create reminders with relative times such as "in one minute" or "tomorrow at 8 AM"
- Use the reminder form or natural-language commands
- The app keeps reminders in SQLite and runs them in a background scheduler
- Reminders require the laptop/backend to remain running
- If the app restarts after a due reminder, overdue reminders are marked as fired without repeated loops

## Microphone and camera limitations

- Browser speech recognition is available only in supported browsers and may require HTTPS or localhost.
- Camera access may fail if permission is denied or if the page is not running in a secure context.
- If the browser does not support Web Speech or the phone blocks access, the text input remains available.

## Common errors and fixes

- `GEMINI_API_KEY not found`: add the key to `.env`
- `429 Too Many Requests`: the free-tier quota was exhausted; wait and retry later
- `Model not found`: the chosen model is not available for your key; check Google AI Studio
- `Arduino port not found`: check the COM port and cable/driver state
- `Camera permission denied`: allow camera access in the browser
- `Microphone permission denied`: allow use of the microphone in the browser
- `Connection refused`: the backend server is not running

## Running the app

Use the included `run.bat` file for the easiest setup on Windows. It creates a local venv if needed, installs dependencies, keeps `.env` intact, and starts the FastAPI app.

## Important notes

- Simulation mode is for UI testing and is clearly labeled; it must not be confused with a real hardware connection.
- If Gemini is unavailable, the app still supports manual light control and reminders.
- The app does not claim a physical LED changed unless the Arduino responds and acknowledges the command.
