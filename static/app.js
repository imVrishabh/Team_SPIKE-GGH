const messageBox = document.getElementById('messageBox');
const commandInput = document.getElementById('commandInput');
const lightStateLabel = document.getElementById('lightStateLabel');
const reminderList = document.getElementById('reminderList');
const activityLog = document.getElementById('activityLog');
const toast = document.getElementById('toast');
const backendPill = document.getElementById('backend-pill');
const geminiPill = document.getElementById('gemini-pill');
const arduinoPill = document.getElementById('arduino-pill');
const hardwareBadge = document.getElementById('hardware-badge');
const deviceModal = document.getElementById('deviceModal');
const bluetoothDeviceList = document.getElementById('bluetoothDeviceList');
const bluetoothDeviceMessage = document.getElementById('bluetoothDeviceMessage');
const deviceModalFeedback = document.getElementById('deviceModalFeedback');
const connectedDevicePanel = document.getElementById('connectedDevicePanel');
const visionMessage = document.getElementById('visionMessage');
const cameraVideo = document.getElementById('cameraVideo');
const visionCanvas = document.getElementById('visionCanvas');
const colourResult = document.getElementById('colourResult');
const connectionPanels = {
  bluetooth: document.getElementById('bluetoothConnectionPanel'),
  usb: document.getElementById('usbConnectionPanel'),
  simulation: document.getElementById('simulationConnectionPanel'),
};

let cameraStream = null;
let currentImageData = null;
let lastColourResult = null;
let recognition = null;
let listening = false;
const firedReminderIds = new Set();

function setMessage(text, level = 'info') {
  messageBox.textContent = text;
  messageBox.className = `message ${level}`;
}

function addLog(text, level = 'info') {
  const item = document.createElement('li');
  item.className = `log-item ${level}`;
  item.textContent = text;
  activityLog.prepend(item);
}

function showToast(text, level = 'info') {
  toast.textContent = text;
  toast.className = `toast ${level} show`;
  clearTimeout(showToast.timeoutId);
  showToast.timeoutId = setTimeout(() => {
    toast.className = 'toast';
  }, 2500);
}

function updateConnectionIndicators(status) {
  if (!status) return;
  const backendConnected = status.backend === 'ok';
  const geminiConnected = !!(status.gemini && status.gemini.available);
  const arduinoConnected = !!(status.arduino && status.arduino.connected && !status.arduino.simulation);
  const simulationMode = !!status.simulation;

  backendPill.classList.toggle('online', backendConnected);
  geminiPill.classList.toggle('online', geminiConnected);
  arduinoPill.classList.toggle('online', arduinoConnected);
  arduinoPill.classList.toggle('warn', !arduinoConnected && !simulationMode);

  hardwareBadge.classList.toggle('hidden', !simulationMode);
  if (simulationMode) {
    hardwareBadge.textContent = 'SIMULATION MODE';
    hardwareBadge.classList.add('simulation');
  } else {
    hardwareBadge.classList.remove('simulation');
  }

  if (status.arduino && status.arduino.state) {
    lightStateLabel.textContent = status.arduino.state;
  }
  updateConnectedDevice(status.arduino);
}

function updateConnectedDevice(deviceStatus) {
  const isConnected = !!(deviceStatus && deviceStatus.connected && !deviceStatus.simulation);
  connectedDevicePanel.classList.toggle('hidden', !isConnected);
  if (!isConnected) return;

  const modeName = deviceStatus.mode === 'bluetooth' ? 'Bluetooth HC-05' : 'USB Serial';
  document.getElementById('connectedDeviceName').textContent = `${modeName} · ${deviceStatus.port}`;
  document.getElementById('connectedDeviceDetails').textContent =
    `Arduino acknowledged STATUS at ${deviceStatus.baud} baud.`;
}

function openDeviceModal() {
  deviceModal.classList.remove('hidden');
  selectConnectionMode('bluetooth');
  document.getElementById('closeDeviceModal').focus();
  refreshDeviceStatus();
}

function closeDeviceModal() {
  deviceModal.classList.add('hidden');
}

