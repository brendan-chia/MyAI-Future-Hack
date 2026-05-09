// ── SafeLah Video Analysis Frontend ─────────────────────────────────────────
// Provides: runVideoAnalysis(), addVideoAnalysisCard(), BatchVideoSection
// Loaded by index.html AFTER chat.js

'use strict';

// ── State ────────────────────────────────────────────────────────────────────
let pendingVideo = null; // { base64, mimeType, fileName }

// ── Verdict colour map ────────────────────────────────────────────────────────
const VERDICT_CONFIG = {
  SAFE:      { color: '#10b981', bg: 'rgba(16,185,129,0.12)', label: '✅ SAFE' },
  SUSPICIOUS:{ color: '#f59e0b', bg: 'rgba(245,158,11,0.12)',  label: '⚠️ SUSPICIOUS' },
  HIGH_RISK: { color: '#f97316', bg: 'rgba(249,115,22,0.12)',  label: '🔶 HIGH RISK' },
  SCAM:      { color: '#ef4444', bg: 'rgba(239,68,68,0.12)',   label: '🚨 SCAM' },
};

function verdictCfg(v) {
  return VERDICT_CONFIG[v] || { color: '#7a96b8', bg: 'rgba(122,150,184,0.1)', label: v || 'UNKNOWN' };
}

// ── Main entry: single-file analysis ────────────────────────────────────────
window.runVideoAnalysis = async function(videoFile) {
  if (!videoFile) return;

  const fileName = videoFile.name || 'video.mp4';
  if (videoFile.size > 500 * 1024 * 1024) {
    addBotMessage('❌ Video file is too large. Maximum size is 500 MB.');
    return;
  }

  // ── Check if batch mode is active ────────────────────────────────────────
  const inBatchMode = typeof batchMode !== 'undefined' && batchMode;

  // Show user bubble
  const userBubble = document.createElement('div');
  userBubble.className = 'message user-message';
  userBubble.innerHTML = `
    <div class="message-avatar">👤</div>
    <div class="message-content">
      <div class="message-bubble" style="display:flex;align-items:center;gap:8px;">
        <span style="font-size:20px">🎬</span>
        <span style="font-size:13px">${fileName}</span>
      </div>
    </div>`;
  document.getElementById('chatArea').appendChild(userBubble);
  scrollToBottom();

  // Step indicators
  const steps = [
    'Step 1/4: Uploading video…',
    'Step 2/4: Transcribing audio…',
    'Step 3/4: Analysing for AI generation…',
    'Step 4/4: Generating verdict…',
  ];
  let stepIdx = 0;
  const thinking = addVideoThinking(
    inBatchMode ? '🎬 Analyzing video for batch…' : steps[0]
  );
  const stepInterval = setInterval(() => {
    stepIdx = Math.min(stepIdx + 1, steps.length - 1);
    const label = thinking.querySelector('.video-step-label');
    if (label) label.textContent = inBatchMode ? '🎬 Analyzing video for batch…' : steps[stepIdx];
  }, 12000);

  try {
    // Use FormData multipart — avoids Cloud Run's 32 MB JSON body limit
    const formData = new FormData();
    formData.append('video', videoFile, fileName);

    const res = await fetch('/api/video/analyze', {
      method: 'POST',
      credentials: 'include',
      body: formData,
    });
    clearInterval(stepInterval);
    thinking.remove();

    const data = await res.json();

    if (inBatchMode) {
      // ── Batch mode: collect video result into batch queue ───────────────
      const videoSummary = buildVideoSummaryForBatch(data, fileName);
      if (typeof batchMessages !== 'undefined') {
        batchMessages.push({
          type: 'video',
          text: videoSummary,
          fileName,
          preliminary_risk: data.final_verdict,   // SCAM / HIGH_RISK / SUSPICIOUS / SAFE
          preliminary_score: data.final_risk_score ?? 0,
        });
      }
      // Show compact confirmation
      const riskLabel = { SCAM: '🚨 SCAM', HIGH_RISK: '🔶 HIGH RISK', SUSPICIOUS: '⚠️ SUSPICIOUS', SAFE: '✅ SAFE' }[data.final_verdict] || '❓ ' + (data.final_verdict || 'UNKNOWN');
      const textCount = batchMessages.filter(m => m.type === 'text').length;
      const imgCount  = batchMessages.filter(m => m.type === 'image').length;
      const vidCount  = batchMessages.filter(m => m.type === 'video').length;
      addBotMessage(
        `✅ Video collected (preliminary: ${riskLabel})\n` +
        `Transcript captured for combined analysis.\n\n` +
        `Collected so far: ${textCount} messages, ${imgCount} images, ${vidCount} videos\n\n` +
        `  /analyze — analyze everything together\n` +
        `  /cancel  — cancel`
      );
    } else {
      // ── Normal mode: show full analysis card ────────────────────────────
      addVideoAnalysisCard(data, fileName);
    }
  } catch (err) {
    clearInterval(stepInterval);
    thinking.remove();
    addBotMessage('❌ Video analysis failed. Please try again.');
    console.error('[video] analysis error:', err);
  }
};

