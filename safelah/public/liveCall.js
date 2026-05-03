/**
 * SafeLah Live Call Companion
 * Frontend module for real-time call monitoring and scam detection
 */

// Module-level state
let sessionId = crypto.randomUUID();
let guardianPhone = localStorage.getItem('safelah_guardian_phone') || null;

let stream = null;
let recorder = null;
let ws = null;
let sse = null;
let wakeLock = null;
let isMonitoring = false;

// UI elements (cached on init)
let startBtn, stopBtn, statusPill, instructionBanner;
let transcriptPanel, riskBadge, advicePanel;
let guardianSection, guardianPhoneDisplay, setGuardianBtn, callGuardianBtn;

/**
 * Initialize UI references and attach event listeners
 */
function initializeUI() {
  startBtn = document.getElementById('startBtn');
  stopBtn = document.getElementById('stopBtn');
  statusPill = document.getElementById('statusPill');
  instructionBanner = document.getElementById('instructionBanner');
  transcriptPanel = document.getElementById('transcriptPanel');
  riskBadge = document.getElementById('riskBadge');
  advicePanel = document.getElementById('advicePanel');
  guardianSection = document.getElementById('guardianSection');
  guardianPhoneDisplay = document.getElementById('guardianPhoneDisplay');
  setGuardianBtn = document.getElementById('setGuardianBtn');
  callGuardianBtn = document.getElementById('callGuardianBtn');

  startBtn.addEventListener('click', startMonitoring);
  stopBtn.addEventListener('click', stopMonitoring);
  setGuardianBtn.addEventListener('click', setGuardianNumber);
  callGuardianBtn.addEventListener('click', callGuardian);

  updateGuardianDisplay();
}

/**
 * Update the guardian phone display on the page
 */
function updateGuardianDisplay() {
  if (guardianPhone) {
    guardianPhoneDisplay.textContent = guardianPhone;
    callGuardianBtn.href = `tel:${guardianPhone}`;
    callGuardianBtn.style.display = 'inline-block';
  } else {
    guardianPhoneDisplay.textContent = 'Belum ditetapkan / Not set';
    callGuardianBtn.style.display = 'none';
  }
}

/**
 * Prompt user to set guardian number
 */
function setGuardianNumber() {
  const newPhone = prompt(
    'Masukkan nombor penjaga / Enter guardian number:',
    guardianPhone || ''
  );
  if (newPhone && newPhone.trim()) {
    guardianPhone = newPhone.trim();
    localStorage.setItem('safelah_guardian_phone', guardianPhone);
    updateGuardianDisplay();
  }
}

/**
 * Open tel: link to call guardian
 */
function callGuardian() {
  if (guardianPhone) {
    window.location.href = `tel:${guardianPhone}`;
  }
}

/**
 * Set status pill state
 */
function setStatus(state) {
  // state: 'idle', 'listening', 'analysing', 'alert'
  const labels = {
    idle: 'Bersedia / Ready',
    listening: 'Mendengar... / Listening...',
    analysing: 'Menganalisis... / Analysing...',
    alert: 'BAHAYA / DANGER',
  };

  const colors = {
    idle: '#999',
    listening: '#007bff',
    analysing: '#ffc107',
    alert: '#dc3545',
  };

  statusPill.textContent = labels[state] || labels.idle;
  statusPill.style.backgroundColor = colors[state] || colors.idle;
}

/**
 * Start monitoring call
 */