function selectConnectionMode(mode) {
  document.querySelectorAll('[data-connection-mode]').forEach((button) => {
    const selected = button.dataset.connectionMode === mode;
    button.classList.toggle('selected', selected);
    button.setAttribute('aria-selected', String(selected));
  });
  Object.entries(connectionPanels).forEach(([panelMode, panel]) => {
    panel.classList.toggle('hidden', panelMode !== mode);
  });
  deviceModalFeedback.textContent = mode === 'bluetooth'
    ? 'Pair the HC-05 with Windows before scanning.'
    : mode === 'usb'
      ? 'Connect the Uno by USB and select its detected COM port.'
      : 'Simulation does not connect to physical hardware.';
}

async function refreshDeviceStatus() {
  try {
    const status = await fetchJson('/api/bluetooth/status');
    updateConnectedDevice(status);
    if (status.connected) {
      selectConnectionMode(status.mode);
      deviceModalFeedback.textContent = `Connected on ${status.port}.`;
    }
  } catch (error) {
    deviceModalFeedback.textContent = error.message;
  }
}

async function scanBluetoothDevices() {
  const scanState = document.getElementById('bluetoothScanState');
  const scanButton = document.getElementById('findBluetoothDevicesBtn');
  bluetoothDeviceList.replaceChildren();
  bluetoothDeviceMessage.textContent = 'Looking for Bluetooth serial COM ports…';
  scanState.textContent = 'Scanning';
  scanState.classList.add('loading');
  scanButton.disabled = true;

  try {
    const result = await fetchJson('/api/bluetooth/devices');
    const devices = result.items || [];
    bluetoothDeviceMessage.textContent = devices.length
      ? result.message
      : `${result.message} Windows may only report a generic port description, not the paired module name.`;

    devices.forEach((device) => {
      const row = document.createElement('div');
      row.className = 'device-row';
      const details = document.createElement('div');
      const title = document.createElement('strong');
      title.textContent = device.device_name || 'Bluetooth serial device';
      const subtitle = document.createElement('small');
      subtitle.textContent = device.description || 'Windows Bluetooth SPP serial port';
      const port = document.createElement('small');
      port.className = 'device-port';
      port.textContent = device.port;
      details.append(title, subtitle, port);
      const connectButton = document.createElement('button');
      connectButton.type = 'button';
      connectButton.className = 'secondary-btn';
      connectButton.textContent = 'Connect';
      connectButton.addEventListener('click', () => connectDevice(device.port, 'bluetooth'));
      row.append(details, connectButton);
      bluetoothDeviceList.appendChild(row);
    });
    scanState.textContent = devices.length ? `${devices.length} port${devices.length === 1 ? '' : 's'} found` : '';
  } catch (error) {
    bluetoothDeviceMessage.textContent = error.message;
    scanState.textContent = 'Scan failed';
  } finally {
    scanButton.disabled = false;
    scanState.classList.remove('loading');
  }
}

async function scanSerialPorts() {
  const select = document.getElementById('usbPortSelect');
  const message = document.getElementById('usbDeviceMessage');
  select.replaceChildren(new Option('Select a detected serial port…', ''));
  try {
    const result = await fetchJson('/api/serial/ports');
    const ports = result.items || [];
    ports.forEach((port) => {
      const description = port.description ? ` — ${port.description}` : '';
      select.add(new Option(`${port.port}${description}`, port.port));
    });
    message.textContent = ports.length
      ? 'Choose the Arduino USB COM port from Windows Device Manager.'
      : 'No serial ports detected. Connect the board and refresh ports.';
  } catch (error) {
    message.textContent = error.message;
  }
}

async function connectDevice(port, mode) {
  deviceModalFeedback.textContent = `Opening ${port} and waiting for Arduino STATUS acknowledgement…`;
  try {
    const result = await fetchJson('/api/bluetooth/connect', {
      method: 'POST',
      body: JSON.stringify({ port, baud: 9600, mode }),
    });
    deviceModalFeedback.textContent = result.message;
    updateConnectedDevice(result);
    await refreshStatus();
    addLog(result.message, 'success');
  } catch (error) {
    deviceModalFeedback.textContent = error.message;
    updateConnectedDevice({ connected: false });
    addLog(error.message, 'error');
  }
}