// ── Build a text summary of video analysis for use in batch context ───────────
function buildVideoSummaryForBatch(data, fileName) {
  const ta = data.transcript_analysis || {};
  const va = data.visual_analysis || {};
  const lines = [
    `[VIDEO EVIDENCE: ${fileName}]`,
    `Preliminary verdict: ${data.final_verdict || 'UNKNOWN'} (Risk score: ${data.final_risk_score ?? '?'}/100)`,
  ];
  if (ta.transcript) lines.push(`Audio transcript: "${ta.transcript.slice(0, 500)}${ta.transcript.length > 500 ? '…' : ''}"`);
  if (ta.transcript_verdict) lines.push(`Transcript scam verdict: ${ta.transcript_verdict}`);
  if (ta.scam_indicators && ta.scam_indicators.length) lines.push(`Scam indicators in audio: ${ta.scam_indicators.join(', ')}`);
  if (va.visual_verdict) lines.push(`Visual forensics: ${va.visual_verdict} (${va.visual_confidence ?? '?'}% confidence)`);
  if (va.visual_explanation) lines.push(`Visual analysis: ${va.visual_explanation.slice(0, 200)}`);
  if (data.final_explanation) lines.push(`Summary: ${data.final_explanation.slice(0, 300)}`);
  return lines.join('\n');
}

// ── URL analysis ─────────────────────────────────────────────────────────────
window.runVideoURLAnalysis = async function(url) {
  addBotMessage(`🎬 Analysing video URL…\n${url}`);
  const thinking = addVideoThinking('Step 1/4: Downloading video…');
  const steps = ['Step 1/4: Downloading video…','Step 2/4: Transcribing audio…','Step 3/4: Analysing for AI generation…','Step 4/4: Generating verdict…'];
  let si = 0;
  const iv = setInterval(() => {
    si = Math.min(si + 1, steps.length - 1);
    const l = thinking.querySelector('.video-step-label');
    if (l) l.textContent = steps[si];
  }, 12000);

  try {
    const res = await fetch('/api/video/analyze', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ source: 'url', value: url }),
    });
    clearInterval(iv);
    thinking.remove();
    const data = await res.json();
    addVideoAnalysisCard(data, url);
  } catch (err) {
    clearInterval(iv);
    thinking.remove();
    addBotMessage('❌ Video URL analysis failed.');
    console.error('[video url] error:', err);
  }
};

