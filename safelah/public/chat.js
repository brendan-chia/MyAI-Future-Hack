// ── SelamatLah Chat Client ────────────────────────────────────────────────────

const chatArea      = document.getElementById('chatArea');
const messageInput  = document.getElementById('messageInput');
const sendBtn       = document.getElementById('sendBtn');
const imageInput    = document.getElementById('imageInput');
const imagePreviewBar = document.getElementById('imagePreviewBar');
const imagePreviewImg = document.getElementById('imagePreviewImg');
const imageRemoveBtn  = document.getElementById('imageRemoveBtn');
const dropOverlay   = document.getElementById('dropOverlay');

let pendingImage = null; // { base64, mimeType }
let isProcessing = false;

// ── Session ID (persists per tab) ─────────────────────────────────────────────
const sessionId = 'web-' + Math.random().toString(36).slice(2, 10);

// ── Auto-resize textarea ──────────────────────────────────────────────────────
messageInput.addEventListener('input', () => {
  messageInput.style.height = 'auto';
  messageInput.style.height = Math.min(messageInput.scrollHeight, 120) + 'px';
  updateSendBtn();
});

function updateSendBtn() {
  sendBtn.disabled = isProcessing || (!messageInput.value.trim() && !pendingImage);
}

// ── Send on Enter (Shift+Enter for newline) ───────────────────────────────────
messageInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    if (!sendBtn.disabled) handleSend();
  }
});

sendBtn.addEventListener('click', handleSend);

// ── Image attach via button ───────────────────────────────────────────────────
imageInput.addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (file) attachImage(file);
  imageInput.value = ''; // reset so same file can be picked again
});

imageRemoveBtn.addEventListener('click', clearImage);

// ── Drag & drop ───────────────────────────────────────────────────────────────
let dragCounter = 0;
document.addEventListener('dragenter', (e) => {
  e.preventDefault();
  dragCounter++;
  dropOverlay.classList.add('active');
});
document.addEventListener('dragleave', (e) => {
  e.preventDefault();
  dragCounter--;
  if (dragCounter <= 0) {
    dropOverlay.classList.remove('active');
    dragCounter = 0;
  }
});
document.addEventListener('dragover', (e) => e.preventDefault());
document.addEventListener('drop', (e) => {
  e.preventDefault();
  dropOverlay.classList.remove('active');
  dragCounter = 0;
  const file = e.dataTransfer.files[0];
  if (file && file.type.startsWith('image/')) attachImage(file);
});

// ── Attach image helper ───────────────────────────────────────────────────────
function attachImage(file) {
  const reader = new FileReader();
  reader.onload = () => {
    pendingImage = { base64: reader.result, mimeType: file.type };
    imagePreviewImg.src = reader.result;
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

// ── Send handler ──────────────────────────────────────────────────────────────
async function handleSend() {
  const text = messageInput.value.trim();
  const image = pendingImage;

  if (!text && !image) return;
  if (isProcessing) return;

  isProcessing = true;
  updateSendBtn();

  // Show user message
  if (image) {
    addImageMessage(image.base64);
  }
  if (text) {
    addMessage(text, 'user');
  }

  // Clear input
  messageInput.value = '';
  messageInput.style.height = 'auto';
  clearImage();

  // Show thinking indicator
  const thinkingEl = addThinking();

  try {
    let data;
    if (image) {
      // Image analysis
      const res = await fetch('/api/analyse-image', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          image: image.base64,
          mimeType: image.mimeType,
          sessionId,
        }),
      });
      data = await res.json();
    } else {
      // Text analysis
      const res = await fetch('/api/analyse', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, sessionId }),
      });
      data = await res.json();
    }

    // Remove thinking, show verdict
    thinkingEl.remove();
    addVerdict(getVerdictText(data), data?.risk_level || 'UNKNOWN');
    addPipelineDetails(data);
  } catch (err) {
    thinkingEl.remove();
    addVerdict(
      'Maaf, semakan tidak tersedia sekarang.\n\nCuba lagi sebentar. 🙏',
      'UNKNOWN'
    );
    console.error('Analysis error:', err);
  }

  isProcessing = false;
  updateSendBtn();
  messageInput.focus();
}

// ── DOM helpers ───────────────────────────────────────────────────────────────
function addMessage(text, role) {
  const wrapper = document.createElement('div');
  wrapper.className = `message ${role}-message`;

  const avatar = document.createElement('div');
  avatar.className = 'message-avatar';
  avatar.textContent = role === 'bot' ? '🛡️' : '👤';

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

  const img = document.createElement('img');
  img.src = src;
  img.alt = 'Screenshot';
  bubble.appendChild(img);

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

function addThinking() {
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
    <div class="thinking-dots">
      <span></span><span></span><span></span>
    </div>
    <span style="font-size:0.78rem;color:var(--text-muted)">Sedang semak...</span>
  `;

  content.appendChild(bubble);
  wrapper.appendChild(avatar);
  wrapper.appendChild(content);
  chatArea.appendChild(wrapper);
  scrollToBottom();
  return wrapper;
}

function addVerdict(text, riskLevel) {
  const wrapper = document.createElement('div');
  const riskClass = riskLevel === 'HIGH'   ? 'verdict-high'
                  : riskLevel === 'MEDIUM' ? 'verdict-medium'
                  : riskLevel === 'LOW'    ? 'verdict-low'
                  : '';
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
  if (data && typeof data.verdict === 'string' && data.verdict.trim()) {
    return data.verdict;
  }
  if (data && typeof data.reason_bm === 'string' && data.reason_bm.trim()) {
    return `⚠️ Keputusan ringkas:\n${data.reason_bm}`;
  }
  if (data && typeof data.reason_en === 'string' && data.reason_en.trim()) {
    return `⚠️ Quick result:\n${data.reason_en}`;
  }
  return 'Maaf, keputusan tidak dapat dipaparkan sekarang. Sila cuba semula.';
}

function addPipelineDetails(data) {
  if (!data || typeof data !== 'object') return;

  const lines = [];
  const indicators = [];

  if (data.flow) {
    lines.push(`Pipeline: ${data.flow}`);
  }

  const conf = Number(data.confidence);
  if (Number.isFinite(conf)) {
    lines.push(`Confidence: ${Math.round(conf * 100)}%`);
  }

  if (data.ccid) {
    if (data.ccid.found) {
      lines.push(`PDRM Semak Mule: ${data.ccid.reports || 0} laporan sepadan`);
    } else {
      lines.push('PDRM Semak Mule: tiada padanan');
    }
  }

  if (data.vertex) {
    if (data.vertex.found) {
      lines.push(`Vertex AI Search: ${data.vertex.hits || 0} rekod sepadan`);
    } else {
      lines.push('Vertex AI Search: tiada padanan');
    }
  }

  if (Array.isArray(data.extracted_phones) && data.extracted_phones.length) {
    indicators.push(`${data.extracted_phones.length} nombor telefon`);
  }
  if (Array.isArray(data.extracted_accounts) && data.extracted_accounts.length) {
    indicators.push(`${data.extracted_accounts.length} akaun bank`);
  }
  if (Array.isArray(data.extracted_urls) && data.extracted_urls.length) {
    indicators.push(`${data.extracted_urls.length} URL`);
  }

  if (indicators.length) {
    lines.push(`Indikator dikesan: ${indicators.join(', ')}`);
  }

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

function scrollToBottom() {
  requestAnimationFrame(() => {
    chatArea.scrollTop = chatArea.scrollHeight;
  });
}

// ── Initial focus ─────────────────────────────────────────────────────────────
updateSendBtn();
