// ── SafeLah Chat Client — Conversational Auth + Scam Detection ─────────────

const chatArea        = document.getElementById('chatArea');
const messageInput    = document.getElementById('messageInput');
const sendBtn         = document.getElementById('sendBtn');
const imageInput      = document.getElementById('imageInput');
const imagePreviewBar = document.getElementById('imagePreviewBar');
const imagePreviewImg = document.getElementById('imagePreviewImg');
const imageRemoveBtn  = document.getElementById('imageRemoveBtn');
const dropOverlay     = document.getElementById('dropOverlay');
const pwdOverlay      = document.getElementById('pwdOverlay');       // password input overlay
const pwdInput        = document.getElementById('pwdInput');
const pwdSendBtn      = document.getElementById('pwdSendBtn');

let pendingImage = null;
let isProcessing = false;
const sessionId  = 'web-' + Math.random().toString(36).slice(2, 10);

// ── Batch mode state ───────────────────────────────────────────────────────────
let batchMode = false;
let batchMessages = []; // { type: 'text'|'image', text?, image?, mimeType? }

// ── Auth state machine ─────────────────────────────────────────────────────────
// Modes: idle | reg_username | reg_password | reg_confirm |
//        login_username | login_password | logged_in
let authState = {
  mode:     'idle',
  data:     {},          // temp data collected during registration/login
  loggedIn: false,
  user:     null,        // { username, role, guardianCode }
};

// ── Initialise: check if already logged in ────────────────────────────────────
(async function init() {
  try {
    const r    = await fetch('/api/auth/me', { credentials: 'include' });
    const data = await r.json();
    if (data.loggedIn) {
      authState.loggedIn = true;
      authState.mode     = 'logged_in';
      authState.user     = { username: data.username, role: data.role };
      updateHeaderBadge();
      if (data.role === 'guardian') startAlertStream();
      addBotMessage(
          `👋 Welcome back, *${data.username}*!\n` +
        (data.role === 'guardian'
            ? `👨‍👩‍👧 You are logged in as a Guardian.\nType /mycode to view your code.\n\nSend a suspicious message to check it.`
            : `Send a suspicious message to check it.`)
      );
    } else {
      showWelcome();
    }
  } catch (_) {
    showWelcome();
  }
})();

function showWelcome() {
  authState.mode = 'idle';
  const welcomeEl = document.getElementById('welcomeMsg');
  if (welcomeEl) welcomeEl.remove();
  addBotMessage(
    `🛡️ Welcome to *SafeLah*!\n\n` +
    `I am your scam-checking assistant.\n\n` +
    `Type a command:\n` +
    `  /start    — start batch analysis (text + images)\n` +
    `  /call     — start call companion for scam detection\n` +
    `  /register — create a new account\n` +
    `  /login    — log in\n\n` +
    `Or send a suspicious message directly to check it without an account.`
  );
}

// ── Header badge ──────────────────────────────────────────────────────────────
function updateHeaderBadge() {
  const badge  = document.getElementById('userBadge');
  const icon   = document.getElementById('userBadgeIcon');
  const name   = document.getElementById('userBadgeName');
  const logout = document.getElementById('logoutBtn');
  if (!authState.user) {
    if (badge)  badge.style.display  = 'none';
    if (logout) logout.style.display = 'none';
    return;
  }
  if (badge)  badge.style.display  = 'flex';
  if (logout) logout.style.display = 'flex';
  if (icon)   icon.textContent  = authState.user.role === 'guardian' ? '👨‍👩‍👧' : '👴';
  if (name)   name.textContent  = authState.user.username +
    (authState.user.role === 'guardian' ? ' (Guardian)' : '');
}

// Hide badge/logout until logged in
(function() {
  const badge  = document.getElementById('userBadge');
  const logout = document.getElementById('logoutBtn');
  if (badge)  badge.style.display  = 'none';
  if (logout) logout.style.display = 'none';
})();

// ── Logout ────────────────────────────────────────────────────────────────────
const logoutBtn = document.getElementById('logoutBtn');
if (logoutBtn) {
  logoutBtn.addEventListener('click', async () => {
    await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' });
    authState = { mode: 'idle', data: {}, loggedIn: false, user: null };
    isCallActive = false;
    updateHeaderBadge();
    updateCallButtonsVisibility();
    // Clear chat then show welcome
    chatArea.innerHTML = '';
    showWelcome();
  });
}

// ── Password overlay handler ───────────────────────────────────────────────────
if (pwdInput && pwdSendBtn) {
  pwdInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); submitPassword(); }
  });
  pwdSendBtn.addEventListener('click', submitPassword);
}

function showPasswordInput(placeholder) {
  if (!pwdOverlay) return;
  pwdInput.value       = '';
  pwdInput.placeholder = placeholder;
  pwdOverlay.style.display = 'flex';
  setTimeout(() => pwdInput.focus(), 50);
  // Hide normal input
  messageInput.closest('.input-container').style.display = 'none';
  sendBtn.style.display = 'none';
}

function hidePasswordInput() {
  if (!pwdOverlay) return;
  pwdOverlay.style.display = 'none';
  messageInput.closest('.input-container').style.display = 'flex';
  sendBtn.style.display = '';
  messageInput.focus();
}

function submitPassword() {
  const val = pwdInput.value;
  if (!val) return;
  hidePasswordInput();
  // Mask the password in chat as dots
  addUserMessage('•'.repeat(Math.min(val.length, 10)));
  handleAuthStep(val);
}

// ── Main send handler ─────────────────────────────────────────────────────────
messageInput.addEventListener('input', () => {
  messageInput.style.height = 'auto';
  messageInput.style.height = Math.min(messageInput.scrollHeight, 120) + 'px';
  updateSendBtn();
});

function updateSendBtn() {
  sendBtn.disabled = isProcessing || (!messageInput.value.trim() && !pendingImage);
}

messageInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    if (!sendBtn.disabled) handleSend();
  }
});
sendBtn.addEventListener('click', handleSend);