async function selectSimulationMode() {
  try {
    const result = await fetchJson('/api/hardware/simulation', { method: 'POST' });
    updateConnectedDevice(result);
    deviceModalFeedback.textContent = result.message;
    await refreshStatus();
  } catch (error) {
    deviceModalFeedback.textContent = error.message;
  }
}

async function testDeviceConnection() {
  deviceModalFeedback.textContent = 'Sending STATUS and waiting for acknowledgement…';
  try {
    const result = await fetchJson('/api/bluetooth/test', { method: 'POST' });
    deviceModalFeedback.textContent = result.message;
    updateConnectedDevice(result);
    await refreshStatus();
  } catch (error) {
    deviceModalFeedback.textContent = error.message;
    await refreshStatus();
  }
}

async function disconnectDevice() {
  try {
    const result = await fetchJson('/api/bluetooth/disconnect', { method: 'POST' });
    deviceModalFeedback.textContent = result.message;
    updateConnectedDevice(result);
    await refreshStatus();
  } catch (error) {
    deviceModalFeedback.textContent = error.message;
  }
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.detail || data.message || 'Request failed.');
  }
  return data;
}

async function refreshStatus() {
  try {
    const result = await fetchJson('/api/status');
    updateConnectionIndicators(result);
    if (result.arduino && result.arduino.state) {
      lightStateLabel.textContent = result.arduino.state;
    }
    if (result.simulation) {
      setMessage('SIMULATION MODE: no physical hardware is connected. Manual controls are still available.', 'info');
    } else {
      setMessage('Connected and ready.', 'success');
    }
  } catch (error) {
    setMessage('Backend unavailable.', 'error');
    addLog(error.message, 'error');
  }
}

async function refreshReminders() {
  try {
    const data = await fetchJson('/api/reminders');
    const items = data.items || [];
    reminderList.innerHTML = '';

    if (!items.length) {
      reminderList.innerHTML = '<li class="reminder-item"><div><strong>No reminders yet.</strong><small>Set one to stay organized.</small></div></li>';
      return;
    }

    items.forEach((item) => {
      const li = document.createElement('li');
      li.className = 'reminder-item';
      const info = document.createElement('div');
      info.innerHTML = `<span class="status-tag">${item.status || 'upcoming'}</span><strong>${item.message}</strong><small>${new Date(item.scheduled_at).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}</small>`;
      const cancelBtn = document.createElement('button');
      cancelBtn.type = 'button';
      cancelBtn.className = 'cancel-btn';
      cancelBtn.textContent = 'Cancel';
      cancelBtn.onclick = async () => {
        await fetchJson(`/api/reminders/${item.id}`, { method: 'DELETE' });
        showToast('Reminder canceled', 'info');
        addLog(`Canceled reminder: ${item.message}`, 'warning');
        await refreshReminders();
      };
      li.appendChild(info);
      li.appendChild(cancelBtn);
      reminderList.appendChild(li);

      if (item.status === 'fired' && !firedReminderIds.has(item.id)) {
        firedReminderIds.add(item.id);
        speakText(`Reminder: ${item.message}`);
        if ('Notification' in window && Notification.permission === 'granted') {
          new Notification('VIVA Reminder', { body: item.message });
        }
        showToast(`Reminder: ${item.message}`, 'info');
        addLog(`Reminder fired: ${item.message}`, 'warning');
      }
    });
  } catch (error) {
    addLog(error.message, 'error');
  }
}

function speakText(text) {
  if ('speechSynthesis' in window) {
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = 'en-IN';
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(utterance);
  }
}

async function handleCommandSubmit() {
  const command = commandInput.value.trim();
  if (!command) {
    setMessage('Enter a command or speak the mic.', 'error');
    return;
  }

  try {
    const result = await fetchJson('/api/command', {
      method: 'POST',
      body: JSON.stringify({ command }),
    });

    if (result.ok) {
      setMessage(result.message || 'Command executed.', 'success');
      addLog(result.message || command, 'success');
      speakText(result.message || 'Done.');
      if (result.action === 'list_reminders') {
        await refreshReminders();
      }
    } else {
      setMessage(result.message || 'Command could not be processed.', 'error');
      addLog(result.message || 'Command failed', 'error');
      speakText(result.message || 'I could not process that command.');
    }

    if (result.action === 'light_on' || result.action === 'light_off') {
      lightStateLabel.textContent = result.state || lightStateLabel.textContent;
    }
  } catch (error) {
    setMessage(error.message, 'error');
    addLog(error.message, 'error');
  }
}

