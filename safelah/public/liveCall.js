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
let microphoneIndicator, connectionStatus, systemFeedback;

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
  microphoneIndicator = document.getElementById('microphoneIndicator');
  connectionStatus = document.getElementById('connectionStatus');
  systemFeedback = document.getElementById('systemFeedback');

  startBtn.addEventListener('click', startMonitoring);
  stopBtn.addEventListener('click', stopMonitoring);
  setGuardianBtn.addEventListener('click', setGuardianNumber);
  callGuardianBtn.addEventListener('click', callGuardian);

  updateGuardianDisplay();
  updateConnectionStatus('idle');
}

/**
 * Update guardian phone display
 */
function updateGuardianDisplay() {
  if (guardianPhone) {
    guardianPhoneDisplay.textContent = guardianPhone;
    callGuardianBtn.href = `tel:${guardianPhone}`;
    callGuardianBtn.style.display = 'inline-block';
  } else {
    guardianPhoneDisplay.textContent = 'Not set';
    callGuardianBtn.style.display = 'none';
  }
}

/**
 * Update connection status indicator
 */
function updateConnectionStatus(state) {
  // state: 'idle', 'connecting', 'connected', 'error'
  const messages = {
    idle: 'Ready to start',
    connecting: 'Connecting...',
    connected: '✓ Connected',
    error: '✗ Connection error',
  };

  const classes = {
    idle: 'connecting',
    connecting: 'connecting',
    connected: 'connected',
    error: 'error',
  };

  connectionStatus.textContent = messages[state] || messages.idle;
  connectionStatus.className = classes[state] || classes.idle;
}

/**
 * Update system feedback message
 */
function updateSystemFeedback(message) {
  systemFeedback.textContent = message;
}

/**
 * Prompt user to set guardian number
 */
function setGuardianNumber() {
  const newPhone = prompt(
    'Enter guardian phone number:',
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
    idle: 'Ready',
    listening: 'Listening...',
    analysing: 'Analyzing...',
    alert: 'DANGER!',
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
    updateConnectionStatus('connecting');
    updateSystemFeedback('Requesting microphone access...');

    // 1. Request microphone permission
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      updateSystemFeedback('✓ Microphone access granted');
      microphoneIndicator.style.display = 'block';
    } catch (err) {
      alert('Please allow microphone access to use the call companion');
      setStatus('idle');
      startBtn.disabled = false;
      updateConnectionStatus('error');
      updateSystemFeedback('Microphone access denied');
      return;
    }

    // 2. Show instruction banner
    instructionBanner.textContent = 'Please put your phone on speaker now';
    instructionBanner.style.display = 'block';

    // 3. Acquire screen wake lock
    try {
      if ('wakeLock' in navigator) {
        wakeLock = await navigator.wakeLock.request('screen');
        updateSystemFeedback('✓ Screen wake lock activated');
      }
    } catch (e) {
      console.log('[liveCall] Wake lock not available');
    }

    // 4. Open WebSocket
    const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${location.host}/ws/live-call`;
    updateSystemFeedback('Establishing connection...');
    
    ws = new WebSocket(wsUrl);

    ws.onopen = () => {
      console.log('[liveCall] WebSocket connected');
      updateConnectionStatus('connected');
      updateSystemFeedback('✓ Connected and monitoring');
      
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
          updateSystemFeedback('📡 Audio data sent');
        }
      };

      recorder.start(3000); // Emit data every 3 seconds
      isMonitoring = true;
      stopBtn.disabled = false;
      stopBtn.style.display = 'flex';
      startBtn.style.display = 'none';
      transcriptPanel.style.display = 'block';
    };

    ws.onerror = () => {
      console.error('[liveCall] WebSocket error');
      updateConnectionStatus('error');
      updateSystemFeedback('❌ Connection error. Please try again.');
      alert('Connection error. Please restart monitoring.');
    };

    ws.onclose = () => {
      console.log('[liveCall] WebSocket closed');
      if (isMonitoring) {
        updateConnectionStatus('idle');
        updateSystemFeedback('Monitoring stopped');
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
    alert('Error starting monitor: ' + err.message);
    setStatus('idle');
    startBtn.disabled = false;
    updateConnectionStatus('error');
    updateSystemFeedback('Failed to start monitoring');
  }
}

/**
 * Stop monitoring call
 */
async function stopMonitoring() {
  isMonitoring = false;
  setStatus('idle');
  instructionBanner.style.display = 'none';
  microphoneIndicator.style.display = 'none';
  startBtn.disabled = false;
  startBtn.style.display = 'flex';
  stopBtn.disabled = true;
  stopBtn.style.display = 'none';
  updateConnectionStatus('idle');
  updateSystemFeedback('Monitoring stopped');

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
    updateSystemFeedback('📝 Transcription received');
  }

  // Update risk badge
  riskBadge.style.display = 'block';

  if (riskLevel === 'SAFE' || riskLevel === 'LOW') {
    riskBadge.style.backgroundColor = '#28a745';
    riskBadge.style.animation = 'none';
    riskBadge.textContent = '✓ Safe';
    advicePanel.style.display = 'none';
    updateSystemFeedback('✓ This conversation appears safe');
    setStatus('listening');
  } else if (riskLevel === 'MEDIUM') {
    riskBadge.style.backgroundColor = '#ffc107';
    riskBadge.style.animation = 'none';
    riskBadge.style.color = '#000';
    riskBadge.textContent = '⚠️ Suspicious Activity Detected';
    advicePanel.style.display = 'block';
    advicePanel.style.backgroundColor = '#fff3cd';
    advicePanel.innerHTML = `<strong>⚠️ Advice:</strong><br>${advice || 'Be cautious with this caller'}`;
    updateSystemFeedback('⚠️ Suspicious pattern detected');
    setStatus('analysing');
  } else if (riskLevel === 'HIGH') {
    riskBadge.style.backgroundColor = '#dc3545';
    riskBadge.style.animation = 'pulse 1s infinite';
    riskBadge.style.color = '#fff';
    riskBadge.textContent = '🚨 SCAM DETECTED! DANGER!';
    advicePanel.style.display = 'block';
    advicePanel.style.backgroundColor = '#f8d7da';
    advicePanel.innerHTML = `
      <strong>🚨 WARNING:</strong><br>
      Scam Type: ${scamType || 'Unknown'}<br>
      <br>
      ${advice || 'Do not share personal information or money'}<br><br>
      ${
        guardianPhone
          ? `<button id="emergencyCallBtn" style="padding: 10px 20px; background: #dc3545; color: white; border: none; border-radius: 4px; cursor: pointer; font-size: 14px; font-weight: bold;">📞 Call Guardian</button>`
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

    updateSystemFeedback('🚨 HIGH RISK SCAM DETECTED');
    setStatus('alert');
  }
}

// Initialize on DOM ready
document.addEventListener('DOMContentLoaded', initializeUI);