async function handleSend() {
  const text  = messageInput.value.trim();
  const image = pendingImage;
  if (!text && !image) return;
  if (isProcessing) return;

  messageInput.value = '';
  messageInput.style.height = 'auto';

  if (image) {
    addImageMessage(image.base64);
    clearImage();
  }

  // ── Route: slash commands or auth steps ──────────────────────────────────
  if (!image && text.startsWith('/')) {
    addCommandMessage(text);
    await handleSlashCommand(text);
    return;
  }

  if (authState.mode !== 'idle' && authState.mode !== 'logged_in') {
    // We're in an auth flow step — non-password step
    addUserMessage(text);
    await handleAuthStep(text);
    return;
  }

  // ── Audio handling: Transcribe first ─────────────────────────────────────
  let processedText = text;
  let processedImage = image;
  if (image && (image.mimeType.startsWith('audio/') || image.mimeType.startsWith('application/ogg') || image.mimeType.startsWith('video/'))) {
    isProcessing = true;
    updateSendBtn();
    const thinking = addThinking('Mendengar audio...');
    try {
      const res = await fetch('/api/transcribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ audio: image.base64, mimeType: image.mimeType, fileName: image.fileName, sessionId })
      });
      const data = await res.json();
      thinking.remove();
      if (data.transcript) {
        addUserMessage('🎤 Transkrip: "' + data.transcript + '"');
        processedText = text ? text + '\n' + data.transcript : data.transcript;
        processedImage = null; // Don't send as image to Gemini
      } else {
        addBotMessage('❌ Tidak dapat memproses audio ini atau tiada suara dikesan.');
        isProcessing = false; updateSendBtn(); return;
      }
    } catch (err) {
      thinking.remove();
      addBotMessage('❌ Ralat memproses audio.');
      isProcessing = false; updateSendBtn(); return;
    }
  }

  // ── Batch mode: collect messages instead of analysing ────────────────────
  if (batchMode) {
    if (processedImage) {
      batchMessages.push({ type: 'image', image: processedImage.base64, mimeType: processedImage.mimeType });
      if (processedText) {
        if (!image?.mimeType?.startsWith('audio/')) addUserMessage(processedText);
        batchMessages.push({ type: 'text', text: processedText });
      }
    } else if (processedText) {
      if (!image?.mimeType?.startsWith('audio/')) addUserMessage(processedText);
      batchMessages.push({ type: 'text', text: processedText });
    }
    const textCount = batchMessages.filter(m => m.type === 'text').length;
    const imgCount  = batchMessages.filter(m => m.type === 'image').length;
    addBotMessage(
      `✅ Collected: *${textCount}* messages, *${imgCount}* images\n\n` +
      `Keep sending more messages/images, or type:\n` +
      `  /analyze — analyze everything\n` +
      `  /cancel — cancel`
    );
    isProcessing = false;
    updateSendBtn();
    return;
  }

  // ── Normal message (scam check) ──────────────────────────────────────────
  if (processedImage || processedText) {
    if (processedText && !processedImage && (!image || !image.mimeType.startsWith('audio/'))) {
      addUserMessage(processedText);
    }
    await runScamCheck(processedText, processedImage);
  }
}

// ── Slash command router ──────────────────────────────────────────────────────
async function handleSlashCommand(cmd) {
  const lower = cmd.toLowerCase().trim();

  if (lower === '/register') {
    if (authState.loggedIn) {
      addBotMessage(`✋ You are already logged in as *${authState.user.username}*.\nType /logout to log out first.`);
      return;
    }
    authState.mode = 'reg_username';
    authState.data = {};
    addBotMessage('📝 Register a new account\n\nEnter your *username*:');
    return;
  }

  if (lower === '/login') {
    if (authState.loggedIn) {
      addBotMessage(`✋ You are already logged in as *${authState.user.username}*.`);
      return;
    }
    authState.mode = 'login_username';
    authState.data = {};
    addBotMessage('🔑 Log in\n\nEnter your *username*:');
    return;
  }

  if (lower === '/logout') {
    if (!authState.loggedIn) {
      addBotMessage('❓ You are not logged in yet.');
      return;
    }
    await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' });
    authState = { mode: 'idle', data: {}, loggedIn: false, user: null };
    updateHeaderBadge();
    chatArea.innerHTML = '';
    showWelcome();
    return;
  }

  if (lower === '/mycode') {
    if (!authState.loggedIn || authState.user.role !== 'guardian') {
      addBotMessage('❌ This command is only for logged-in Guardians.');
      return;
    }
    try {
      const r    = await fetch('/api/auth/my-code', { credentials: 'include' });
      const data = await r.json();
      addPinMessage(data.guardianCode, authState.user.username);
    } catch (_) {
      addBotMessage('❌ Tidak dapat mendapatkan kod. Cuba lagi.');
    }
    return;
  }

  // ── Batch mode commands ──────────────────────────────────────────────────
  if (lower === '/start' || lower === '/mula') {
    if (batchMode) {
      addBotMessage(`⚠️ Batch mode is already active. You have *${batchMessages.length}* items.\nType /analyze to analyze or /cancel to stop.`);
      return;
    }
    batchMode = true;
    batchMessages = [];
    addBotMessage(
      `📦 *Batch Analysis Mode*\n\n` +
      `Now send all suspicious messages - text and/or images.\n\n` +
      `I will collect everything, then analyze it as one conversation.\n\n` +
      `Commands:\n` +
      `  /analyze — analyze all collected messages\n` +
      `  /cancel  — cancel and discard everything`
    );
    return;
  }

  if (lower === '/analyze' || lower === '/analisis') {
    if (!batchMode || batchMessages.length === 0) {
      addBotMessage('❌ There are no messages to analyze.\nType /start first, then send suspicious messages.');
      return;
    }
    batchMode = false;
    await runBatchAnalysis();
    return;
  }

  if (lower === '/cancel' || lower === '/batalkan') {
    if (!batchMode) {
      addBotMessage('❓ Tiada sesi kelompok aktif.');
      return;
    }
    const count = batchMessages.length;
    batchMode = false;
    batchMessages = [];
    addBotMessage(`🗑️ Batch session cancelled. ${count} items discarded.`);
    return;
  }

  if (lower === '/call') {
    addBotMessage(
      `📞 *Call Companion Mode*\n\n` +
      `I will monitor your call and alert you to potential scams in real-time.\n\n` +
      `🔊 Important: Please make sure your speaker is turned ON so you can hear alerts.\n\n` +
      `Opening call companion...`
    );
    setTimeout(() => {
      openCallCompanion();
    }, 1000);
    return;
  }

  if (lower.startsWith('/family ')) {
    const code = lower.replace('/family ', '').trim();
    if (!authState.loggedIn) {
      addBotMessage('❌ Please /login first before using /family.');
      return;
    }
    if (!/^\d{6}$/.test(code)) {
      addBotMessage('❌ Guardian code must be exactly 6 digits. Example: /family 482917');
      return;
    }
    isProcessing = true;
    updateSendBtn();
    const thinking = addThinking();
    try {
      const r    = await fetch('/api/auth/link-family', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ guardianCode: code }),
      });
      const data = await r.json();
      thinking.remove();
      if (!r.ok) {
        addBotMessage(`❌ ${data.error || 'Kod tidak sah.'}`);
      } else {
        authState.user.role = 'elderly';
        updateHeaderBadge();
        addBotMessage(
          `✅ Successfully linked to Guardian *${data.guardianName}*! 🔗\n\n` +
          `From now on, when I detect a high-risk scam in your messages, ` +
          `${data.guardianName} will receive an automatic alert.`
        );
      }
    } catch (_) {
      thinking.remove();
      addBotMessage('❌ Ralat rangkaian. Cuba lagi.');
    } finally {
      isProcessing = false;
      updateSendBtn();
    }
    return;
  }

  addBotMessage(
    `❓ Unknown command: *${cmd}*\n\n` +
    `Available commands:\n` +
    `  /register — register an account\n` +
    `  /login    — log in\n` +
    `  /logout   — log out\n` +
    `  /call     — start call companion\n` +
    `  /start    — start batch analysis\n` +
    `  /analyze  — analyze collected messages\n` +
    `  /cancel   — cancel batch session\n` +
    `  /mycode   — view your Guardian code\n` +
    `  /family [6-digit] — link to a Guardian`
  );
}