document.getElementById('sendBtn').addEventListener('click', handleCommandSubmit);
commandInput.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') handleCommandSubmit();
});

document.getElementById('connectDeviceBtn').addEventListener('click', openDeviceModal);
document.getElementById('closeDeviceModal').addEventListener('click', closeDeviceModal);
document.getElementById('cancelDeviceModal').addEventListener('click', closeDeviceModal);
deviceModal.querySelector('[data-close-device-modal]').addEventListener('click', closeDeviceModal);
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && !deviceModal.classList.contains('hidden')) closeDeviceModal();
});
document.querySelectorAll('[data-connection-mode]').forEach((button) => {
  button.addEventListener('click', () => selectConnectionMode(button.dataset.connectionMode));
});
document.getElementById('findBluetoothDevicesBtn').addEventListener('click', scanBluetoothDevices);
document.getElementById('findSerialPortsBtn').addEventListener('click', scanSerialPorts);
document.getElementById('connectUsbBtn').addEventListener('click', () => {
  const port = document.getElementById('usbPortSelect').value;
  if (!port) {
    document.getElementById('usbDeviceMessage').textContent = 'Select a detected serial COM port first.';
    return;
  }
  connectDevice(port, 'usb');
});
document.getElementById('selectSimulationBtn').addEventListener('click', selectSimulationMode);
document.getElementById('testDeviceConnectionBtn').addEventListener('click', testDeviceConnection);
document.getElementById('disconnectDeviceBtn').addEventListener('click', disconnectDevice);

document.getElementById('lightOnBtn').addEventListener('click', async () => {
  try {
    const result = await fetchJson('/api/light/on', { method: 'POST' });
    lightStateLabel.textContent = result.state || 'ON';
    setMessage(result.message || 'Bedroom light turned on.', result.ok ? 'success' : 'error');
    addLog(result.message || 'Bedroom light turned on.', result.ok ? 'success' : 'error');
  } catch (error) {
    setMessage(error.message, 'error');
  }
});

document.getElementById('lightOffBtn').addEventListener('click', async () => {
  try {
    const result = await fetchJson('/api/light/off', { method: 'POST' });
    lightStateLabel.textContent = result.state || 'OFF';
    setMessage(result.message || 'Bedroom light turned off.', result.ok ? 'success' : 'error');
    addLog(result.message || 'Bedroom light turned off.', result.ok ? 'success' : 'error');
  } catch (error) {
    setMessage(error.message, 'error');
  }
});

document.getElementById('reminderForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  const message = document.getElementById('reminderMessage').value.trim();
  const scheduledAt = document.getElementById('reminderTime').value.trim();
  if (!message || !scheduledAt) {
    setMessage('Reminder needs both a message and a time.', 'error');
    return;
  }

  try {
    const result = await fetchJson('/api/reminders', {
      method: 'POST',
      body: JSON.stringify({ message, scheduled_at: scheduledAt }),
    });
    if (result.ok) {
      document.getElementById('reminderForm').reset();
      setMessage('Reminder created successfully.', 'success');
      addLog(`Reminder saved: ${message} (${scheduledAt})`, 'success');
      showToast('Reminder saved', 'success');
      await refreshReminders();
    }
  } catch (error) {
    setMessage(error.message, 'error');
  }
});

const micBtn = document.getElementById('micBtn');
if ('SpeechRecognition' in window || 'webkitSpeechRecognition' in window) {
  const SpeechRecognitionCtor = window.SpeechRecognition || window.webkitSpeechRecognition;
  recognition = new SpeechRecognitionCtor();
  recognition.lang = 'en-IN';
  recognition.onresult = (event) => {
    const transcript = event.results[0][0].transcript;
    commandInput.value = transcript;
    setMessage(`Voice captured: ${transcript}`, 'info');
  };
  recognition.onend = () => {
    listening = false;
    micBtn.classList.remove('active');
    micBtn.textContent = '🎤';
  };
  recognition.onerror = () => {
    setMessage('Microphone could not understand the command. Please type it instead.', 'error');
    listening = false;
    micBtn.classList.remove('active');
  };
} else {
  micBtn.title = 'Speech recognition not supported in this browser';
}

