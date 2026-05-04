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
let isStopping = false;
let finalVerdictResolver = null;

// UI elements (cached on init)
let startBtn, stopBtn, testBtn, statusPill, instructionBanner;
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
  testBtn = document.getElementById('testBtn');

  startBtn.addEventListener('click', startMonitoring);
  stopBtn.addEventListener('click', () => stopMonitoring());
  setGuardianBtn.addEventListener('click', setGuardianNumber);
  callGuardianBtn.addEventListener('click', callGuardian);
  if (testBtn) {
    testBtn.addEventListener('click', startMonitoringTestMode);
  }

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
    connected: 'Connected',
    error: 'Connection error',
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

function showMonitoringControls(active) {
  startBtn.disabled = active;
  startBtn.style.display = active ? 'none' : 'flex';
  stopBtn.disabled = !active;
  stopBtn.style.display = active ? 'flex' : 'none';
  if (testBtn) {
    testBtn.disabled = active;
    testBtn.style.display = active ? 'none' : 'flex';
  }
}

function resetLiveSession() {
  sessionId = crypto.randomUUID();
  finalVerdictResolver = null;
  transcriptPanel.innerHTML = '';
  transcriptPanel.style.display = 'none';
  riskBadge.style.display = 'none';
  advicePanel.style.display = 'none';
}

function waitForFinalVerdict(timeoutMs = 15000) {
  return new Promise((resolve) => {
    let settled = false;
    const timeout = setTimeout(() => {
      if (settled) {
        return;
      }
      settled = true;
      finalVerdictResolver = null;
      resolve(null);
    }, timeoutMs);

    finalVerdictResolver = (verdict) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeout);
      finalVerdictResolver = null;
      resolve(verdict);
    };
  });
}

function stopRecorderAndFlush() {
  return new Promise((resolve) => {
    if (!recorder || recorder.state === 'inactive') {
      resolve();
      return;
    }

    recorder.ondataavailable = (event) => {
      if (event.data.size > 0 && ws && ws.readyState === WebSocket.OPEN) {
        console.log('[liveCall] Sending final audio chunk, size:', event.data.size);
        ws.send(event.data);
      }
    };
    recorder.onstop = () => resolve();

    try {
      recorder.requestData();
    } catch (err) {
      console.warn('[liveCall] Could not request final recorder data:', err.message);
    }
    recorder.stop();
  });
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
 * Start monitoring in TEST MODE (skips microphone permission for debugging)
 */
async function startMonitoringTestMode() {
  try {
    resetLiveSession();
    setStatus('listening');
    isMonitoring = true;
    isStopping = false;
    showMonitoringControls(true);
    updateConnectionStatus('connecting');
    updateSystemFeedback('TEST MODE: Skipping microphone, testing connection only...');
    microphoneIndicator.style.display = 'block';

    // Create a dummy silent stream for testing
    const audioContext = new (window.AudioContext || window.webkitAudioContext)();
    const oscillator = audioContext.createOscillator();
    const gainNode = audioContext.createGain();
    gainNode.gain.setValueAtTime(0, audioContext.currentTime); // Silent
    oscillator.connect(gainNode);
    gainNode.connect(audioContext.destination);
    oscillator.start();

    // Get the actual destination (may not work, but we only need minimal setup)
    const mediaStreamAudioDestinationNode = audioContext.createMediaStreamDestination();
    gainNode.connect(mediaStreamAudioDestinationNode);
    stream = mediaStreamAudioDestinationNode.stream;
    
    console.log('[liveCall] Test mode: Created mock audio stream');
    updateSystemFeedback('Mock audio stream created');

    // Continue with normal WebSocket flow
    continuteMonitoringAfterMicrophone();
  } catch (err) {
    console.error('[liveCall] Test mode error:', err);
    isMonitoring = false;
    setStatus('idle');
    showMonitoringControls(false);
    updateConnectionStatus('error');
    updateSystemFeedback('Test mode failed: ' + err.message);
  }
}

/**
 * Start monitoring call
 */
async function startMonitoring() {
  try {
    resetLiveSession();
    setStatus('listening');
    isMonitoring = true;
    isStopping = false;
    showMonitoringControls(true);
    updateConnectionStatus('connecting');
    updateSystemFeedback('Requesting microphone access...');

    // 1. Request microphone permission
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      updateSystemFeedback('Microphone access granted');
      microphoneIndicator.style.display = 'block';
    } catch (err) {
      console.error('[liveCall] Microphone error:', err);
      alert('Microphone access required. Please allow microphone permission in your browser settings.');
      isMonitoring = false;
      setStatus('idle');
      showMonitoringControls(false);
      updateConnectionStatus('error');
      updateSystemFeedback('Microphone permission denied. Allow access in browser settings.');
      return;
    }

    // Continue with WebSocket and monitoring
    await continuteMonitoringAfterMicrophone();
  } catch (err) {
    console.error('[liveCall] Start monitoring error:', err);
    isMonitoring = false;
    setStatus('idle');
    showMonitoringControls(false);
    updateConnectionStatus('error');
    updateSystemFeedback('Error: ' + err.message);
  }
}