// ── Auth step handler (collects data across multiple messages) ────────────────
async function handleAuthStep(value) {
  const mode = authState.mode;

  // ── REGISTER FLOW ──────────────────────────────────────────────────────────
  if (mode === 'reg_username') {
    if (!value || value.length < 3) {
      addBotMessage('❌ Username must be at least 3 characters. Try again:');
      return;
    }
    if (/\s/.test(value)) {
      addBotMessage('❌ Username cannot contain spaces. Try again:');
      return;
    }
    authState.data.username = value;
    authState.mode = 'reg_password';
    addBotMessage(`👍 Username: *${value}*\n\nNow enter a *password* (at least 8 characters):`);
    showPasswordInput('Password...');
    return;
  }

  if (mode === 'reg_password') {
    if (!value || value.length < 8) {
      addBotMessage('❌ Password must be at least 8 characters. Try again:');
      showPasswordInput('Password...');
      return;
    }
    authState.data.password = value;
    authState.mode = 'reg_confirm';
    addBotMessage('🔒 Okay! Enter the password again to *confirm* it:');
    showPasswordInput('Confirm password...');
    return;
  }

  if (mode === 'reg_confirm') {
    if (value !== authState.data.password) {
      addBotMessage('❌ Passwords do not match. Enter the password again:');
      authState.mode = 'reg_password';
      showPasswordInput('Password...');
      return;
    }
    // Call register API
    isProcessing = true;
    updateSendBtn();
    const thinking = addThinking('Registering...');
    try {
      const r    = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ username: authState.data.username, password: authState.data.password }),
      });
      const data = await r.json();
      thinking.remove();
      if (!r.ok) {
        authState.mode = 'idle';
        authState.data = {};
        addBotMessage(`❌ ${data.error || 'Registration failed.'}\n\nType /register to try again.`);
      } else {
        authState.loggedIn = true;
        authState.mode     = 'logged_in';
        authState.user     = { username: data.username, role: 'guardian', guardianCode: data.guardianCode };
        authState.data     = {};
        updateHeaderBadge();
        startAlertStream();
        addBotMessage(`✅ Account successfully registered!\n\nYou are logged in as *${data.username}*.\n\nYour code to share with family:`);
        addPinMessage(data.guardianCode, data.username);
        addBotMessage(
          `📤 How to use:\n` +
          `1. Share the code above with your family member\n` +
          `2. They open SafeLah, type /register to sign up\n` +
          `3. Then type /family ${data.guardianCode}\n` +
          `4. When they find a scam message, you will get an instant alert 🔔`
        );
      }
    } catch (_) {
      thinking.remove();
      authState.mode = 'idle';
      authState.data = {};
      addBotMessage('❌ Network error. Type /register to try again.');
    } finally {
      isProcessing = false;
      updateSendBtn();
    }
    return;
  }

  // ── LOGIN FLOW ─────────────────────────────────────────────────────────────
  if (mode === 'login_username') {
    authState.data.username = value;
    authState.mode = 'login_password';
    addBotMessage(`Enter the *password* for *${value}*:`);
    showPasswordInput('Password...');
    return;
  }

  if (mode === 'login_password') {
    isProcessing = true;
    updateSendBtn();
    const thinking = addThinking('Logging in...');
    try {
      const r    = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ username: authState.data.username, password: value }),
      });
      const data = await r.json();
      thinking.remove();
      if (!r.ok) {
        authState.mode = 'idle';
        authState.data = {};
        addBotMessage(`❌ ${data.error || 'Log in failed.'}\n\nType /login to try again.`);
      } else {
        authState.loggedIn = true;
        authState.mode     = 'logged_in';
        authState.user     = { username: data.username, role: data.role, guardianCode: data.guardianCode };
        authState.data     = {};
        updateHeaderBadge();
        if (data.role === 'guardian') {
          startAlertStream();
          addBotMessage(
            `✅ Welcome back, *${data.username}*! 👨‍👩‍👧\n\n` +
            `Type /mycode to view your Guardian code.\n` +
            `Send suspicious messages to check them.`
          );
        } else {
          addBotMessage(
            `✅ Welcome, *${data.username}*! 👴\n\n` +
            `Send suspicious messages to check them.\n` +
            `If there is a scam, your Guardian will get an instant alert.`
          );
        }
      }
    } catch (_) {
      thinking.remove();
      authState.mode = 'idle';
      authState.data = {};
      addBotMessage('❌ Network error. Type /login to try again.');
    } finally {
      isProcessing = false;
      updateSendBtn();
    }
    return;
  }
}