micBtn.addEventListener('click', () => {
  if (!recognition) {
    setMessage('Speech recognition is unavailable in this browser. Please type your command.', 'error');
    return;
  }

  if (listening) {
    recognition.stop();
    listening = false;
    micBtn.classList.remove('active');
    micBtn.textContent = '🎤';
    return;
  }

  recognition.start();
  listening = true;
  micBtn.classList.add('active');
  micBtn.textContent = '🛑';
  setMessage('Listening... speak your command.', 'info');
});

function setVisionMessage(message, level = 'info') {
  visionMessage.textContent = message;
  visionMessage.className = `vision-message ${level}`;
}

function setCameraLive(isLive) {
  cameraVideo.classList.toggle('hidden', !isLive);
  document.getElementById('cameraPlaceholderMessage').classList.toggle('hidden', isLive);
  document.getElementById('cameraLiveBadge').classList.toggle('hidden', !isLive);
  document.getElementById('openCameraBtn').disabled = isLive;
  document.getElementById('closeCameraBtn').disabled = !isLive;
  document.getElementById('identifyColourBtn').disabled = !isLive;
  document.getElementById('captureBtn').disabled = !isLive;
  document.getElementById('analyzeBtn').disabled = !currentImageData;
}

async function openCamera() {
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    setVisionMessage('Camera access is unavailable. Use a supported browser and a secure context (HTTPS or localhost).', 'error');
    return;
  }

  try {
    setVisionMessage('Requesting camera permission…');
    cameraStream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } },
      audio: false,
    });
    cameraStream.getVideoTracks().forEach((track) => {
      track.addEventListener('ended', () => {
        if (!cameraStream) return;
        releaseCamera();
        setVisionMessage('The camera stream ended. Reopen the camera to continue.', 'error');
      }, { once: true });
    });
    cameraVideo.srcObject = cameraStream;
    await cameraVideo.play();
    setCameraLive(true);
    setVisionMessage('Camera is live. Point it at a colour and choose Identify Colour.', 'success');
  } catch (error) {
    releaseCamera();
    if (error.name === 'NotAllowedError' || error.name === 'SecurityError') {
      setVisionMessage('Camera permission was denied. Allow camera access in your browser settings and try again.', 'error');
    } else if (error.name === 'NotFoundError' || error.name === 'DevicesNotFoundError') {
      setVisionMessage('No camera was found on this device.', 'error');
    } else if (error.name === 'NotReadableError' || error.name === 'TrackStartError') {
      setVisionMessage('The camera is already in use by another app or could not start. Close other camera apps and retry.', 'error');
    } else {
      setVisionMessage(`Could not open the camera: ${error.message || 'unknown camera error'}`, 'error');
    }
  }
}

function releaseCamera() {
  if (cameraStream) {
    cameraStream.getTracks().forEach((track) => track.stop());
    cameraStream = null;
  }
  cameraVideo.srcObject = null;
  setCameraLive(false);
}

function captureCurrentFrame(maxWidth = 1280) {
  if (!cameraStream || !cameraVideo.videoWidth || !cameraVideo.videoHeight) {
    throw new Error('Open the camera and wait for the live preview before capturing a frame.');
  }
  const scale = Math.min(1, maxWidth / cameraVideo.videoWidth);
  const width = Math.max(1, Math.round(cameraVideo.videoWidth * scale));
  const height = Math.max(1, Math.round(cameraVideo.videoHeight * scale));
  visionCanvas.width = width;
  visionCanvas.height = height;
  const context = visionCanvas.getContext('2d', { willReadFrequently: true });
  if (!context) throw new Error('Could not prepare the camera frame for analysis.');
  context.drawImage(cameraVideo, 0, 0, width, height);
  return context;
}