/**
 * Continue monitoring after microphone is available (shared by both normal and test modes)
 */
async function continuteMonitoringAfterMicrophone() {
  try {
    isMonitoring = true;
    isStopping = false;
    showMonitoringControls(true);

    // Show instruction banner
    instructionBanner.textContent = 'Please put your phone on speaker now';
    instructionBanner.style.display = 'block';

    // Acquire screen wake lock
    try {
      if ('wakeLock' in navigator) {
        wakeLock = await navigator.wakeLock.request('screen');
        updateSystemFeedback('Screen wake lock activated');
      }
    } catch (e) {
      console.log('[liveCall] Wake lock not available');
    }

    // Open WebSocket
    const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${location.host}/ws/live-call`;
    console.log('[liveCall] WebSocket URL:', wsUrl);
    console.log('[liveCall] Session ID:', sessionId);
    updateSystemFeedback('Establishing connection...');
    
    ws = new WebSocket(wsUrl);
    console.log('[liveCall] WebSocket object created, readyState:', ws.readyState);

    // Add connection timeout
    const connectionTimeout = setTimeout(() => {
      if (ws && ws.readyState === WebSocket.CONNECTING) {
        console.error('[liveCall] WebSocket connection timeout');
        updateSystemFeedback('Connection timeout. Server may be offline.');
        stopMonitoring('Connection timeout. Server may be offline.', { requestFinal: false });
      }
    }, 5000); // 5 second timeout

    ws.onopen = () => {
      clearTimeout(connectionTimeout);
      console.log('[liveCall] WebSocket connected, readyState:', ws.readyState);
      updateConnectionStatus('connected');
      updateSystemFeedback('Connected and monitoring');
      
      // 5. Send init message
      const initMsg = JSON.stringify({
        type: 'init',
        sessionId,
        guardianPhone: guardianPhone || null,
      });
      console.log('[liveCall] Sending init message:', initMsg);
      ws.send(initMsg);

      // 6. Create MediaRecorder
      recorder = new MediaRecorder(stream, {
        mimeType: 'audio/webm;codecs=opus',
      });
      console.log('[liveCall] MediaRecorder created');

      // 7. On data available, send to WebSocket
      recorder.ondataavailable = (event) => {
        if (isMonitoring && !isStopping && event.data.size > 0 && ws && ws.readyState === WebSocket.OPEN) {
          console.log('[liveCall] Sending audio chunk, size:', event.data.size);
          ws.send(event.data);
          updateSystemFeedback('Audio data sent');
        } else {
          console.warn('[liveCall] WebSocket not open, cannot send audio. readyState:', ws ? ws.readyState : 'none');
        }
      };

      recorder.start(3000); // Emit data every 3 seconds
      isMonitoring = true;
      showMonitoringControls(true);
      transcriptPanel.style.display = 'block';
    };

    ws.onerror = (event) => {
      console.error('[liveCall] WebSocket error event:', event);
      console.error('[liveCall] WebSocket readyState:', ws ? ws.readyState : 'none');
      console.error('[liveCall] WebSocket URL attempted:', wsUrl);
      updateConnectionStatus('error');
      stopMonitoring('Connection failed. Please make sure the server is running, then start again.', { requestFinal: false });
    };

    ws.onclose = (event) => {
      clearTimeout(connectionTimeout);
      console.log('[liveCall] WebSocket closed, code:', event.code, 'reason:', event.reason);
      console.log('[liveCall] Clean close?', event.wasClean);
      if (isMonitoring && !isStopping && event.code !== 1000) {
        stopMonitoring(event.reason || 'Connection closed unexpectedly.', { requestFinal: false });
      }
    };
    // Open EventSource for live verdict
    sse = new EventSource(`/api/live-verdict/${sessionId}`);

    sse.onmessage = (event) => {
      try {
        const verdict = JSON.parse(event.data);
        updateVerdictDisplay(verdict);
        if (verdict.final && finalVerdictResolver) {
          finalVerdictResolver(verdict);
        }
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
    isMonitoring = false;
    setStatus('idle');
    showMonitoringControls(false);
    updateConnectionStatus('error');
    updateSystemFeedback('Failed to start monitoring');
  }
}

/**
 * Stop monitoring call
 */
async function stopMonitoring(message = 'Monitoring stopped', options = {}) {
  const requestFinal = options.requestFinal !== false && ws && ws.readyState === WebSocket.OPEN;
  isStopping = true;
  setStatus('idle');
  instructionBanner.style.display = 'none';
  microphoneIndicator.style.display = 'none';
  showMonitoringControls(false);
  updateConnectionStatus('idle');
  updateSystemFeedback(requestFinal ? 'Finalizing transcript and scam analysis...' : message);

  if (requestFinal) {
    await stopRecorderAndFlush();
    const finalVerdictPromise = waitForFinalVerdict();
    ws.send(JSON.stringify({ type: 'stop' }));
    const finalVerdict = await finalVerdictPromise;
    if (!finalVerdict) {
      updateSystemFeedback('Stopped. Final analysis timed out, but the latest transcript remains below.');
    }
    if (sse) {
      sse.close();
    }
  } else if (recorder && recorder.state !== 'inactive') {
    recorder.ondataavailable = null;
    recorder.stop();
  }

  isMonitoring = false;

  if (ws) {
    ws.close();
  }

  if (sse && !requestFinal) {
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

  recorder = null;
  stream = null;
  ws = null;
  sse = null;
  wakeLock = null;
  isStopping = false;
}

/**
 * Update verdict display with new data
 */
function updateVerdictDisplay(verdict) {
  const { riskLevel, transcript, advice, scamType, final, transcriptOnly } = verdict;

  if (!transcriptOnly) {
    setStatus('analysing');
  }

  // Update transcript panel
  if (transcript) {
    const lines = transcript.split('\n').filter((l) => l.trim());
    const visibleLines = final ? lines : lines.slice(-10);
    transcriptPanel.innerHTML = '';

    visibleLines.forEach((line) => {
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
    updateSystemFeedback(final ? 'Final transcript and scam analysis ready' : 'Transcription received');
  } else if (final) {
    transcriptPanel.innerHTML = '';
    const div = document.createElement('div');
    div.textContent = 'No speech was transcribed.';
    transcriptPanel.appendChild(div);
    transcriptPanel.style.display = 'block';
  }

  if (transcriptOnly) {
    return;
  }

  // Update risk badge
  riskBadge.style.display = 'block';

  if (riskLevel === 'SAFE' || riskLevel === 'LOW') {
    riskBadge.style.backgroundColor = '#28a745';
    riskBadge.style.animation = 'none';
    riskBadge.textContent = final ? 'Final Result: Safe' : 'Safe';
    if (final && advice) {
      advicePanel.style.display = 'block';
      advicePanel.style.backgroundColor = '#d4edda';
      advicePanel.innerHTML = `<strong>Analysis:</strong><br>${advice}`;
    } else {
      advicePanel.style.display = 'none';
    }
    updateSystemFeedback(final ? 'Final analysis complete: this conversation appears safe' : 'This conversation appears safe');
    setStatus(final ? 'idle' : 'listening');
  } else if (riskLevel === 'MEDIUM') {
    riskBadge.style.backgroundColor = '#ffc107';
    riskBadge.style.animation = 'none';
    riskBadge.style.color = '#000';
    riskBadge.textContent = final ? 'Final Result: Suspicious Activity Detected' : 'Suspicious Activity Detected';
    advicePanel.style.display = 'block';
    advicePanel.style.backgroundColor = '#fff3cd';
    advicePanel.innerHTML = `<strong>Advice:</strong><br>${advice || 'Be cautious with this caller'}`;
    updateSystemFeedback(final ? 'Final analysis complete: suspicious pattern detected' : 'Suspicious pattern detected');
    setStatus(final ? 'idle' : 'analysing');
  } else if (riskLevel === 'HIGH') {
    riskBadge.style.backgroundColor = '#dc3545';
    riskBadge.style.animation = 'pulse 1s infinite';
    riskBadge.style.color = '#fff';
    riskBadge.textContent = final ? 'Final Result: SCAM DETECTED! DANGER!' : 'SCAM DETECTED! DANGER!';
    advicePanel.style.display = 'block';
    advicePanel.style.backgroundColor = '#f8d7da';
    advicePanel.innerHTML = `
      <strong>WARNING:</strong><br>
      Scam Type: ${scamType || 'Unknown'}<br>
      <br>
      ${advice || 'Do not share personal information or money'}<br><br>
      ${
        guardianPhone
          ? `<button id="emergencyCallBtn" style="padding: 10px 20px; background: #dc3545; color: white; border: none; border-radius: 4px; cursor: pointer; font-size: 14px; font-weight: bold;">Call Guardian</button>`
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

    updateSystemFeedback(final ? 'Final analysis complete: HIGH RISK SCAM DETECTED' : 'HIGH RISK SCAM DETECTED');
    setStatus('alert');
  }
}

// Initialize on DOM ready
document.addEventListener('DOMContentLoaded', initializeUI);