// ── Scam check ────────────────────────────────────────────────────────────────
async function runScamCheck(text, image) {
  isProcessing = true;
  updateSendBtn();
  const thinking = addThinking();

  try {
    let data;
    if (image) {
      const res = await fetch('/api/analyse-image', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ image: image.base64, mimeType: image.mimeType, sessionId }),
      });
      data = await res.json();
    } else {
      const res = await fetch('/api/analyse', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ text, sessionId }),
      });
      data = await res.json();
    }
    thinking.remove();
    const entityHint = (data?.extracted_phones?.[0] || data?.extracted_accounts?.[0] || '');
    addVerdict(getVerdictText(data), data?.risk_level || 'UNKNOWN', entityHint);
    addPipelineDetails(data);
    if (data?.alertSent) {
      addBotMessage('🔔 A security alert has been sent automatically to your Guardian.');
    }
  } catch (err) {
    thinking.remove();
    addVerdict('Sorry, checking is not available right now.\n\nPlease try again shortly. 🙏', 'UNKNOWN');
    console.error('Analysis error:', err);
  } finally {
    isProcessing = false;
    updateSendBtn();
  }
}

// ── Batch analysis ────────────────────────────────────────────────────────────
async function runBatchAnalysis() {
  isProcessing = true;
  updateSendBtn();
  const count = batchMessages.length;
  const textCount = batchMessages.filter(m => m.type === 'text').length;
  const imgCount  = batchMessages.filter(m => m.type === 'image').length;
  const thinking = addThinking(`Analyzing ${count} items (${textCount} messages, ${imgCount} images)...`);

  try {
    const res = await fetch('/api/analyse-batch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ messages: batchMessages, sessionId }),
    });
    const data = await res.json();
    thinking.remove();

    // Show the conversation that was analyzed
    if (data.analyzed_messages && data.analyzed_messages.length > 0) {
      addAnalyzedConversation(data.analyzed_messages);
    }

    // Show batch summary header
    addBotMessage(
      `✅ *Batch Analysis Complete*\n` +
      `Analyzed: *${data.total_messages || count}* items\n` +
      `Mode: Conversation analysis`
    );

    // Show verdict
    const batchEntityHint = (data?.extracted_phones?.[0] || data?.extracted_accounts?.[0] || '');
    addVerdict(getVerdictText(data), data?.risk_level || 'UNKNOWN', batchEntityHint);
    addPipelineDetails(data);
    if (data?.alertSent) {
      addBotMessage('🔔 A security alert has been sent automatically to your Guardian.');
    }
  } catch (err) {
    thinking.remove();
    addVerdict('Sorry, batch analysis failed.\n\nPlease try again shortly. 🙏', 'UNKNOWN');
    console.error('Batch analysis error:', err);
  } finally {
    batchMessages = [];
    isProcessing = false;
    updateSendBtn();
  }
}

// ── SSE alert stream (guardians only) ─────────────────────────────────────────
let alertEventSource = null;

function startAlertStream() {
  if (alertEventSource) return;
  alertEventSource = new EventSource('/api/alerts/stream');
  alertEventSource.onmessage = (e) => {
    try {
      const alert = JSON.parse(e.data);
      addGuardianAlert(alert);
    } catch (_) {}
  };
  alertEventSource.onerror = () => {
    // Reconnect after 10s
    alertEventSource.close();
    alertEventSource = null;
    setTimeout(() => { if (authState.loggedIn && authState.user?.role === 'guardian') startAlertStream(); }, 10000);
  };
}

// ── Image handling ────────────────────────────────────────────────────────────
imageInput.addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (file) attachImage(file);
  imageInput.value = '';
});
imageRemoveBtn.addEventListener('click', clearImage);

let dragCounter = 0;
document.addEventListener('dragenter', (e) => { e.preventDefault(); dragCounter++; dropOverlay.classList.add('active'); });
document.addEventListener('dragleave', (e) => { e.preventDefault(); dragCounter--; if (dragCounter <= 0) { dropOverlay.classList.remove('active'); dragCounter = 0; } });
document.addEventListener('dragover', (e) => e.preventDefault());
document.addEventListener('drop', (e) => {
  e.preventDefault(); dropOverlay.classList.remove('active'); dragCounter = 0;
  const file = e.dataTransfer.files[0];
  if (file && (file.type.startsWith('image/') || file.type.startsWith('audio/') || file.type.startsWith('application/ogg') || file.type.startsWith('video/'))) attachImage(file);
});

function attachImage(file) {
  const reader = new FileReader();
  reader.onload = () => {
    pendingImage = { base64: reader.result, mimeType: file.type, fileName: file.name };
    const previewLabel = document.querySelector('.image-preview-label');
    if (file.type.startsWith('audio/') || file.type.startsWith('application/ogg') || file.type.startsWith('video/ogg')) {
        imagePreviewImg.src = 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path fill="gray" d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z"/></svg>';
        if (previewLabel) previewLabel.textContent = file.name || 'Audio attached';
    } else {
        imagePreviewImg.src = reader.result;
        if (previewLabel) previewLabel.textContent = 'Screenshot attached';
    }
    imagePreviewBar.style.display = 'flex';
    updateSendBtn();
  };
  reader.readAsDataURL(file);
}

function clearImage() {
  pendingImage = null;
  imagePreviewBar.style.display = 'none';
  imagePreviewImg.src = '';
  updateSendBtn();
}

// ── DOM helpers ───────────────────────────────────────────────────────────────
function addBotMessage(text) {
  const wrapper = document.createElement('div');
  wrapper.className = 'message bot-message';

  const avatar = document.createElement('div');
  avatar.className = 'message-avatar';
  avatar.textContent = '🛡️';

  const content = document.createElement('div');
  content.className = 'message-content';

  const bubble = document.createElement('div');
  bubble.className = 'message-bubble';
  // Support *bold* markdown
  bubble.innerHTML = text.replace(/\*([^*]+)\*/g, '<strong>$1</strong>').replace(/\n/g, '<br>');

  const time = document.createElement('span');
  time.className = 'message-time';
  time.textContent = new Date().toLocaleTimeString('ms-MY', { hour: '2-digit', minute: '2-digit' });

  content.appendChild(bubble);
  content.appendChild(time);
  wrapper.appendChild(avatar);
  wrapper.appendChild(content);
  chatArea.appendChild(wrapper);
  scrollToBottom();
  return wrapper;
}

