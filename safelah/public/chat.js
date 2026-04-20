// ── SelamatLah Chat Client — Conversational Auth + Scam Detection ─────────────

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
        `👋 Selamat kembali, *${data.username}*!\n` +
        (data.role === 'guardian'
          ? `👨‍👩‍👧 Anda log masuk sebagai Penjaga.\nTaip /mycode untuk lihat kod anda.\n\nHantar mesej mencurigakan untuk disemak.`
          : `Hantar mesej mencurigakan untuk disemak.`)
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
    `🛡️ Selamat datang ke *SelamatLah*!\n\n` +
    `Saya pembantu semakan penipuan anda.\n\n` +
    `Taip arahan:\n` +
    `  /start    — mulakan analisis kelompok (teks + gambar)\n` +
    `  /register — daftar akaun baru\n` +
    `  /login    — log masuk\n\n` +
    `Atau terus hantar mesej mencurigakan untuk semak tanpa akaun.`
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
    (authState.user.role === 'guardian' ? ' (Penjaga)' : '');
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
    updateHeaderBadge();
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
      `✅ Dikumpul: *${textCount}* mesej, *${imgCount}* gambar\n\n` +
      `Terus hantar mesej/gambar lain, atau taip:\n` +
      `  /analyze — analisis semua\n` +
      `  /cancel — batalkan`
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
      addBotMessage(`✋ Anda sudah log masuk sebagai *${authState.user.username}*.\nTaip /logout untuk log keluar dahulu.`);
      return;
    }
    authState.mode = 'reg_username';
    authState.data = {};
    addBotMessage('📝 Daftar akaun baru\n\nMasukkan *nama pengguna* anda:');
    return;
  }

  if (lower === '/login') {
    if (authState.loggedIn) {
      addBotMessage(`✋ Anda sudah log masuk sebagai *${authState.user.username}*.`);
      return;
    }
    authState.mode = 'login_username';
    authState.data = {};
    addBotMessage('🔑 Log masuk\n\nMasukkan *nama pengguna* anda:');
    return;
  }

  if (lower === '/logout') {
    if (!authState.loggedIn) {
      addBotMessage('❓ Anda belum log masuk.');
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
      addBotMessage('❌ Arahan ini hanya untuk Penjaga yang telah log masuk.');
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
      addBotMessage(`⚠️ Mod kelompok sudah aktif. Anda ada *${batchMessages.length}* item.\nTaip /analyze untuk analisis atau /cancel untuk batalkan.`);
      return;
    }
    batchMode = true;
    batchMessages = [];
    addBotMessage(
      `📦 *Mod Analisis Kelompok*\n\n` +
      `Sekarang, hantar semua mesej mencurigakan — teks dan/atau gambar.\n\n` +
      `Saya akan kumpulkan semuanya, kemudian analisis sebagai satu perbualan.\n\n` +
      `Arahan:\n` +
      `  /analyze — analisis semua mesej yang dikumpul\n` +
      `  /cancel  — batalkan dan buang semua`
    );
    return;
  }

  if (lower === '/analyze' || lower === '/analisis') {
    if (!batchMode || batchMessages.length === 0) {
      addBotMessage('❌ Tiada mesej untuk dianalisis.\nTaip /start dahulu, kemudian hantar mesej mencurigakan.');
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
    addBotMessage(`🗑️ Sesi kelompok dibatalkan. ${count} item dibuang.`);
    return;
  }

  if (lower.startsWith('/family ')) {
    const code = lower.replace('/family ', '').trim();
    if (!authState.loggedIn) {
      addBotMessage('❌ Sila /login dahulu sebelum menggunakan /family.');
      return;
    }
    if (!/^\d{6}$/.test(code)) {
      addBotMessage('❌ Kod penjaga mesti tepat 6 digit. Contoh: /family 482917');
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
          `✅ Berjaya disambungkan kepada Penjaga *${data.guardianName}*! 🔗\n\n` +
          `Mulai sekarang, apabila saya mengesan penipuan berisiko tinggi dalam mesej anda, ` +
          `${data.guardianName} akan menerima amaran secara automatik.`
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
    `❓ Arahan tidak dikenali: *${cmd}*\n\n` +
    `Arahan yang tersedia:\n` +
    `  /register — daftar akaun\n` +
    `  /login    — log masuk\n` +
    `  /logout   — log keluar\n` +
    `  /start    — mulakan analisis kelompok\n` +
    `  /analyze  — analisis mesej yang dikumpul\n` +
    `  /cancel   — batalkan sesi kelompok\n` +
    `  /mycode   — lihat kod penjaga anda\n` +
    `  /family [6-digit] — hubungkan ke penjaga`
  );
}

// ── Auth step handler (collects data across multiple messages) ────────────────
async function handleAuthStep(value) {
  const mode = authState.mode;

  // ── REGISTER FLOW ──────────────────────────────────────────────────────────
  if (mode === 'reg_username') {
    if (!value || value.length < 3) {
      addBotMessage('❌ Nama pengguna mesti sekurang-kurangnya 3 aksara. Cuba lagi:');
      return;
    }
    if (/\s/.test(value)) {
      addBotMessage('❌ Nama pengguna tidak boleh mengandungi ruang. Cuba lagi:');
      return;
    }
    authState.data.username = value;
    authState.mode = 'reg_password';
    addBotMessage(`👍 Nama pengguna: *${value}*\n\nSekarang masukkan *kata laluan* (sekurang-kurangnya 8 aksara):`);
    showPasswordInput('Kata laluan...');
    return;
  }

  if (mode === 'reg_password') {
    if (!value || value.length < 8) {
      addBotMessage('❌ Kata laluan mesti sekurang-kurangnya 8 aksara. Cuba lagi:');
      showPasswordInput('Kata laluan...');
      return;
    }
    authState.data.password = value;
    authState.mode = 'reg_confirm';
    addBotMessage('🔒 Ok! Masukkan semula kata laluan untuk *sahkan*:');
    showPasswordInput('Sahkan kata laluan...');
    return;
  }

  if (mode === 'reg_confirm') {
    if (value !== authState.data.password) {
      addBotMessage('❌ Kata laluan tidak sepadan. Masukkan semula kata laluan:');
      authState.mode = 'reg_password';
      showPasswordInput('Kata laluan...');
      return;
    }
    // Call register API
    isProcessing = true;
    updateSendBtn();
    const thinking = addThinking('Mendaftar...');
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
        addBotMessage(`❌ ${data.error || 'Pendaftaran gagal.'}\n\nTaip /register untuk cuba lagi.`);
      } else {
        authState.loggedIn = true;
        authState.mode     = 'logged_in';
        authState.user     = { username: data.username, role: 'guardian', guardianCode: data.guardianCode };
        authState.data     = {};
        updateHeaderBadge();
        startAlertStream();
        addBotMessage(`✅ Akaun berjaya didaftar!\n\nAnda log masuk sebagai *${data.username}*.\n\nKod anda untuk dikongsi dengan ahli keluarga:`);
        addPinMessage(data.guardianCode, data.username);
        addBotMessage(
          `📤 Cara guna:\n` +
          `1. Kongsi kod di atas kepada ahli keluarga anda\n` +
          `2. Mereka buka SelamatLah, taip /register untuk daftar\n` +
          `3. Kemudian taip /family ${data.guardianCode}\n` +
          `4. Apabila mereka jumpa mesej penipuan, anda akan dapat amaran segera 🔔`
        );
      }
    } catch (_) {
      thinking.remove();
      authState.mode = 'idle';
      authState.data = {};
      addBotMessage('❌ Ralat rangkaian. Taip /register untuk cuba lagi.');
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
    addBotMessage(`Masukkan *kata laluan* untuk *${value}*:`);
    showPasswordInput('Kata laluan...');
    return;
  }

  if (mode === 'login_password') {
    isProcessing = true;
    updateSendBtn();
    const thinking = addThinking('Log masuk...');
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
        addBotMessage(`❌ ${data.error || 'Log masuk gagal.'}\n\nTaip /login untuk cuba lagi.`);
      } else {
        authState.loggedIn = true;
        authState.mode     = 'logged_in';
        authState.user     = { username: data.username, role: data.role, guardianCode: data.guardianCode };
        authState.data     = {};
        updateHeaderBadge();
        if (data.role === 'guardian') {
          startAlertStream();
          addBotMessage(
            `✅ Selamat datang kembali, *${data.username}*! 👨‍👩‍👧\n\n` +
            `Taip /mycode untuk lihat kod penjaga anda.\n` +
            `Hantar mesej mencurigakan untuk disemak.`
          );
        } else {
          addBotMessage(
            `✅ Selamat datang, *${data.username}*! 👴\n\n` +
            `Hantar mesej mencurigakan untuk disemak.\n` +
            `Jika ada penipuan, penjaga anda akan dapat amaran segera.`
          );
        }
      }
    } catch (_) {
      thinking.remove();
      authState.mode = 'idle';
      authState.data = {};
      addBotMessage('❌ Ralat rangkaian. Taip /login untuk cuba lagi.');
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
    addVerdict(getVerdictText(data), data?.risk_level || 'UNKNOWN');
    addPipelineDetails(data);
    if (data?.alertSent) {
      addBotMessage('🔔 Amaran keselamatan telah dihantar secara automatik kepada penjaga anda.');
    }
  } catch (err) {
    thinking.remove();
    addVerdict('Maaf, semakan tidak tersedia sekarang.\n\nCuba lagi sebentar. 🙏', 'UNKNOWN');
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
  const thinking = addThinking(`Menganalisis ${count} item (${textCount} mesej, ${imgCount} gambar)...`);

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
      `✅ *Analisis Kelompok Selesai*\n` +
      `Dianalisis: *${data.total_messages || count}* item\n` +
      `Mod: Analisis Perbualan`
    );

    // Show verdict
    addVerdict(getVerdictText(data), data?.risk_level || 'UNKNOWN');
    addPipelineDetails(data);
    if (data?.alertSent) {
      addBotMessage('🔔 Amaran keselamatan telah dihantar secara automatik kepada penjaga anda.');
    }
  } catch (err) {
    thinking.remove();
    addVerdict('Maaf, analisis kelompok gagal.\n\nCuba lagi sebentar. 🙏', 'UNKNOWN');
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
    <div class="pin-label">Kod Penjaga untuk ${username}</div>
    <div class="pin-digits">${code.split('').join(' ')}</div>
    <button class="pin-copy-btn" onclick="copyPin(this, '${code}')">📋 Salin Kod</button>
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
    btn.textContent = '✅ Tersalin!';
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
    `<em>${alert.elderly}</em> telah menerima mesej ${alert.risk_level} berisiko!<br><br>` +
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
    <span style="font-size:0.78rem;color:var(--text-muted)">${label || 'Sedang semak...'}</span>
  `;

  content.appendChild(bubble);
  wrapper.appendChild(avatar);
  wrapper.appendChild(content);
  chatArea.appendChild(wrapper);
  scrollToBottom();
  return wrapper;
}

function addVerdict(text, riskLevel) {
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
  if (data && typeof data.reason_bm === 'string' && data.reason_bm.trim()) return `⚠️ Keputusan:\n${data.reason_bm}`;
  if (data && typeof data.reason_en === 'string' && data.reason_en.trim()) return `⚠️ Result:\n${data.reason_en}`;
  return 'Maaf, keputusan tidak dapat dipaparkan. Sila cuba semula.';
}

function addPipelineDetails(data) {
  if (!data || typeof data !== 'object') return;
  const lines = [];
  const indicators = [];

  if (data.flow) lines.push(`Pipeline: ${data.flow}`);
  const conf = Number(data.confidence);
  if (Number.isFinite(conf)) lines.push(`Confidence: ${Math.round(conf * 100)}%`);
  if (data.ccid?.found) lines.push(`PDRM Semak Mule: ${data.ccid.reports || 0} laporan`);
  else if (data.ccid) lines.push('PDRM Semak Mule: tiada padanan');
  if (data.vertex?.found) lines.push(`Vertex AI Search: ${data.vertex.hits || 0} rekod`);
  else if (data.vertex) lines.push('Vertex AI Search: tiada padanan');
  if (Array.isArray(data.extracted_phones) && data.extracted_phones.length) indicators.push(`${data.extracted_phones.length} nombor telefon`);
  if (Array.isArray(data.extracted_accounts) && data.extracted_accounts.length) indicators.push(`${data.extracted_accounts.length} akaun bank`);
  if (Array.isArray(data.extracted_urls) && data.extracted_urls.length) indicators.push(`${data.extracted_urls.length} URL`);
  if (indicators.length) lines.push(`Indikator: ${indicators.join(', ')}`);
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
  header.innerHTML = '<strong>📨 Dianalisis:</strong>';
  bubble.appendChild(header);

  // Each message
  messages.forEach((msg) => {
    const item = document.createElement('div');
    item.className = 'analyzed-convo-item';

    const label = document.createElement('span');
    label.className = 'analyzed-convo-label';
    label.textContent = msg.type === 'image' ? '🖼️ Gambar:' : 'Mesej:';

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
  time.textContent = 'Urutan dianalisis';

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

updateSendBtn();