// ── Batch video section ───────────────────────────────────────────────────────
window.addBatchVideoSection = function(batchData) {
  if (!batchData || !batchData.results || batchData.results.length === 0) return;

  const chatArea = document.getElementById('chatArea');
  const wrapper = document.createElement('div');
  wrapper.className = 'message bot-message';
  wrapper.style.maxWidth = '100%';

  const avatar = document.createElement('div');
  avatar.className = 'message-avatar';
  avatar.textContent = '🎬';

  const content = document.createElement('div');
  content.className = 'message-content';
  content.style.width = '100%';

  const section = document.createElement('div');
  section.className = 'video-batch-section';
  section.innerHTML = `
    <div class="video-batch-header">
      <span>🎬 Videos Detected (${batchData.results.length})</span>
      <span class="video-batch-id" style="font-size:10px;opacity:0.5">Batch ${(batchData.batch_id||'').slice(0,8)}</span>
    </div>`;

  batchData.results.forEach((item, i) => {
    const cfg = verdictCfg(item.final_verdict);
    const card = document.createElement('div');
    card.className = 'video-batch-card';
    card.id = `vbcard-${i}`;
    card.innerHTML = `
      <div class="video-batch-card-header">
        <div style="display:flex;align-items:center;gap:8px;flex:1;min-width:0">
          <span class="video-verdict-badge" style="background:${cfg.bg};color:${cfg.color};border:1px solid ${cfg.color}40;padding:2px 8px;border-radius:4px;font-size:11px;font-weight:700;white-space:nowrap">${cfg.label}</span>
          <span style="font-size:11px;opacity:0.7;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${item.id}</span>
        </div>
        <button class="video-expand-btn" data-idx="${i}" onclick="toggleBatchCard(${i})">Expand ▸</button>
      </div>
      <div class="video-risk-bar-wrap">
        <div class="video-risk-bar" style="width:${item.final_risk_score||0}%;background:${cfg.color}"></div>
        <span style="font-size:10px;opacity:0.6;margin-left:6px">${item.final_risk_score||0}/100</span>
      </div>
      <div style="font-size:12px;opacity:0.75;margin-top:4px">${(item.final_explanation||'').slice(0,120)}${(item.final_explanation||'').length>120?'…':''}</div>
      <div class="video-batch-detail" id="vbdetail-${i}" style="display:none"></div>`;
    section.appendChild(card);

    // Pre-build expanded detail
    const detail = card.querySelector(`#vbdetail-${i}`);
    detail.appendChild(buildFullCard(item));
  });

  content.appendChild(section);
  wrapper.appendChild(avatar);
  wrapper.appendChild(content);
  chatArea.appendChild(wrapper);
  scrollToBottom();
};

window.toggleBatchCard = function(i) {
  const detail = document.getElementById(`vbdetail-${i}`);
  const btn = document.querySelector(`[data-idx="${i}"]`);
  if (!detail) return;
  const open = detail.style.display !== 'none';
  detail.style.display = open ? 'none' : 'block';
  if (btn) btn.textContent = open ? 'Expand ▸' : 'Collapse ▴';
};

// ── Full analysis card (used by both modes) ───────────────────────────────────
function addVideoAnalysisCard(data, label) {
  const chatArea = document.getElementById('chatArea');
  const wrapper = document.createElement('div');
  wrapper.className = 'message bot-message';
  wrapper.style.maxWidth = '100%';

  const avatar = document.createElement('div');
  avatar.className = 'message-avatar';
  avatar.textContent = '🎬';

  const content = document.createElement('div');
  content.className = 'message-content';
  content.style.width = '100%';

  content.appendChild(buildFullCard(data, label));

  wrapper.appendChild(avatar);
  wrapper.appendChild(content);
  chatArea.appendChild(wrapper);
  scrollToBottom();
}