function addUserMessage(text) {
  const wrapper = document.createElement('div');
  wrapper.className = 'message user-message';

  const avatar = document.createElement('div');
  avatar.className = 'message-avatar';
  avatar.textContent = '👤';

  const content = document.createElement('div');
  content.className = 'message-content';

  const bubble = document.createElement('div');
  bubble.className = 'message-bubble';
  bubble.textContent = text;

  const time = document.createElement('span');
  time.className = 'message-time';
  time.textContent = new Date().toLocaleTimeString('ms-MY', { hour: '2-digit', minute: '2-digit' });

  content.appendChild(bubble);
  content.appendChild(time);
  wrapper.appendChild(avatar);
  wrapper.appendChild(content);
  chatArea.appendChild(wrapper);
  scrollToBottom();
}

// Slash commands styled differently
function addCommandMessage(text) {
  const wrapper = document.createElement('div');
  wrapper.className = 'message user-message cmd-message';

  const avatar = document.createElement('div');
  avatar.className = 'message-avatar';
  avatar.textContent = '⌨️';

  const content = document.createElement('div');
  content.className = 'message-content';

  const bubble = document.createElement('div');
  bubble.className = 'message-bubble';
  bubble.textContent = text;

  content.appendChild(bubble);
  wrapper.appendChild(avatar);
  wrapper.appendChild(content);
  chatArea.appendChild(wrapper);
  scrollToBottom();
}

// PIN/code display
function addPinMessage(code, username) {
  const wrapper = document.createElement('div');
  wrapper.className = 'message bot-message';

  const avatar = document.createElement('div');
  avatar.className = 'message-avatar';
  avatar.textContent = '🔢';

  const content = document.createElement('div');
  content.className = 'message-content';

  const bubble = document.createElement('div');
  bubble.className = 'message-bubble pin-bubble';
  bubble.innerHTML = `
    <div class="pin-label">Guardian code for ${username}</div>
    <div class="pin-digits">${code.split('').join(' ')}</div>
    <button class="pin-copy-btn" onclick="copyPin(this, '${code}')">📋 Copy code</button>
  `;

  content.appendChild(bubble);
  wrapper.appendChild(avatar);
  wrapper.appendChild(content);
  chatArea.appendChild(wrapper);
  scrollToBottom();
}

window.copyPin = function(btn, code) {
  navigator.clipboard.writeText(code).then(() => {
    const orig = btn.textContent;
    btn.textContent = '✅ Copied!';
    setTimeout(() => { btn.textContent = orig; }, 2000);
  });
};

// Guardian alert bubble (pushed via SSE)
function addGuardianAlert(alert) {
  const wrapper = document.createElement('div');
  wrapper.className = 'message bot-message alert-bubble';

  const avatar = document.createElement('div');
  avatar.className = 'message-avatar';
  avatar.textContent = '🚨';

  const content = document.createElement('div');
  content.className = 'message-content';

  const bubble = document.createElement('div');
  bubble.className = 'message-bubble';
  const riskIcon = alert.risk_level === 'HIGH' ? '🔴' : '🟡';
  bubble.innerHTML =
    `<strong>${riskIcon} AMARAN KELUARGA</strong><br>` +
    `<em>${alert.elderly}</em> received a ${alert.risk_level} risk message!<br><br>` +
    `${alert.scam_type ? `Jenis: <strong>${alert.scam_type}</strong><br>` : ''}` +
    `Serpihan: <em>"${alert.snippet}..."</em>`;

  const time = document.createElement('span');
  time.className = 'message-time';
  time.textContent = new Date().toLocaleTimeString('ms-MY', { hour: '2-digit', minute: '2-digit' });

  content.appendChild(bubble);
  content.appendChild(time);
  wrapper.appendChild(avatar);
  wrapper.appendChild(content);
  chatArea.appendChild(wrapper);
  scrollToBottom();
}

function addImageMessage(src) {
  const wrapper = document.createElement('div');
  wrapper.className = 'message user-message user-image-msg';

  const avatar = document.createElement('div');
  avatar.className = 'message-avatar';
  avatar.textContent = '👤';

  const content = document.createElement('div');
  content.className = 'message-content';

  const bubble = document.createElement('div');
  bubble.className = 'message-bubble';

  if (src.startsWith('data:audio/') || src.startsWith('data:application/ogg') || src.startsWith('data:video/')) {
    const audio = document.createElement('audio');
    audio.src = src;
    audio.controls = true;
    audio.style.width = '100%';
    bubble.appendChild(audio);
  } else {
    const img = document.createElement('img');
    img.src = src; img.alt = 'Screenshot';
    bubble.appendChild(img);
  }

  const time = document.createElement('span');
  time.className = 'message-time';
  time.textContent = new Date().toLocaleTimeString('ms-MY', { hour: '2-digit', minute: '2-digit' });

  content.appendChild(bubble);
  content.appendChild(time);
  wrapper.appendChild(avatar);
  wrapper.appendChild(content);
  chatArea.appendChild(wrapper);
  scrollToBottom();
}

function addThinking(label) {
  const wrapper = document.createElement('div');
  wrapper.className = 'message bot-message';

  const avatar = document.createElement('div');
  avatar.className = 'message-avatar';
  avatar.textContent = '🛡️';

  const content = document.createElement('div');
  content.className = 'message-content';

  const bubble = document.createElement('div');
  bubble.className = 'message-bubble';
  bubble.innerHTML = `
    <div class="thinking-dots"><span></span><span></span><span></span></div>
    <span style="font-size:0.78rem;color:var(--text-muted)">${label || 'Checking...'}</span>
  `;

  content.appendChild(bubble);
  wrapper.appendChild(avatar);
  wrapper.appendChild(content);
  chatArea.appendChild(wrapper);
  scrollToBottom();
  return wrapper;
}

