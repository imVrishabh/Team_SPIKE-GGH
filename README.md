# VIVA MVP

VIVA is a smart home companion that lets you control a bedroom LED, create reminders, use phone voice input, and optionally ask Gemini to describe a photo from your phone camera. It is designed for a quick hackathon build and is meant to run locally on a Windows laptop and Android phone.

## What VIVA does

- Understands natural-language commands such as "turn on the bedroom light"
- Controls an Arduino Uno LED over USB serial or HC-05 Bluetooth
- Creates and tracks reminders in SQLite using Asia/Kolkata time
- Speaks responses using browser speech synthesis
- Accepts voice commands in browsers that support Web Speech API
- Estimates the most common colour in the live camera's central region locally in the browser
- Enrolls named people and recognizes faces locally with OpenCV; camera frames are not sent to Gemini
- Captures a snapshot from your phone camera and optionally describes it with Gemini on explicit request
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
6. If `.env` does not exist, copy `.env.example` to `.env` and fill in the values. Keep an existing `.env`; do not overwrite it.
7. Start the app:
   `uvicorn app.main:app --host 127.0.0.1 --port 8000`
   or use the provided `run.bat` wrapper.
8. Open `http://localhost:8000/` in the browser on the laptop.

VIVA binds to this computer only by default. Do not expose it to a LAN or the public internet without adding appropriate access controls.

## Gemini API setup

1. Go to https://aistudio.google.com/
2. Create or sign in to a Google account.
3. Open Google AI Studio and create a Gemini API key.
4. Keep it in your local `.env` file only. Never store it in frontend JavaScript.
5. Use a supported free-tier model such as `gemini-2.0-flash` if it is available for your API key.
6. Check the Google AI Studio model list and quota page before assuming a model is available for free usage.

## Environment variables

- `GEMINI_API_KEY`: your Gemini key
- `GEMINI_MODEL`: use a model currently available to your API key; each API attempt has a 15-second timeout and temporary rate-limit, server, and connection errors are retried up to three times. VIVA displays setup-specific messages for key, model, and quota errors.
- `HARDWARE_MODE`: `simulation`, `usb`, or `bluetooth`
- `ARDUINO_PORT`: COM port for USB or paired HC-05 module
- `ARDUINO_BAUD`: default `9600`
- `REMINDER_DB_PATH`: path to the SQLite database
- `FACE_DB_PATH`: local SQLite store for enrolled names and normalized face samples; default `data/face_recognition.db`
- `FACE_MATCH_THRESHOLD`: LBPH maximum distance for accepting a match (default `75`; lower is stricter, range `10`–`150`)
- `TIMEZONE`: default `Asia/Kolkata`

## People Recognition (local face enrollment)

Open VIVA on the laptop at **http://localhost:8000/**. Face enrollment and recognition endpoints accept requests only from this computer; they are intentionally unavailable when the dashboard is opened from another device or through a LAN address.

1. In **People Recognition**, enter a name (for the demo, `Vrishabh`) and select one clear JPEG, PNG, or WebP photo of that person (maximum 5 MB).
2. Review the preview and select **Save Person**. VIVA requires exactly one detectable face; it reports a useful error for no face, multiple faces, unsupported files, and duplicate names.
3. Select **Start Recognition** and allow camera access. Detected faces receive a box and a label. Faces that do not pass the configured match threshold are labelled **Unknown Person**.
4. Voice greetings are enabled by default. Turn off **Voice greetings** to mute them; VIVA greets only on a newly recognized appearance and applies a 30-second per-person cooldown. Stop Recognition to release the camera.
5. Use **Delete** beside an enrolled person to remove that name and its face sample from local storage.

### Recognition method, limits, and privacy

Recognition uses OpenCV's CPU-based Haar face detector and LBPH face recognizer from `opencv-contrib-python-headless`. It needs no GPU, external API, or model download. The first dependency install downloads a sizeable OpenCV wheel (tens of megabytes). If your environment has the regular `opencv-python` package, remove it before installing contrib to avoid two distributions writing the same `cv2` module:

```powershell
python -m pip uninstall opencv-python
python -m pip install -r requirements.txt
```

The one-photo LBPH setup is a lightweight hackathon demo, not a modern deep-embedding system. It can be sensitive to pose, expression, lighting, image quality, and similar-looking people; it is not suitable for security or consequential decisions. Add clear samples under varied conditions and tune `FACE_MATCH_THRESHOLD` locally if needed. LBPH distance is not a calibrated probability: a lower value is a closer match. The default threshold is a starting point, not an accuracy guarantee.

The original enrollment upload is processed in memory and discarded. VIVA stores the person's name and a normalized grayscale face sample (the local recognition representation) in `data/face_recognition.db`; deleting an enrollment also deletes that sample and rebuilds the in-memory matcher. Live frames are downscaled and sent about once per second to this computer's FastAPI backend only. They are not stored, sent to Gemini, or sent to an external service. The local database is ignored by Git. Do not expose VIVA to untrusted networks; the face API additionally enforces loopback-only access.

Camera permissions require a supported browser and a secure context. Use `http://localhost:8000/` on the laptop, not the laptop's LAN IP, for this feature. If no camera is detected, allow access in browser settings, close other camera applications, and retry. If a clear photo is rejected, use a brighter, front-facing image with only one face.