async function startMonitoring() {
  try {
    setStatus('listening');
    startBtn.disabled = true;

    // 1. Request microphone permission
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (err) {
      alert('Sila benarkan akses mikrofon / Please allow microphone access');
      setStatus('idle');
      startBtn.disabled = false;
      return;
    }

    // 2. Show instruction banner
    instructionBanner.textContent =
      'Letakkan telefon dalam mod pembesar suara sekarang / Put your phone on speaker now';
    instructionBanner.style.display = 'block';

    // 3. Acquire screen wake lock
    try {
      if ('wakeLock' in navigator) {
        wakeLock = await navigator.wakeLock.request('screen');
      }
    } catch (e) {
      // Silently fail — not all browsers support wake lock
      console.log('[liveCall] Wake lock not available');
    }

    // 4. Open WebSocket
    const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${location.host}/ws/live-call`;
    ws = new WebSocket(wsUrl);

    ws.onopen = () => {
      console.log('[liveCall] WebSocket connected');
      // 5. Send init message
      ws.send(
        JSON.stringify({
          type: 'init',
          sessionId,
          guardianPhone: guardianPhone || null,
        })
      );

      // 6. Create MediaRecorder
      recorder = new MediaRecorder(stream, {
        mimeType: 'audio/webm;codecs=opus',
      });

      // 7. On data available, send to WebSocket
      recorder.ondataavailable = (event) => {
        if (ws && ws.readyState === WebSocket.OPEN) {
          ws.send(event.data);
        }
      };

      recorder.start(3000); // Emit data every 3 seconds
      isMonitoring = true;
      stopBtn.disabled = false;
    };

    ws.onerror = () => {
      console.error('[liveCall] WebSocket error');
      showBilingualMessage(
        'Koneksyon terputus. Sila cuba lagi. / Connection lost. Please try again.'
      );
    };

    ws.onclose = () => {
      console.log('[liveCall] WebSocket closed');
      if (isMonitoring) {
        showBilingualMessage(
          'Pemantauan dihentikan / Monitoring stopped'
        );
      }
    };

    // Open EventSource for live verdict
    sse = new EventSource(`/api/live-verdict/${sessionId}`);

    sse.onmessage = (event) => {
      try {
        const verdict = JSON.parse(event.data);
        updateVerdictDisplay(verdict);
      } catch (e) {
        console.error('[liveCall] Failed to parse verdict:', e);
      }
    };

    sse.onerror = () => {
      console.error('[liveCall] SSE error, closing connection');
      sse.close();
    };
  } catch (err) {
    console.error('[liveCall] Start monitoring error:', err);
    alert('Error starting monitor / Ralat memulakan pemantauan');
    setStatus('idle');
    startBtn.disabled = false;
  }
}

/**
 * Stop monitoring call
 */
async function stopMonitoring() {
  isMonitoring = false;
  setStatus('idle');
  instructionBanner.style.display = 'none';
  startBtn.disabled = false;
  stopBtn.disabled = true;

  if (recorder && recorder.state !== 'inactive') {
    recorder.stop();
  }

  if (ws) {
    ws.close();
  }

  if (sse) {
    sse.close();
  }

  if (stream) {
    stream.getTracks().forEach((t) => t.stop());
  }

  if (wakeLock) {
    try {
      await wakeLock.release();
    } catch (e) {
      console.log('[liveCall] Wake lock release error:', e.message);
    }
  }
}

/**
 * Update verdict display with new data
 */
function updateVerdictDisplay(verdict) {
  const { riskLevel, transcript, advice, scamType } = verdict;

  setStatus('analysing');

  // Update transcript panel
  if (transcript) {
    const lines = transcript.split('\n').filter((l) => l.trim());
    const lastTen = lines.slice(-10);
    transcriptPanel.innerHTML = '';

    lastTen.forEach((line) => {
      const div = document.createElement('div');
      div.style.marginBottom = '4px';
      div.style.fontFamily = 'monospace';
      div.style.fontSize = '12px';
      div.style.lineHeight = '1.4';

      if (line.startsWith('Caller:')) {
        div.style.color = '#dc3545';
      } else if (line.startsWith('User:')) {
        div.style.color = '#007bff';
      } else {
        div.style.color = '#333';
      }

      div.textContent = line;
      transcriptPanel.appendChild(div);
    });

    transcriptPanel.scrollTop = transcriptPanel.scrollHeight;
    transcriptPanel.style.display = 'block';
  }

  // Update risk badge
  riskBadge.style.display = 'block';

  if (riskLevel === 'SAFE' || riskLevel === 'LOW') {
    riskBadge.style.backgroundColor = '#28a745';
    riskBadge.style.animation = 'none';
    riskBadge.textContent = 'Selamat / Safe';
    advicePanel.style.display = 'none';
    setStatus('listening');
  } else if (riskLevel === 'MEDIUM') {
    riskBadge.style.backgroundColor = '#ffc107';
    riskBadge.style.animation = 'none';
    riskBadge.style.color = '#000';
    riskBadge.textContent = 'Syak Wasangka / Suspicious';
    advicePanel.style.display = 'block';
    advicePanel.style.backgroundColor = '#fff3cd';
    advicePanel.innerHTML = `<strong>Nasihat / Advice:</strong><br>${advice || ''}`;
    setStatus('analysing');
  } else if (riskLevel === 'HIGH') {
    riskBadge.style.backgroundColor = '#dc3545';
    riskBadge.style.animation = 'pulse 1s infinite';
    riskBadge.style.color = '#fff';
    riskBadge.textContent = 'BAHAYA! SCAM DIKESAN / DANGER! SCAM DETECTED';
    advicePanel.style.display = 'block';
    advicePanel.style.backgroundColor = '#f8d7da';
    advicePanel.innerHTML = `
      <strong>⚠️ BAHAYA / WARNING:</strong><br>
      Jenis: ${scamType || 'Tidak diketahui / Unknown'}<br>
      <br>
      ${advice || ''}
      <br><br>
      ${
        guardianPhone
          ? `<button id="emergencyCallBtn" style="padding: 10px 20px; background: #dc3545; color: white; border: none; border-radius: 4px; cursor: pointer; font-size: 14px; font-weight: bold;">Hubungi Penjaga / Call Guardian</button>`
          : ''
      }
    `;

    if (guardianPhone) {
      setTimeout(() => {
        const btn = document.getElementById('emergencyCallBtn');
        if (btn) {
          btn.addEventListener('click', callGuardian);
        }
      }, 0);
    }

    setStatus('alert');
  }
}

/**
 * Show a bilingual message alert
 */
function showBilingualMessage(msg) {
  const div = document.createElement('div');
  div.style.padding = '10px';
  div.style.marginBottom = '10px';
  div.style.backgroundColor = '#e2e3e5';
  div.style.border = '1px solid #999';
  div.style.borderRadius = '4px';
  div.style.textAlign = 'center';
  div.textContent = msg;
  transcriptPanel.parentElement.insertBefore(div, transcriptPanel);

  setTimeout(() => div.remove(), 3000);
}

// Initialize on DOM ready
document.addEventListener('DOMContentLoaded', initializeUI);