function addVerdict(text, riskLevel, entityHint) {
  // Delegate to the community-aware version (defined after module init)
  if (typeof window._addVerdictInternal === 'function') {
    window._addVerdictInternal(text, riskLevel, entityHint);
    return;
  }
  // Fallback (before community JS loads — should not happen)
  const wrapper   = document.createElement('div');
  const riskClass = riskLevel === 'HIGH' ? 'verdict-high' : riskLevel === 'MEDIUM' ? 'verdict-medium' : riskLevel === 'LOW' ? 'verdict-low' : '';
  wrapper.className = `message bot-message ${riskClass}`;

  const avatar = document.createElement('div');
  avatar.className = 'message-avatar';
  avatar.textContent = '🛡️';

  const content = document.createElement('div');
  content.className = 'message-content';

  const bubble = document.createElement('div');
  bubble.className = 'message-bubble';
  bubble.textContent = text;

  const time = document.createElement('span');
  time.className = 'message-time';
  time.textContent = new Date().toLocaleTimeString('ms-MY', { hour: '2-digit', minute: '2-digit' });

  content.appendChild(bubble);
  content.appendChild(time);
  wrapper.appendChild(avatar);
  wrapper.appendChild(content);
  chatArea.appendChild(wrapper);
  scrollToBottom();
}

function getVerdictText(data) {
  if (data && typeof data.verdict === 'string' && data.verdict.trim()) return data.verdict;
  if (data && typeof data.reason_bm === 'string' && data.reason_bm.trim()) return `⚠️ Result:\n${data.reason_bm}`;
  if (data && typeof data.reason_en === 'string' && data.reason_en.trim()) return `⚠️ Result:\n${data.reason_en}`;
  return 'Sorry, the result could not be displayed. Please try again.';
}

function addPipelineDetails(data) {
  if (!data || typeof data !== 'object') return;
  const lines = [];
  const indicators = [];

  if (data.flow) lines.push(`Pipeline: ${data.flow}`);
  const conf = Number(data.confidence);
  if (Number.isFinite(conf)) lines.push(`Confidence: ${Math.round(conf * 100)}%`);
  if (data.ccid?.found) lines.push(`PDRM Semak Mule: ${data.ccid.reports || 0} report(s)`);
  else if (data.ccid) lines.push('PDRM Semak Mule: no match');
  if (data.vertex?.found) lines.push(`Vertex AI Search: ${data.vertex.hits || 0} record(s)`);
  else if (data.vertex) lines.push('Vertex AI Search: no match');
  if (Array.isArray(data.extracted_phones) && data.extracted_phones.length) indicators.push(`${data.extracted_phones.length} phone number(s)`);
  if (Array.isArray(data.extracted_accounts) && data.extracted_accounts.length) indicators.push(`${data.extracted_accounts.length} bank account(s)`);
  if (Array.isArray(data.extracted_urls) && data.extracted_urls.length) indicators.push(`${data.extracted_urls.length} URL`);
  if (indicators.length) lines.push(`Indicators: ${indicators.join(', ')}`);
  if (!lines.length) return;

  const wrapper = document.createElement('div');
  wrapper.className = 'message bot-message pipeline-meta';

  const avatar = document.createElement('div');
  avatar.className = 'message-avatar';
  avatar.textContent = 'ℹ️';

  const content = document.createElement('div');
  content.className = 'message-content';

  const bubble = document.createElement('div');
  bubble.className = 'message-bubble';
  bubble.textContent = lines.join('\n');

  const time = document.createElement('span');
  time.className = 'message-time';
  time.textContent = 'Signal summary';

  content.appendChild(bubble);
  content.appendChild(time);
  wrapper.appendChild(avatar);
  wrapper.appendChild(content);
  chatArea.appendChild(wrapper);
  scrollToBottom();
}

// ── Analyzed conversation display ─────────────────────────────────────────────
function addAnalyzedConversation(messages) {
  const wrapper = document.createElement('div');
  wrapper.className = 'message bot-message analyzed-convo-msg';

  const avatar = document.createElement('div');
  avatar.className = 'message-avatar';
  avatar.textContent = '📋';

  const content = document.createElement('div');
  content.className = 'message-content';

  const bubble = document.createElement('div');
  bubble.className = 'message-bubble analyzed-convo-bubble';

  // Header
  const header = document.createElement('div');
  header.className = 'analyzed-convo-header';
  header.innerHTML = '<strong>📨 Analyzed:</strong>';
  bubble.appendChild(header);

  // Each message
  messages.forEach((msg) => {
    const item = document.createElement('div');
    item.className = 'analyzed-convo-item';

    const label = document.createElement('span');
    label.className = 'analyzed-convo-label';
    label.textContent = msg.type === 'image' ? '🖼️ Image:' : 'Message:';

    const text = document.createElement('span');
    text.className = 'analyzed-convo-text';
    // Truncate very long text for display
    const displayText = msg.text && msg.text.length > 150
      ? msg.text.slice(0, 150) + '...'
      : (msg.text || '[tiada teks]');
    text.textContent = displayText;

    item.appendChild(label);
    item.appendChild(text);
    bubble.appendChild(item);
  });

  const time = document.createElement('span');
  time.className = 'message-time';
  time.textContent = 'Analysis order';

  content.appendChild(bubble);
  content.appendChild(time);
  wrapper.appendChild(avatar);
  wrapper.appendChild(content);
  chatArea.appendChild(wrapper);
  scrollToBottom();
}

function scrollToBottom() {
  requestAnimationFrame(() => { chatArea.scrollTop = chatArea.scrollHeight; });
}

// ── Call companion ─────────────────────────────────────────────────────────────
let isCallActive = false;
let callWindow = null;

function openCallCompanion() {
  isCallActive = true;
  updateCallButtonsVisibility();
  // Mark call as active in sessionStorage for cross-window communication
  sessionStorage.setItem('safelah_call_active', 'true');
  callWindow = window.open('/live-call.html', 'safelah-call', 'width=480,height=800,resizable=yes,scrollbars=no');
  
  // Check if window is closed periodically
  const checkWindowClosed = setInterval(() => {
    if (!callWindow || callWindow.closed) {
      isCallActive = false;
      updateCallButtonsVisibility();
      sessionStorage.removeItem('safelah_call_active');
      clearInterval(checkWindowClosed);
    }
  }, 1000);
}

