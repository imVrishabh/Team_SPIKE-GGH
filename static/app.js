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
  geminiPill.classList.toggle('warn', !geminiConnected);
  geminiPill.title = status.gemini ? status.gemini.message : 'Gemini status unavailable.';
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
  const headers = options.body instanceof FormData
    ? {}
    : { 'Content-Type': 'application/json' };
  const response = await fetch(url, {
    headers,
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

const personEnrollmentForm = document.getElementById('personEnrollmentForm');
const personNameInput = document.getElementById('personNameInput');
const personImageInput = document.getElementById('personImageInput');
const personImagePreview = document.getElementById('personImagePreview');
const enrolledPeopleList = document.getElementById('enrolledPeopleList');
const recognitionVideo = document.getElementById('recognitionVideo');
const recognitionOverlay = document.getElementById('recognitionOverlay');
const recognitionFrameCanvas = document.getElementById('recognitionFrameCanvas');
const recognitionMessage = document.getElementById('recognitionMessage');
const voiceGreetingToggle = document.getElementById('voiceGreetingToggle');
let personPreviewUrl = null;
let recognitionStream = null;
let recognitionActive = false;
let recognitionRequestInFlight = false;
let recognitionTimer = null;
let recognitionAbortController = null;
let recognitionGeneration = 0;
let currentRecognizedName = null;
const personGreetingTimes = new Map();
const GREETING_COOLDOWN_MS = 30_000;

function setRecognitionMessage(message, level = 'info') {
  recognitionMessage.textContent = message;
  recognitionMessage.className = `vision-message ${level}`;
}

function showPersonPreview(file) {
  if (personPreviewUrl) {
    URL.revokeObjectURL(personPreviewUrl);
    personPreviewUrl = null;
  }
  const previewWrap = document.getElementById('personPreviewWrap');
  if (!file) {
    previewWrap.classList.add('hidden');
    personImagePreview.removeAttribute('src');
    return;
  }
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size > 5 * 1024 * 1024) {
    setRecognitionMessage('Choose a JPEG, PNG, or WebP image no larger than 5 MB.', 'error');
    personImageInput.value = '';
    previewWrap.classList.add('hidden');
    return;
  }
  personPreviewUrl = URL.createObjectURL(file);
  personImagePreview.src = personPreviewUrl;
  previewWrap.classList.remove('hidden');
}

async function refreshEnrolledPeople() {
  const result = await fetchJson('/api/faces/people');
  enrolledPeopleList.replaceChildren();
  const empty = document.getElementById('enrolledPeopleEmpty');
  empty.classList.toggle('hidden', result.items.length > 0);
  result.items.forEach((person) => {
    const item = document.createElement('li');
    item.className = 'enrolled-person';
    const name = document.createElement('span');
    name.className = 'enrolled-person-name';
    name.textContent = person.name;
    const remove = document.createElement('button');
    remove.className = 'delete-person-btn';
    remove.type = 'button';
    remove.textContent = 'Delete';
    remove.setAttribute('aria-label', `Delete ${person.name}`);
    remove.addEventListener('click', async () => {
      remove.disabled = true;
      try {
        const response = await fetchJson(`/api/faces/people/${person.id}`, { method: 'DELETE' });
        await refreshEnrolledPeople();
        setRecognitionMessage(response.message, 'success');
        addLog(`Deleted local face enrollment for ${person.name}.`);
      } catch (error) {
        remove.disabled = false;
        setRecognitionMessage(error.message, 'error');
      }
    });
    item.append(name, remove);
    enrolledPeopleList.append(item);
  });
}

personImageInput.addEventListener('change', () => showPersonPreview(personImageInput.files[0]));

personEnrollmentForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const file = personImageInput.files[0];
  const name = personNameInput.value.trim();
  if (!name || !file) {
    setRecognitionMessage('Enter a name and choose a photo before saving.', 'error');
    return;
  }
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size > 5 * 1024 * 1024) {
    setRecognitionMessage('Choose a JPEG, PNG, or WebP image no larger than 5 MB.', 'error');
    return;
  }
  const saveButton = document.getElementById('savePersonBtn');
  saveButton.disabled = true;
  saveButton.textContent = 'Checking photo…';
  setRecognitionMessage('Detecting one face and saving its local recognition sample…');
  try {
    const body = new FormData();
    body.append('name', name);
    body.append('image', file);
    const result = await fetchJson('/api/faces/enroll', { method: 'POST', body });
    await refreshEnrolledPeople();
    personEnrollmentForm.reset();
    showPersonPreview(null);
    setRecognitionMessage(`${result.person.name} was enrolled. The original photo was not retained.`, 'success');
    addLog(`Enrolled ${result.person.name} for local face recognition.`, 'success');
  } catch (error) {
    setRecognitionMessage(error.message, 'error');
  } finally {
    saveButton.disabled = false;
    saveButton.textContent = 'Save Person';
  }
});

