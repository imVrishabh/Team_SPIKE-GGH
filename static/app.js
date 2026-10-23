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

let cameraStream = null;
let currentImageData = null;
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

async function openCamera() {
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    setMessage('Camera not supported in this browser.', 'error');
    return;
  }

  const video = document.getElementById('cameraVideo');
  try {
    cameraStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false });
    video.srcObject = cameraStream;
    setMessage('Camera is live.', 'success');
  } catch (error) {
    setMessage('Camera permission was denied. Please allow access and try again.', 'error');
  }
}

function capturePhoto() {
  const video = document.getElementById('cameraVideo');
  const preview = document.getElementById('cameraPreview');
  if (!video || !video.videoWidth) {
    setMessage('Open the camera before taking a picture.', 'error');
    return;
  }
  const canvas = document.createElement('canvas');
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
  const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
  preview.src = dataUrl;
  currentImageData = dataUrl.split(',')[1];
  document.querySelector('.capture-preview').classList.remove('hidden');
  setMessage('Image captured. Ready for analysis.', 'success');
}

async function analyzeImage() {
  if (!currentImageData) {
    setMessage('Capture an image before requesting description.', 'error');
    return;
  }

  try {
    const result = await fetchJson('/api/camera/analyze', {
      method: 'POST',
      body: JSON.stringify({ image_data: currentImageData, prompt: 'Describe this image in a short and helpful way.' }),
    });
    if (result.ok && result.result && result.result.message) {
      setMessage(result.result.message, 'success');
      speakText(result.result.message);
    } else {
      setMessage(result.message || 'Image analysis failed.', 'error');
    }
  } catch (error) {
    setMessage(error.message, 'error');
  }
}

document.getElementById('openCameraBtn').addEventListener('click', openCamera);
document.getElementById('captureBtn').addEventListener('click', capturePhoto);
document.getElementById('analyzeBtn').addEventListener('click', analyzeImage);

if ('Notification' in window) {
  Notification.requestPermission().catch(() => {});
}

setInterval(refreshStatus, 10000);
setInterval(refreshReminders, 5000);
refreshStatus();
refreshReminders();