## Arduino wiring and upload

Use the sketch in `arduino/viva_bedroom.ino`.

- Arduino D7 -> 220–330 ohm resistor -> LED anode
- LED cathode -> Arduino GND
- USB serial: connect via the USB cable for the first working setup
- HC-05 Bluetooth uses SoftwareSerial at 9600 baud:
  - HC-05 TXD -> Arduino D10 (SoftwareSerial RX)
  - Arduino D11 (SoftwareSerial TX) -> a voltage divider -> HC-05 RXD
  - HC-05 VCC -> Arduino 5V
  - HC-05 GND -> Arduino GND

Upload `arduino/viva_bedroom.ino` from Arduino IDE over USB. Select the Uno board and the Arduino's USB COM port in Arduino IDE, then upload. Close Arduino IDE's Serial Monitor before connecting from VIVA, because only one program can own a COM port at a time.

## Testing USB serial

1. Set `HARDWARE_MODE=usb`
2. Set `ARDUINO_PORT` to the Arduino COM port, for example `COM3`
3. Start the app
4. Use the dashboard buttons or API to send `LIGHT_ON` and `LIGHT_OFF`
5. Verify the LED changes only after the Arduino acknowledges the command

## Switching to HC-05 Bluetooth

1. Power the HC-05 and open Windows **Settings → Bluetooth & devices → Add device → Bluetooth**. Pair it with Windows; common module pairing PINs are `1234` or `0000` if Windows asks.
2. Find its serial port in **Device Manager → Ports (COM & LPT)** or **Settings → Bluetooth & devices → Devices → More Bluetooth settings → COM Ports**. Select the **outgoing** port for the paired HC-05; the incoming port is not the one VIVA initiates a connection through.
3. Keep the current USB sketch upload setup; the HC-05 D10/D11 wiring must be connected and powered for serial commands to reach the Arduino.
4. Start VIVA, click **Connect Device → Bluetooth HC-05 → Find Bluetooth Devices**, choose the detected COM port, and click **Connect**. VIVA discovers Bluetooth SPP serial ports using pyserial's Windows port enumeration; it does not use browser Web Bluetooth.
5. Windows often reports only a generic description such as “Standard Serial over Bluetooth link”, not the HC-05 name. Identify the correct outgoing COM port in Windows settings/Device Manager; VIVA does not guess a name or COM port.
6. VIVA opens the selected port at 9600 baud and sends `STATUS`. It shows **Connected** only after a valid `OK STATUS ON/OFF` Arduino acknowledgement. Use **Test Connection** to repeat this check.
7. Click **Disconnect** before changing ports or closing VIVA. Manual and Gemini light commands use this active serial connection and require an Arduino acknowledgement to report success.

If no Bluetooth ports appear, pair the HC-05 in Windows first and refresh. If a port is busy, close Arduino IDE's Serial Monitor and other terminal/serial apps, disconnect in VIVA, then retry. If the port opens but STATUS times out, check the outgoing COM port, HC-05 power and wiring, voltage divider on D11 → HC-05 RXD, 9600 baud, and that the VIVA sketch is uploaded. A serial port opening alone is not proof the Arduino is connected.

The USB Serial choice is also in **Connect Device**. Refresh ports, select the Arduino USB COM port, and connect; it uses the same STATUS acknowledgement check. Use **Simulation Mode** to test the interface without physical hardware.

`pyserial` (already listed in `requirements.txt`) enumerates Windows COM ports; no additional Bluetooth package or Web Bluetooth support is needed.

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

## AI Vision colour recognition

1. Open the dashboard in a browser that supports `getUserMedia` (use `http://localhost:8000` on the laptop, or HTTPS for phone camera access; ordinary HTTP on a LAN may not be a secure context).
2. In the **AI Vision** card, click **Open Camera** and allow camera access.
3. Point the camera at the object and click **Identify Colour**. VIVA samples the central part of one frame locally in JavaScript/Canvas; routine colour detection does not upload the image or call Gemini.
4. Review the estimated name, swatch, hex/RGB value, and heuristic share of sampled pixels. The result describes the centre region, so move the object into the middle for best results.
5. Click **Speak Result** to have browser speech synthesis say the detected colour.
6. To use Gemini separately, click **Capture Image**, then **Describe Object with Gemini**. Only that explicit action uploads the captured image to the backend. Closing the camera stops its video tracks; the captured still remains available for the requested Gemini description until the page is refreshed.

Colour estimates are approximate. Lighting, shadows, reflections, background colours, and camera white balance can affect classification. The confidence percentage is the winning class's share of eligible pixels in the sampled central area; it is a heuristic, not a calibrated probability. Use **Close Camera** when finished to release the camera.

## Common errors and fixes

- `GEMINI_API_KEY not found`: add the key to `.env`
- `429 Too Many Requests`: the free-tier quota was exhausted; wait and retry later
- `Model not found`: the chosen model is not available for your key; check Google AI Studio
- `Gemini timed out` or `Gemini is temporarily unavailable`: check your internet connection and try again; temporary API failures are retried automatically
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