function drawRecognitionBoxes(faces, frameWidth, frameHeight) {
  const bounds = recognitionOverlay.getBoundingClientRect();
  const pixelRatio = window.devicePixelRatio || 1;
  recognitionOverlay.width = Math.max(1, Math.round(bounds.width * pixelRatio));
  recognitionOverlay.height = Math.max(1, Math.round(bounds.height * pixelRatio));
  const context = recognitionOverlay.getContext('2d');
  if (!context) return;
  context.scale(pixelRatio, pixelRatio);
  context.clearRect(0, 0, bounds.width, bounds.height);
  if (!frameWidth || !frameHeight) return;

  const scale = Math.min(bounds.width / frameWidth, bounds.height / frameHeight);
  const offsetX = (bounds.width - frameWidth * scale) / 2;
  const offsetY = (bounds.height - frameHeight * scale) / 2;
  context.font = '600 14px Inter, Arial, sans-serif';
  context.lineWidth = 3;
  faces.forEach((face) => {
    const { x, y, width, height } = face.box;
    const left = offsetX + x * scale;
    const top = offsetY + y * scale;
    const boxWidth = width * scale;
    const boxHeight = height * scale;
    const color = face.recognized ? '#3ddc97' : '#fbbf24';
    const label = face.name;
    context.strokeStyle = color;
    context.strokeRect(left, top, boxWidth, boxHeight);
    const labelWidth = context.measureText(label).width + 16;
    const labelTop = Math.max(0, top - 25);
    context.fillStyle = color;
    context.fillRect(left, labelTop, labelWidth, 23);
    context.fillStyle = '#07111f';
    context.fillText(label, left + 8, labelTop + 16);
  });
}

function updateVoiceGreeting(faceName) {
  const previousName = currentRecognizedName;
  currentRecognizedName = faceName;
  if (!faceName || !voiceGreetingToggle.checked || faceName === previousName) return;
  const now = Date.now();
  const lastGreeting = personGreetingTimes.get(faceName) || 0;
  if (now - lastGreeting < GREETING_COOLDOWN_MS) return;
  personGreetingTimes.set(faceName, now);
  speakText(`Hello, ${faceName}!`);
}

async function recognizeNextFrame(generation = recognitionGeneration) {
  if (!recognitionActive || recognitionRequestInFlight || generation !== recognitionGeneration) return;
  recognitionRequestInFlight = true;
  recognitionAbortController = new AbortController();
  try {
    const videoWidth = recognitionVideo.videoWidth;
    const videoHeight = recognitionVideo.videoHeight;
    if (!videoWidth || !videoHeight) throw new Error('Waiting for the camera preview to be ready.');
    const scale = Math.min(1, 480 / videoWidth);
    const width = Math.max(1, Math.round(videoWidth * scale));
    const height = Math.max(1, Math.round(videoHeight * scale));
    recognitionFrameCanvas.width = width;
    recognitionFrameCanvas.height = height;
    const context = recognitionFrameCanvas.getContext('2d');
    if (!context) throw new Error('Could not prepare a frame for local recognition.');
    context.drawImage(recognitionVideo, 0, 0, width, height);
    const imageData = recognitionFrameCanvas.toDataURL('image/jpeg', 0.68);
    const result = await fetchJson('/api/faces/recognize', {
      method: 'POST',
      body: JSON.stringify({ image_data: imageData }),
      signal: recognitionAbortController.signal,
    });
    drawRecognitionBoxes(result.faces, result.frame_width, result.frame_height);
    const recognized = result.faces.find((face) => face.recognized);
    updateVoiceGreeting(recognized ? recognized.name : null);
    if (recognized) {
      setRecognitionMessage(`Recognized ${recognized.name}. Similarity is approximate; check the label before relying on it.`, 'success');
    } else if (result.faces.length) {
      setRecognitionMessage('Unknown Person. No enrolled match met the configured similarity threshold.', 'info');
    } else {
      setRecognitionMessage('No face detected. Face the camera in clear, even lighting.', 'info');
    }
  } catch (error) {
    if (generation === recognitionGeneration && recognitionActive) {
      stopRecognition(`Recognition stopped: ${error.message}`, 'error');
    }
    return;
  } finally {
    if (generation === recognitionGeneration) {
      recognitionRequestInFlight = false;
      recognitionAbortController = null;
    }
  }
  if (recognitionActive && generation === recognitionGeneration) {
    recognitionTimer = window.setTimeout(() => recognizeNextFrame(generation), 900);
  }
}