function endCall() {
  isCallActive = false;
  if (callWindow && !callWindow.closed) {
    callWindow.close();
  }
  sessionStorage.removeItem('safelah_call_active');
  updateCallButtonsVisibility();
  addBotMessage('📞 Call companion ended. You can start another call with /call command anytime.');
}

function updateCallButtonsVisibility() {
  const startBtn = document.getElementById('callStartBtn');
  const endBtn = document.getElementById('callEndBtn');
  if (startBtn) startBtn.style.display = isCallActive ? 'none' : 'flex';
  if (endBtn) endBtn.style.display = isCallActive ? 'flex' : 'none';
}

// ── Button event listeners ─────────────────────────────────────────────────────
const callStartBtn = document.getElementById('callStartBtn');
const callEndBtn = document.getElementById('callEndBtn');

if (callStartBtn) {
  callStartBtn.addEventListener('click', () => {
    addCommandMessage('/call');
    handleSlashCommand('/call');
  });
}

if (callEndBtn) {
  callEndBtn.addEventListener('click', () => {
    endCall();
  });
}

updateSendBtn();

// ══════════════════════════════════════════════════════════════════════════════
// Community Scam Reporting Feature
// ══════════════════════════════════════════════════════════════════════════════

// ── Stats counter ─────────────────────────────────────────────────────────────
async function fetchAndUpdateStats() {
  try {
    const res  = await fetch('/api/stats');
    const data = await res.json();
    const el = document.getElementById('communityCount');
    if (el && typeof data.scamsReported === 'number') {
      // Animate number change
      const current = parseInt(el.textContent) || 0;
      if (current !== data.scamsReported) {
        animateCounter(el, current, data.scamsReported, 800);
      }
    }
  } catch (_) {}
}

function animateCounter(el, from, to, duration) {
  const start = performance.now();
  function step(now) {
    const t = Math.min((now - start) / duration, 1);
    const eased = t < 0.5 ? 2*t*t : -1+(4-2*t)*t;
    el.textContent = Math.round(from + (to - from) * eased);
    if (t < 1) requestAnimationFrame(step);
    else el.textContent = to;
  }
  requestAnimationFrame(step);
}

// Fetch on load and every 30s
fetchAndUpdateStats();
setInterval(fetchAndUpdateStats, 30000);

// ── Panel open/close ──────────────────────────────────────────────────────────
const reportPanel        = document.getElementById('reportPanel');
const reportPanelBackdrop = document.getElementById('reportPanelBackdrop');
const reportPanelClose   = document.getElementById('reportPanelClose');
const reportScamHeaderBtn = document.getElementById('reportScamHeaderBtn');

function openReportPanel(prefill) {
  reportPanel.classList.add('open');
  reportPanelBackdrop.classList.add('open');
  document.body.style.overflow = 'hidden';

  // Reset to tab 1
  switchTab('phone');

  if (prefill) {
    const entityInput = document.getElementById('reportEntityValue');
    if (entityInput) {
      entityInput.value = prefill;
      // Trigger bank account detection
      detectBankAccount(prefill);
    }
  }

  // Hide success toast
  const toast = document.getElementById('reportSuccessToast');
  if (toast) toast.style.display = 'none';
}

function closeReportPanel() {
  reportPanel.classList.remove('open');
  reportPanelBackdrop.classList.remove('open');
  document.body.style.overflow = '';
}

if (reportScamHeaderBtn) {
  reportScamHeaderBtn.addEventListener('click', () => openReportPanel());
}
if (reportPanelClose) {
  reportPanelClose.addEventListener('click', closeReportPanel);
}
if (reportPanelBackdrop) {
  reportPanelBackdrop.addEventListener('click', closeReportPanel);
}

// Expose for CTA strip buttons
window.openReportPanelWithPrefill = function(entity) {
  openReportPanel(entity);
};

// ── Tab switching ─────────────────────────────────────────────────────────────
const tabContentMap = {
  phone:      'tabContentPhone',
  url:        'tabContentUrl',
  screenshot: 'tabContentScreenshot',
};

function switchTab(tabName) {
  // Update buttons
  document.querySelectorAll('.report-tab').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.tab === tabName);
  });
  // Update content
  Object.entries(tabContentMap).forEach(([key, id]) => {
    const el = document.getElementById(id);
    if (el) el.classList.toggle('active', key === tabName);
  });
}

document.querySelectorAll('.report-tab').forEach(btn => {
  btn.addEventListener('click', () => switchTab(btn.dataset.tab));
});

// ── Bank account auto-detection ───────────────────────────────────────────────
// Heuristic: no leading 0, length > 10 digits → bank account
function isBankAccount(value) {
  const digits = value.replace(/\D/g, '');
  return digits.length > 10 && !digits.startsWith('0');
}

function detectBankAccount(value) {
  const bankNameField = document.getElementById('bankNameField');
  if (bankNameField) {
    bankNameField.style.display = isBankAccount(value) ? '' : 'none';
  }
}

const reportEntityInput = document.getElementById('reportEntityValue');
if (reportEntityInput) {
  reportEntityInput.addEventListener('input', () => detectBankAccount(reportEntityInput.value));
}

// ── Form submission helper ────────────────────────────────────────────────────
async function submitReportForm({ entity_type, entity_value, bank_name, scam_type, notes, submitBtn }) {
  submitBtn.disabled = true;
  submitBtn.textContent = 'Submitting…';

  try {
    const res = await fetch('/api/report', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ entity_type, entity_value, bank_name, scam_type, notes }),
    });

    const data = await res.json();

    if (res.ok && data.success) {
      // Show success toast
      const toast = document.getElementById('reportSuccessToast');
      if (toast) {
        toast.style.display = '';
        // Scroll toast into view
        toast.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
      // Refresh counter
      fetchAndUpdateStats();

      // Close panel after 2.5s
      setTimeout(closeReportPanel, 2500);
    } else {
      alert('❌ ' + (data.error || 'Submission failed. Please try again.'));
    }
  } catch (err) {
    alert('❌ Network error. Please try again.');
    console.error('[report submit]', err);
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = 'Submit to community database';
  }
}