function saveFrameForGemini() {
  captureCurrentFrame();
  const preview = document.getElementById('cameraPreview');
  const dataUrl = visionCanvas.toDataURL('image/jpeg', 0.82);
  preview.src = dataUrl;
  currentImageData = dataUrl.split(',')[1];
  document.querySelector('.capture-preview').classList.remove('hidden');
  document.getElementById('analyzeBtn').disabled = false;
  setVisionMessage('Image captured locally. It will only be sent to Gemini if you request a description.', 'success');
}

function identifyColour() {
  const button = document.getElementById('identifyColourBtn');
  button.disabled = true;
  button.textContent = 'Analysing…';
  setVisionMessage('Analysing the central camera region locally…');

  try {
    const context = captureCurrentFrame(480);
    const pixels = context.getImageData(0, 0, visionCanvas.width, visionCanvas.height);
    const result = VivaColorDetection.detectDominantColour(pixels);
    lastColourResult = result;
    colourResult.classList.remove('hidden');
    document.getElementById('colourSwatch').style.backgroundColor = result.hex;
    document.getElementById('colourSwatch').setAttribute('aria-label', `Colour swatch ${result.hex}`);
    document.getElementById('colourName').textContent = result.name[0].toUpperCase() + result.name.slice(1);
    const confidence = Math.round(result.confidence * 100);
    document.getElementById('colourDetails').textContent =
      `${result.hex.toUpperCase()} · RGB ${result.rgb.join(', ')} · ${confidence}% of sampled pixels`;
    setVisionMessage('Colour estimate ready. Lighting and camera white balance can affect the result.', 'success');
    addLog(`AI Vision detected ${result.name} (${result.hex.toUpperCase()}) in the central region.`, 'success');
  } catch (error) {
    setVisionMessage(error.message, 'error');
  } finally {
    button.disabled = !cameraStream;
    button.textContent = 'Identify Colour';
  }
}

function speakColourResult() {
  if (!lastColourResult) {
    setVisionMessage('Identify a colour before asking VIVA to speak the result.', 'error');
    return;
  }
  speakText(`The detected colour is ${lastColourResult.name}.`);
}

function capturePhoto() {
  try {
    saveFrameForGemini();
  } catch (error) {
    setVisionMessage(error.message, 'error');
  }
}

async function analyzeImage() {
  if (!currentImageData) {
    setVisionMessage('Open the camera and capture an image before requesting a Gemini description.', 'error');
    return;
  }

  const analyzeButton = document.getElementById('analyzeBtn');
  analyzeButton.disabled = true;
  analyzeButton.textContent = 'Sending to Gemini…';
  setVisionMessage('Sending the selected image to Gemini for description…');
  try {
    const result = await fetchJson('/api/camera/analyze', {
      method: 'POST',
      body: JSON.stringify({ image_data: currentImageData, prompt: 'Describe this image in a short and helpful way.' }),
    });
    if (result.ok && result.result && result.result.message) {
      setVisionMessage(result.result.message, 'success');
      addLog(`Gemini image description: ${result.result.message}`, 'success');
      speakText(result.result.message);
    } else {
      setVisionMessage(result.message || 'Image analysis failed.', 'error');
    }
  } catch (error) {
    setVisionMessage(error.message, 'error');
  } finally {
    analyzeButton.disabled = !currentImageData;
    analyzeButton.textContent = 'Describe Object with Gemini';
  }
}

document.getElementById('openCameraBtn').addEventListener('click', openCamera);
document.getElementById('closeCameraBtn').addEventListener('click', () => {
  releaseCamera();
  setVisionMessage('Camera closed. Your last captured image remains available for an explicitly requested Gemini description.');
});
document.getElementById('identifyColourBtn').addEventListener('click', identifyColour);
document.getElementById('speakColourBtn').addEventListener('click', speakColourResult);
document.getElementById('captureBtn').addEventListener('click', capturePhoto);
document.getElementById('analyzeBtn').addEventListener('click', analyzeImage);
window.addEventListener('pagehide', releaseCamera);

if ('Notification' in window) {
  Notification.requestPermission().catch(() => {});
}

setInterval(refreshStatus, 10000);
setInterval(refreshReminders, 5000);
scanSerialPorts();
refreshStatus();
refreshReminders();