async function startRecognition() {
  if (recognitionActive) return;
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    setRecognitionMessage('Camera access requires a supported browser and HTTPS or localhost.', 'error');
    return;
  }
  const startButton = document.getElementById('startRecognitionBtn');
  startButton.disabled = true;
  try {
    setRecognitionMessage('Requesting camera permission…');
    recognitionStream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: 'user' }, width: { ideal: 640 }, height: { ideal: 480 } },
      audio: false,
    });
    recognitionVideo.srcObject = recognitionStream;
    await recognitionVideo.play();
    const generation = ++recognitionGeneration;
    recognitionActive = true;
    document.getElementById('recognitionCameraPlaceholder').classList.add('hidden');
    recognitionVideo.classList.remove('hidden');
    document.getElementById('stopRecognitionBtn').disabled = false;
    setRecognitionMessage('Recognition is active. Frames are processed on this computer only.', 'success');
    recognitionStream.getVideoTracks().forEach((track) => {
      track.addEventListener('ended', () => {
        if (recognitionActive) stopRecognition('The camera stream ended. Start recognition again to retry.', 'error');
      }, { once: true });
    });
    recognizeNextFrame(generation);
  } catch (error) {
    stopRecognition(
      error.name === 'NotAllowedError' || error.name === 'SecurityError'
        ? 'Camera permission was denied. Allow camera access in browser settings and try again.'
        : error.name === 'NotFoundError' || error.name === 'DevicesNotFoundError'
          ? 'No camera was found on this device.'
          : error.name === 'NotReadableError' || error.name === 'TrackStartError'
            ? 'The camera is in use or could not start. Close other camera apps and retry.'
            : `Could not start recognition: ${error.message || 'unknown camera error'}`,
      'error',
    );
  } finally {
    startButton.disabled = recognitionActive;
  }
}

function stopRecognition(message = 'Recognition stopped. The camera has been released.', level = 'info') {
  recognitionGeneration += 1;
  recognitionActive = false;
  if (recognitionAbortController) {
    recognitionAbortController.abort();
    recognitionAbortController = null;
  }
  recognitionRequestInFlight = false;
  if (recognitionTimer !== null) {
    window.clearTimeout(recognitionTimer);
    recognitionTimer = null;
  }
  if (recognitionStream) {
    recognitionStream.getTracks().forEach((track) => track.stop());
    recognitionStream = null;
  }
  recognitionVideo.srcObject = null;
  recognitionVideo.classList.add('hidden');
  document.getElementById('recognitionCameraPlaceholder').classList.remove('hidden');
  document.getElementById('startRecognitionBtn').disabled = false;
  document.getElementById('stopRecognitionBtn').disabled = true;
  const context = recognitionOverlay.getContext('2d');
  if (context) context.clearRect(0, 0, recognitionOverlay.width, recognitionOverlay.height);
  currentRecognizedName = null;
  setRecognitionMessage(message, level);
}

document.getElementById('startRecognitionBtn').addEventListener('click', startRecognition);
document.getElementById('stopRecognitionBtn').addEventListener('click', () => stopRecognition());
voiceGreetingToggle.addEventListener('change', () => {
  currentRecognizedName = null;
  setRecognitionMessage(voiceGreetingToggle.checked ? 'Voice greetings are enabled.' : 'Voice greetings are disabled.');
});

refreshEnrolledPeople().catch((error) => {
  setRecognitionMessage(`Could not load local enrollments: ${error.message}`, 'error');
});
window.addEventListener('pagehide', () => {
  stopRecognition();
  if (personPreviewUrl) URL.revokeObjectURL(personPreviewUrl);
});

if ('Notification' in window) {
  Notification.requestPermission().catch(() => {});
}

setInterval(refreshStatus, 10000);
setInterval(refreshReminders, 5000);
scanSerialPorts();
refreshStatus();
refreshReminders();