// ── TAB 1 — Phone / account form ──────────────────────────────────────────────
const reportFormPhone = document.getElementById('reportFormPhone');
if (reportFormPhone) {
  reportFormPhone.addEventListener('submit', async (e) => {
    e.preventDefault();
    const entity_value = (document.getElementById('reportEntityValue')?.value || '').trim();
    const scam_type    = document.getElementById('reportScamType')?.value || '';
    const bank_name    = document.getElementById('reportBankName')?.value || '';
    const notes        = document.getElementById('reportNotes')?.value || '';

    if (!entity_value) { alert('Please enter a phone number or account number.'); return; }
    if (!scam_type)    { alert('Please select a scam type.'); return; }

    const entity_type = isBankAccount(entity_value) ? 'bank_account' : 'phone_number';
    const submitBtn   = document.getElementById('reportSubmitPhone');

    await submitReportForm({ entity_type, entity_value, bank_name: entity_type === 'bank_account' ? bank_name : undefined, scam_type, notes, submitBtn });
  });
}

// ── TAB 2 — URL / link form ───────────────────────────────────────────────────
const reportFormUrl = document.getElementById('reportFormUrl');
if (reportFormUrl) {
  reportFormUrl.addEventListener('submit', async (e) => {
    e.preventDefault();
    const entity_value = (document.getElementById('reportUrlValue')?.value || '').trim();
    const scam_type    = document.getElementById('reportUrlScamType')?.value || '';
    const notes        = document.getElementById('reportUrlNotes')?.value || '';

    if (!entity_value) { alert('Please enter a URL or link.'); return; }
    if (!scam_type)    { alert('Please select a scam type.'); return; }

    const submitBtn = document.getElementById('reportSubmitUrl');
    await submitReportForm({ entity_type: 'url', entity_value, scam_type, notes, submitBtn });
  });
}

// ── TAB 3 — Screenshot form ───────────────────────────────────────────────────
const reportDropzone       = document.getElementById('reportDropzone');
const reportScreenshotInput = document.getElementById('reportScreenshotInput');
const reportDropzonePreview = document.getElementById('reportDropzonePreview');
let reportScreenshotData    = null;

if (reportDropzone) {
  reportDropzone.addEventListener('click', () => reportScreenshotInput && reportScreenshotInput.click());

  reportDropzone.addEventListener('dragover', (e) => { e.preventDefault(); reportDropzone.classList.add('dragover'); });
  reportDropzone.addEventListener('dragleave', () => reportDropzone.classList.remove('dragover'));
  reportDropzone.addEventListener('drop', (e) => {
    e.preventDefault();
    reportDropzone.classList.remove('dragover');
    const file = e.dataTransfer.files[0];
    if (file && file.type.startsWith('image/')) handleReportDropzoneFile(file);
  });
}

if (reportScreenshotInput) {
  reportScreenshotInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (file) handleReportDropzoneFile(file);
    reportScreenshotInput.value = '';
  });
}

function handleReportDropzoneFile(file) {
  const reader = new FileReader();
  reader.onload = () => {
    reportScreenshotData = { base64: reader.result, mimeType: file.type };
    if (reportDropzonePreview) {
      reportDropzonePreview.src = reader.result;
      reportDropzonePreview.style.display = '';
    }
    const inner = document.getElementById('reportDropzoneInner');
    if (inner) inner.style.display = 'none';
  };
  reader.readAsDataURL(file);
}

const reportFormScreenshot = document.getElementById('reportFormScreenshot');
if (reportFormScreenshot) {
  reportFormScreenshot.addEventListener('submit', async (e) => {
    e.preventDefault();
    // Screenshot tab just sends a note — image uploads require extra infrastructure.
    // Here we submit as a note-only report with entity_type='screenshot'
    const notes     = (document.getElementById('reportScreenshotNotes')?.value || '').trim();
    const submitBtn = document.getElementById('reportSubmitScreenshot');

    if (!reportScreenshotData && !notes) {
      alert('Please attach a screenshot or add a description.');
      return;
    }

    await submitReportForm({
      entity_type: 'screenshot',
      entity_value: 'screenshot',
      scam_type: 'CategoriesOther',
      notes: notes || 'Screenshot submitted via community report.',
      submitBtn,
    });
  });
}

// ── Modify addVerdict to inject HIGH RISK CTA strip ───────────────────────────
// Wrap the existing addVerdict to append a CTA strip after HIGH RISK verdicts
const _originalAddVerdict = addVerdict;
// Redefine addVerdict globally
window._addVerdictInternal = function(text, riskLevel, entityHint) {
  const wrapper   = document.createElement('div');
  const riskClass = riskLevel === 'HIGH' ? 'verdict-high' : riskLevel === 'MEDIUM' ? 'verdict-medium' : riskLevel === 'LOW' ? 'verdict-low' : '';
  wrapper.className = `message bot-message ${riskClass}`;

  const avatar = document.createElement('div');
  avatar.className = 'message-avatar';
  avatar.textContent = '🛡️';

  const content = document.createElement('div');
  content.className = 'message-content';

  const bubble = document.createElement('div');
  bubble.className = 'message-bubble';
  bubble.textContent = text;

  const time = document.createElement('span');
  time.className = 'message-time';
  time.textContent = new Date().toLocaleTimeString('ms-MY', { hour: '2-digit', minute: '2-digit' });

  content.appendChild(bubble);

  // Append CTA strip for HIGH RISK verdicts
  if (riskLevel === 'HIGH') {
    const cta = document.createElement('div');
    cta.className = 'report-cta-strip';
    const entity = entityHint || '';
    cta.innerHTML =
      `<span class="report-cta-text">Help protect others — report this scam 🛡</span>` +
      `<button class="report-cta-btn" onclick="window.openReportPanelWithPrefill(${JSON.stringify(entity)})">Report</button>`;
    content.appendChild(cta);
  }

  content.appendChild(time);
  wrapper.appendChild(avatar);
  wrapper.appendChild(content);
  chatArea.appendChild(wrapper);
  scrollToBottom();
};