function buildFullCard(data, label) {
  const cfg = verdictCfg(data.final_verdict);
  const ta = data.transcript_analysis || {};
  const va = data.visual_analysis || {};

  const card = document.createElement('div');
  card.className = 'video-analysis-card';
  card.style.cssText = `background:var(--bg-3);border:1px solid ${cfg.color}50;border-left:3px solid ${cfg.color};border-radius:12px;padding:14px;width:100%;`;

  // Header
  card.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;flex-wrap:wrap;gap:6px">
      <div style="display:flex;align-items:center;gap:8px">
        <span style="background:${cfg.bg};color:${cfg.color};border:1px solid ${cfg.color}60;padding:4px 12px;border-radius:6px;font-size:13px;font-weight:800;letter-spacing:0.04em">${cfg.label}</span>
        ${label ? `<span style="font-size:11px;opacity:0.55;max-width:160px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${label}">${label}</span>` : ''}
      </div>
      <span style="font-size:12px;opacity:0.6">Risk: <strong style="color:${cfg.color}">${data.final_risk_score ?? '—'}/100</strong></span>
    </div>

    <!-- Risk bar -->
    <div style="background:var(--bg-4);border-radius:99px;height:6px;margin-bottom:12px;overflow:hidden">
      <div style="height:100%;width:${data.final_risk_score||0}%;background:linear-gradient(90deg,${cfg.color}80,${cfg.color});transition:width 0.6s ease;border-radius:99px"></div>
    </div>

    <!-- Primary threat -->
    ${data.primary_threat ? `<div style="font-size:11px;opacity:0.6;margin-bottom:8px;font-family:var(--font-mono)">PRIMARY THREAT: <strong style="color:${cfg.color}">${data.primary_threat}</strong></div>` : ''}

    <!-- Final explanation -->
    <p style="font-size:13px;line-height:1.6;margin-bottom:10px">${data.final_explanation || ''}</p>

    <!-- Recommended action -->
    ${data.recommended_action ? `
    <div style="background:var(--bg-4);border:1px solid var(--border-strong);border-radius:8px;padding:8px 12px;margin-bottom:12px;font-size:12px;">
      <span style="opacity:0.55;font-size:10px;font-family:var(--font-mono);display:block;margin-bottom:2px">RECOMMENDED ACTION</span>
      ${data.recommended_action}
    </div>` : ''}
  `;

  // Collapsible sections
  card.appendChild(makeCollapsible('🔍 Visual Forensics', buildVisualSection(va)));
  card.appendChild(makeCollapsible('📝 Transcript Analysis', buildTranscriptSection(ta)));

  return card;
}

function buildVisualSection(va) {
  const cfg = verdictCfg(va.visual_verdict === 'REAL' ? 'SAFE' : va.visual_verdict === 'LIKELY_FAKE' ? 'SUSPICIOUS' : va.visual_verdict === 'FAKE' || va.visual_verdict === 'AI_GENERATED' ? 'SCAM' : 'SUSPICIOUS');
  const signals = Array.isArray(va.visual_signals) ? va.visual_signals : [];

  const div = document.createElement('div');
  div.style.cssText = 'font-size:13px;padding-top:8px';
  div.innerHTML = `
    <div style="display:flex;gap:8px;align-items:center;margin-bottom:6px;flex-wrap:wrap">
      <span style="background:${cfg.bg};color:${cfg.color};border:1px solid ${cfg.color}40;padding:2px 8px;border-radius:4px;font-size:11px;font-weight:700">${va.visual_verdict || 'N/A'}</span>
      ${va.visual_confidence != null ? `<span style="font-size:11px;opacity:0.6">Confidence: ${va.visual_confidence}%</span>` : ''}
      ${va.deepfake_type ? `<span style="font-size:11px;opacity:0.6;font-family:var(--font-mono)">${va.deepfake_type}</span>` : ''}
    </div>
    <p style="opacity:0.8;line-height:1.5;margin-bottom:8px">${va.visual_explanation || 'No visual analysis available.'}</p>
    ${signals.length ? `<ul style="margin:0;padding-left:16px;opacity:0.7;font-size:12px">${signals.map(s=>`<li>${s}</li>`).join('')}</ul>` : ''}
  `;
  return div;
}

function buildTranscriptSection(ta) {
  const cfg = verdictCfg(ta.transcript_verdict === 'SAFE' ? 'SAFE' : ta.transcript_verdict === 'SCAM' ? 'SCAM' : 'SUSPICIOUS');
  const indicators = Array.isArray(ta.scam_indicators) ? ta.scam_indicators : [];

  const div = document.createElement('div');
  div.style.cssText = 'font-size:13px;padding-top:8px';
  div.innerHTML = `
    <div style="display:flex;gap:8px;align-items:center;margin-bottom:6px;flex-wrap:wrap">
      <span style="background:${cfg.bg};color:${cfg.color};border:1px solid ${cfg.color}40;padding:2px 8px;border-radius:4px;font-size:11px;font-weight:700">${ta.transcript_verdict || 'N/A'}</span>
      ${ta.transcript_confidence != null ? `<span style="font-size:11px;opacity:0.6">Confidence: ${ta.transcript_confidence}%</span>` : ''}
    </div>
    <p style="opacity:0.8;line-height:1.5;margin-bottom:8px">${ta.transcript_explanation || 'No transcript available.'}</p>
    ${indicators.length ? `<div style="margin-bottom:8px"><span style="font-size:10px;opacity:0.5;font-family:var(--font-mono)">SCAM INDICATORS</span><ul style="margin:4px 0 0;padding-left:16px;opacity:0.7;font-size:12px">${indicators.map(s=>`<li>${s}</li>`).join('')}</ul></div>` : ''}
    ${ta.transcript ? `
    <details style="margin-top:8px">
      <summary style="font-size:11px;opacity:0.55;cursor:pointer;font-family:var(--font-mono)">Full transcript</summary>
      <pre style="margin-top:6px;background:var(--bg-base);border:1px solid var(--border);border-radius:6px;padding:10px;font-size:11px;line-height:1.5;overflow-y:auto;max-height:200px;white-space:pre-wrap;word-break:break-word;font-family:var(--font-mono)">${escHtml(ta.transcript)}</pre>
    </details>` : ''}
  `;
  return div;
}

function makeCollapsible(title, contentEl) {
  const wrap = document.createElement('div');
  wrap.style.cssText = 'border-top:1px solid var(--border);margin-top:10px;padding-top:8px';

  const toggle = document.createElement('button');
  toggle.style.cssText = 'background:none;border:none;cursor:pointer;color:var(--text-2);font-size:12px;font-family:var(--font-mono);padding:0;display:flex;align-items:center;gap:6px;width:100%';
  toggle.innerHTML = `<span class="caret" style="display:inline-block;transition:transform 0.2s">▸</span> ${title}`;

  const body = document.createElement('div');
  body.style.display = 'none';
  body.appendChild(contentEl);

  toggle.addEventListener('click', () => {
    const open = body.style.display !== 'none';
    body.style.display = open ? 'none' : 'block';
    toggle.querySelector('.caret').style.transform = open ? '' : 'rotate(90deg)';
  });

  wrap.appendChild(toggle);
  wrap.appendChild(body);
  return wrap;
}

// ── Thinking bubble with step indicator ──────────────────────────────────────
function addVideoThinking(initialLabel) {
  const wrapper = document.createElement('div');
  wrapper.className = 'message bot-message';

  const avatar = document.createElement('div');
  avatar.className = 'message-avatar';
  avatar.textContent = '🎬';

  const content = document.createElement('div');
  content.className = 'message-content';

  const bubble = document.createElement('div');
  bubble.className = 'message-bubble';
  bubble.innerHTML = `
    <div class="thinking-dots"><span></span><span></span><span></span></div>
    <span class="video-step-label" style="font-size:0.78rem;color:var(--text-2)">${initialLabel}</span>
  `;

  content.appendChild(bubble);
  wrapper.appendChild(avatar);
  wrapper.appendChild(content);
  document.getElementById('chatArea').appendChild(wrapper);
  scrollToBottom();
  return wrapper;
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload  = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function escHtml(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

// ── Hook into existing attach button to also accept video files ───────────────
document.addEventListener('DOMContentLoaded', () => {
  const imageInput = document.getElementById('imageInput');
  if (imageInput) {
    // Extend accepted types to include video
    imageInput.setAttribute('accept', 'image/*,audio/*,.ogg,.mp3,.mp4,.m4a,.wav,video/*,.mov,.avi,.webm,.mkv');
  }
});

// ── Video URL input via /video command ────────────────────────────────────────
// Registers as a handler in the existing handleSlashCommand flow
// by patching the global unknown-command fallback in chat.js
const _origHandleSlash = window._videoOrigHandleSlash || null;

// Intercept /video command via a DOMContentLoaded hook that waits for chat.js
document.addEventListener('DOMContentLoaded', () => {
  const messageInput = document.getElementById('messageInput');
  if (messageInput) {
    messageInput.setAttribute('placeholder', 'Paste suspicious message, URL or /video <url>…');
  }
});
