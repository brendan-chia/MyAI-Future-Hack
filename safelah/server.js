require('dotenv').config();
const express = require('express');
const path    = require('path');
const session = require('express-session');
const bcrypt  = require('bcryptjs');
const crypto  = require('crypto');
const { dbReady, getDb } = require('./connection');
const { handleIncoming } = require('./message');
const { initializeWhatsApp, getClient } = require('./whatsapp');

const app = express();

// ── Core Middleware ─────────────────────────────────────────────────────────
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: false }));
app.use(express.static(path.join(__dirname, 'public')));

// ── Session middleware ───────────────────────────────────────────────────────
app.use(session({
  secret: process.env.SESSION_SECRET || 'safelah-dev-secret-change-me',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 7 * 24 * 60 * 60 * 1000 }, // 7 days
}));

// ── Auth helpers ─────────────────────────────────────────────────────────────
function requireLogin(req, res, next) {
  if (req.session && req.session.userId) return next();
  return res.status(401).json({ error: 'Please log in' });
}

function requireGuardian(req, res, next) {
  if (req.session && req.session.role === 'guardian') return next();
  return res.status(403).json({ error: 'Guardian access only' });
}

function generate6DigitCode() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

// ── Auth routes ──────────────────────────────────────────────────────────────

// ── SSE: guardian alert subscribers ────────────────────────────────────────────
// Map of guardianId → Set of SSE response objects
const alertSubscribers = new Map();

function pushAlertToGuardian(guardianId, payload) {
  const subs = alertSubscribers.get(guardianId);
  if (!subs || subs.size === 0) return;
  const data = JSON.stringify(payload);
  for (const res of subs) {
    try { res.write(`data: ${data}\n\n`); } catch (_) { subs.delete(res); }
  }
}

// Unified register (chat-based: role is always 'guardian' initially; elderly uses /link-family)
app.post('/api/auth/register', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password required' });
  }
  try {
    const db   = getDb();
    const hash = await bcrypt.hash(password, 10);
    const code = generate6DigitCode();
    try {
      db.run(
        `INSERT INTO web_accounts (role, username, password, guardian_code)
         VALUES ('guardian', ?, ?, ?)`,
        [username, hash, code]
      );
    } catch (dbErr) {
      if (dbErr.message && dbErr.message.includes('UNIQUE')) {
        return res.status(409).json({ error: 'Username already taken' });
      }
      throw dbErr;
    }
    // Auto-login after register
    const row = db.exec(`SELECT id FROM web_accounts WHERE username = '${username.replace(/'/g, "''")}' LIMIT 1`);
    const userId = row && row[0] && row[0].values[0][0];
    req.session.userId   = userId;
    req.session.username = username;
    req.session.role     = 'guardian';
    // Save to disk immediately so data survives restarts
    const { saveDb } = require('./connection');
    saveDb();
    console.log(`[register] New guardian: ${username} (id=${userId}) code=${code}`);
    res.json({ success: true, username, guardianCode: code });
  } catch (err) {
    console.error('[auth/register]', err);
    res.status(500).json({ error: 'Registration failed' });
  }
});

// Guardian register (kept for auth.html compatibility)
app.post('/api/auth/register/guardian', async (req, res) => {
  const { username, password, phone } = req.body;
  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password required' });
  }
  try {
    const db   = getDb();
    const hash = await bcrypt.hash(password, 10);
    const code = generate6DigitCode();
    try {
      db.run(
        `INSERT INTO web_accounts (role, username, password, phone, guardian_code)
         VALUES ('guardian', ?, ?, ?, ?)`,
        [username, hash, phone || null, code]
      );
    } catch (dbErr) {
      if (dbErr.message && dbErr.message.includes('UNIQUE')) {
        return res.status(409).json({ error: 'Username already taken' });
      }
      throw dbErr;
    }
    res.json({ success: true, message: 'Guardian registered', guardianCode: code });
  } catch (err) {
    console.error('[auth/register/guardian]', err);
    res.status(500).json({ error: 'Registration failed' });
  }
});

// Elderly register (kept for auth.html compatibility)
app.post('/api/auth/register/elderly', async (req, res) => {
  const { username, password, phone, guardianCode } = req.body;
  if (!username || !password || !guardianCode) {
    return res.status(400).json({ error: 'Username, password and guardian code required' });
  }
  try {
    const db       = getDb();
    const guardian = db.exec(
      `SELECT id FROM web_accounts WHERE guardian_code = '${guardianCode}' AND role = 'guardian' LIMIT 1`
    );
    const rows = guardian && guardian[0] && guardian[0].values;
    if (!rows || !rows.length) {
      return res.status(400).json({ error: 'Invalid guardian code' });
    }
    const guardianId = rows[0][0];
    const hash = await bcrypt.hash(password, 10);
    try {
      db.run(
        `INSERT INTO web_accounts (role, username, password, phone, guardian_id)
         VALUES ('elderly', ?, ?, ?, ?)`,
        [username, hash, phone || null, guardianId]
      );
    } catch (dbErr) {
      if (dbErr.message && dbErr.message.includes('UNIQUE')) {
        return res.status(409).json({ error: 'Username already taken' });
      }
      throw dbErr;
    }
    res.json({ success: true, message: 'Registered successfully. You can now log in.' });
  } catch (err) {
    console.error('[auth/register/elderly]', err);
    res.status(500).json({ error: 'Registration failed' });
  }
});

// Link family — logged-in user links themselves to a guardian using the 6-digit code
app.post('/api/auth/link-family', requireLogin, (req, res) => {
  const { guardianCode } = req.body;
  if (!guardianCode) return res.status(400).json({ error: 'Guardian code required' });
  try {
    const db       = getDb();
    const guardian = db.exec(
      `SELECT id, username FROM web_accounts WHERE guardian_code = '${guardianCode}' AND role = 'guardian' LIMIT 1`
    );
    const rows = guardian && guardian[0] && guardian[0].values;
    if (!rows || !rows.length) {
      return res.status(400).json({ error: 'Invalid guardian code' });
    }
    const [guardianId, guardianName] = rows[0];
    // Update current user to be 'elderly' and link to guardian
    db.run(
      `UPDATE web_accounts SET role = 'elderly', guardian_id = ? WHERE id = ?`,
      [guardianId, req.session.userId]
    );
    req.session.role = 'elderly';

    // Save immediately so link persists across restarts
    const { saveDb } = require('./connection');
    saveDb();
    console.log(`[link-family] User ${req.session.username} (id=${req.session.userId}) linked to guardian ${guardianName} (id=${guardianId})`);

    // Push SSE to guardian notifying them that a new member was linked
    try {
      pushAlertToGuardian(guardianId, {
        elderly: req.session.username,
        risk_level: 'INFO',
        scam_type: null,
        snippet: `Telah berjaya disambungkan kepada anda sebagai ahli keluarga.`,
        time: new Date().toISOString(),
      });
    } catch (pushErr) {
      console.warn('[auth/link-family] Failed to push SSE alert', pushErr.message);
    }

    res.json({ success: true, guardianName });
  } catch (err) {
    console.error('[auth/link-family]', err);
    res.status(500).json({ error: 'Link failed' });
  }
});

// My guardian code (for guardians to see their code again after login)
app.get('/api/auth/my-code', requireLogin, (req, res) => {
  if (req.session.role !== 'guardian') {
    return res.status(403).json({ error: 'Only guardians have a code' });
  }
  try {
    const db  = getDb();
    const raw = db.exec(`SELECT guardian_code FROM web_accounts WHERE id = ${req.session.userId} LIMIT 1`);
    const rows = raw && raw[0] && raw[0].values;
    if (!rows || !rows.length) return res.status(404).json({ error: 'Not found' });
    res.json({ guardianCode: rows[0][0] });
  } catch (err) {
    res.status(500).json({ error: 'Failed' });
  }
});

// Login (both roles)
app.post('/api/auth/login', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password required' });
  }
  try {
    const db  = getDb();
    const raw = db.exec(
      `SELECT id, role, username, password, guardian_code FROM web_accounts WHERE username = '${username.replace(/'/g, "''")}' LIMIT 1`
    );
    const rows = raw && raw[0] && raw[0].values;
    if (!rows || !rows.length) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    const [id, role, uname, hash, guardianCode] = rows[0];
    const match = await bcrypt.compare(password, hash);
    if (!match) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    req.session.userId   = id;
    req.session.username = uname;
    req.session.role     = role;
    console.log(`[login] User ${uname} (id=${id}) role=${role}`);
    const payload = { success: true, role, username: uname };
    if (role === 'guardian') payload.guardianCode = guardianCode;
    res.json(payload);
  } catch (err) {
    console.error('[auth/login]', err);
    res.status(500).json({ error: 'Login failed' });
  }
});

// Logout
app.post('/api/auth/logout', (req, res) => {
  req.session.destroy(() => res.json({ success: true }));
});

// Current user
app.get('/api/auth/me', (req, res) => {
  if (!req.session || !req.session.userId) {
    return res.status(401).json({ loggedIn: false });
  }
  res.json({ loggedIn: true, userId: req.session.userId, username: req.session.username, role: req.session.role });
});

// ── Alerts: SSE stream for guardians ─────────────────────────────────────────────
app.get('/api/alerts/stream', requireLogin, (req, res) => {
  if (req.session.role !== 'guardian') {
    return res.status(403).json({ error: 'Guardians only' });
  }
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const guardianId = req.session.userId;
  if (!alertSubscribers.has(guardianId)) alertSubscribers.set(guardianId, new Set());
  alertSubscribers.get(guardianId).add(res);

  // Keep-alive ping every 25s
  const ping = setInterval(() => { try { res.write(': ping\n\n'); } catch (_) {} }, 25000);

  req.on('close', () => {
    clearInterval(ping);
    const subs = alertSubscribers.get(guardianId);
    if (subs) { subs.delete(res); if (subs.size === 0) alertSubscribers.delete(guardianId); }
  });
});

// Alerts: get unread alerts for guardian
app.get('/api/alerts', requireLogin, (req, res) => {
  if (req.session.role !== 'guardian') return res.status(403).json({ error: 'Guardians only' });
  try {
    const db  = getDb();
    const raw = db.exec(
      `SELECT id, elderly_name, risk_level, scam_type, snippet, created_at
       FROM family_alerts WHERE guardian_id = ${req.session.userId} AND is_read = 0
       ORDER BY created_at DESC LIMIT 20`
    );
    const cols  = raw && raw[0] ? raw[0].columns : [];
    const rows  = raw && raw[0] ? raw[0].values  : [];
    const alerts = rows.map(r => Object.fromEntries(cols.map((c, i) => [c, r[i]])));
    res.json({ alerts });
  } catch (err) {
    res.status(500).json({ error: 'Failed' });
  }
});

// Mark alerts read
app.post('/api/alerts/read', requireLogin, (req, res) => {
  try {
    const db = getDb();
    db.run(`UPDATE family_alerts SET is_read = 1 WHERE guardian_id = ?`, [req.session.userId]);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: 'Failed' }); }
});


// ── Web UI: Text analysis API ───────────────────────────────────────────────
app.post('/api/analyse', async (req, res) => {
  try {
    const { text, sessionId } = req.body;
    if (!text || !text.trim()) {
      return res.status(400).json({ error: 'No text provided' });
    }

    const from = sessionId || req.session?.username || 'web-user';
    const { analyseTextDirect } = require('./text');
    const result = await analyseTextDirect(from, text);

    // If user is logged-in and has a guardian, push alert for HIGH/MEDIUM
    let alertSent = false;
    console.log(`[analyse] session userId=${req.session?.userId}, username=${req.session?.username}, risk=${result.risk_level}`);
    if (req.session?.userId &&
        (result.risk_level === 'HIGH' || result.risk_level === 'MEDIUM')) {
      try {
        const db  = getDb();
        const raw = db.exec(
          `SELECT guardian_id FROM web_accounts WHERE id = ${req.session.userId} LIMIT 1`
        );
        const gRows = raw && raw[0] && raw[0].values;
        console.log(`[alert] guardian_id lookup for user ${req.session.userId}:`, gRows);
        if (gRows && gRows.length) {
          const guardianId = gRows[0][0];
          if (guardianId) {
            const snippet = text.slice(0, 120);
            db.run(
              `INSERT INTO family_alerts (guardian_id, elderly_id, elderly_name, risk_level, scam_type, snippet)
               VALUES (?, ?, ?, ?, ?, ?)`,
              [guardianId, req.session.userId, req.session.username,
               result.risk_level, result.scam_type || null, snippet]
            );
            pushAlertToGuardian(guardianId, {
              elderly: req.session.username,
              risk_level: result.risk_level,
              scam_type: result.scam_type || null,
              snippet,
              time: new Date().toISOString(),
            });
            alertSent = true;
            console.log(`[alert] ✅ Pushed alert to guardian ${guardianId} for user ${req.session.username}`);
          } else {
            console.log(`[alert] ⚠️ User ${req.session.username} has no guardian_id linked`);
          }
        }
      } catch (alertErr) {
        console.warn('[alert push] error:', alertErr.message);
      }
    } else {
      if (!req.session?.userId) console.log(`[alert] ⚠️ No session — user not logged in, cannot push alert`);
    }

    result.alertSent = alertSent;
    res.json(result);
  } catch (err) {
    console.error('[analyse] error:', err);
    res.status(500).json({
      error: 'Analysis failed',
      verdict: 'Sorry, checking is not available right now.\n\n❌ Do not transfer money to strangers\n❌ Do not click links in unknown messages\n\nAnti-Scam Hotline: 997',
      risk_level: 'UNKNOWN',
    });
  }
});

// ── Web UI: Direct Genkit flow API ─────────────────────────────────────────
app.post('/api/flow', async (req, res) => {
  try {
    const { text, sessionId } = req.body;
    if (!text || !text.trim()) {
      return res.status(400).json({ error: 'No text provided' });
    }

    const { runScamDetectionFlow } = require('./text');
    const result = await runScamDetectionFlow({
      text: text.trim(),
      phone: sessionId || 'web-user',
    });

    res.json({
      flow: 'genkit_scamDetectionFlow',
      risk_level: result.risk_level,
      scam_type: result.scam_type,
      confidence: result.confidence,
      reason_bm: result.reason_bm,
      reason_en: result.reason_en,
      extracted_phones: result.extracted_phones || [],
      extracted_accounts: result.extracted_accounts || [],
      extracted_urls: result.extracted_urls || [],
      ccid: result.ccidResult || { found: false, reports: 0 },
      vertex: result.vertexResult || { found: false, hits: 0, results: [] },
    });
  } catch (err) {
    console.error('[flow] error:', err);
    res.status(500).json({ error: 'Flow execution failed' });
  }
});

// ── Web UI: Image analysis API ──────────────────────────────────────────────
app.post('/api/analyse-image', async (req, res) => {
  try {
    const { image, mimeType } = req.body;
    if (!image) {
      return res.status(400).json({ error: 'No image provided' });
    }

    // Strip data URL prefix if present
    const base64Data = image.replace(/^data:image\/\w+;base64,/, '');
    const mime = mimeType || 'image/jpeg';

    const result = await require('./image').analyseImageDirect(base64Data, mime);

    // If user is logged-in and has a guardian, push alert for HIGH/MEDIUM
    let alertSent = false;
    console.log(`[analyse-image] session userId=${req.session?.userId}, username=${req.session?.username}, risk=${result.risk_level}`);
    if (req.session?.userId &&
        (result.risk_level === 'HIGH' || result.risk_level === 'MEDIUM')) {
      try {
        const db  = getDb();
        const raw = db.exec(
          `SELECT guardian_id FROM web_accounts WHERE id = ${req.session.userId} LIMIT 1`
        );
        const gRows = raw && raw[0] && raw[0].values;
        console.log(`[alert] guardian_id lookup for user ${req.session.userId}:`, gRows);
        if (gRows && gRows.length) {
          const guardianId = gRows[0][0];
          if (guardianId) {
            const snippet = `[Image detected]`.slice(0, 120);
            db.run(
              `INSERT INTO family_alerts (guardian_id, elderly_id, elderly_name, risk_level, scam_type, snippet)
               VALUES (?, ?, ?, ?, ?, ?)`,
              [guardianId, req.session.userId, req.session.username,
               result.risk_level, result.scam_type || null, snippet]
            );
            pushAlertToGuardian(guardianId, {
              elderly: req.session.username,
              risk_level: result.risk_level,
              scam_type: result.scam_type || null,
              snippet,
              time: new Date().toISOString(),
            });
            alertSent = true;
            console.log(`[alert] ✅ Pushed alert to guardian ${guardianId} for user ${req.session.username}`);
          } else {
            console.log(`[alert] ⚠️ User ${req.session.username} has no guardian_id linked`);
          }
        }
      } catch (alertErr) {
        console.warn('[alert push] error:', alertErr.message);
      }
    } else {
      if (!req.session?.userId) console.log(`[alert] ⚠️ No session — user not logged in, cannot push alert`);
    }

    result.alertSent = alertSent;
    res.json(result);
  } catch (err) {
    console.error('[analyse-image] error:', err);
    res.status(500).json({ error: 'Image analysis failed', risk_level: 'UNKNOWN' });
  }
});

// ── Web UI: Audio transcription API (Gemini-based) ──────────────────────────
app.post('/api/transcribe', async (req, res) => {
  try {
    const { audio, mimeType, fileName } = req.body;
    if (!audio) {
      return res.status(400).json({ error: 'No audio provided' });
    }

    // Strip data URL prefix if present
    const base64Data = audio.replace(/^data:.*?;base64,/, '');
    const cleanMime = (mimeType || 'audio/webm').split(';')[0].trim().toLowerCase();

    // Determine a supported Gemini audio MIME type
    let geminiMime = cleanMime;
    if (cleanMime.includes('ogg') || cleanMime.includes('opus')) geminiMime = 'audio/ogg';
    else if (cleanMime.includes('mp3') || cleanMime.includes('mpeg')) geminiMime = 'audio/mp3';
    else if (cleanMime.includes('wav')) geminiMime = 'audio/wav';
    else if (cleanMime.includes('mp4') || cleanMime.includes('m4a')) geminiMime = 'audio/mp4';
    else if (cleanMime.includes('flac')) geminiMime = 'audio/flac';
    else if (cleanMime.includes('webm')) geminiMime = 'audio/webm';
    else if (fileName) {
      const ext = (fileName.split('.').pop() || '').toLowerCase();
      const EXT_MAP = { ogg: 'audio/ogg', mp3: 'audio/mp3', wav: 'audio/wav',
                        m4a: 'audio/mp4', mp4: 'audio/mp4', flac: 'audio/flac', webm: 'audio/webm' };
      geminiMime = EXT_MAP[ext] || 'audio/webm';
    }

    // Use Gemini's native audio understanding — no Cloud Speech credentials needed
    const { GoogleGenerativeAI } = require('@google/generative-ai');
    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    const model = genAI.getGenerativeModel({ model: 'gemini-3.1-flash-lite-preview' });

    const prompt = `You are a transcription engine for a Malaysian scam-detection app.

Listen to this audio recording carefully and transcribe every word spoken — in whatever language is used (Malay, English, Mandarin, Tamil, or mixed).

Rules:
- Output ONLY the raw transcript — no labels, no commentary, no explanations.
- Preserve the original language(s); do not translate.
- If you hear multiple speakers, separate their lines with a dash (–).
- If a portion is inaudible, write [inaudible].
- If there is no speech, output the single word: SILENCE`;

    const result = await model.generateContent([
      {
        inlineData: {
          mimeType: geminiMime,
          data: base64Data,
        },
      },
      prompt,
    ]);

    const rawText = result.response.text().trim();
    const transcript = (rawText === 'SILENCE' || !rawText) ? '' : rawText;

    console.log(`[transcribe/gemini] mime=${geminiMime} → ${transcript.length} chars`);
    res.json({ transcript, success: !!transcript });
  } catch (err) {
    console.error('[transcribe] error:', err);
    res.status(500).json({ error: 'Transcription failed', transcript: '' });
  }
});

// ── Web UI: Batch analysis API (mirrors WhatsApp /start → /analyze flow) ────
app.post('/api/analyse-batch', async (req, res) => {
  try {
    const { messages, sessionId } = req.body;
    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json({ error: 'No messages provided' });
    }

    const { extractTextFromImage, analyseConversationWithGemini } = require('./gemini');
    const { keywordAnalyse } = require('./keywordFallback');
    const { extractEntities } = require('./extractor');
    const { buildVerdict } = require('./verdictBuilder');
    const { logScamIntelligence } = require('./queries');
    const { detectLanguage } = require('./language');
    const { runScamDetectionFlow } = require('./text');

    console.log(`[batch-web] Processing ${messages.length} messages from ${sessionId || 'web-user'}`);

    // Step 1: Enrich messages — extract text from images
    const enrichedMessages = await Promise.all(messages.map(async (msg, idx) => {
      if (msg.type === 'image' && msg.image) {
        try {
          const base64Data = msg.image.replace(/^data:image\/\w+;base64,/, '');
          const extraction = await extractTextFromImage(base64Data, msg.mimeType || 'image/jpeg');
          if (extraction && extraction.extracted_text) {
            return {
              type: 'image',
              text: extraction.extracted_text,
              visual_cues: extraction.visual_cues || '',
              extracted_phones: extraction.phones || [],
              extracted_accounts: extraction.accounts || [],
              extracted_urls: extraction.urls || [],
            };
          } else {
            return { type: 'image', text: '[Image: could not extract text]' };
          }
        } catch (err) {
          console.error(`[batch-web] Image ${idx + 1} extraction failed:`, err.message);
          return { type: 'image', text: '[Image: extraction failed]' };
        }
      }
      return { type: 'text', text: msg.text || '' };
    }));

    // Step 2: Run conversation-level Gemini analysis on all messages together
    let conversationResult = await analyseConversationWithGemini(enrichedMessages);

    if (!conversationResult) {
      console.warn('[batch-web] Gemini unavailable, falling back to keyword analysis');
      const combinedText = enrichedMessages.map(m => m.text).join('\n\n');
      conversationResult = keywordAnalyse(combinedText);
      conversationResult.source = 'keyword_fallback';
    }

    // Step 3: Extract entities from all messages
    const allPhones = [];
    const allAccounts = [];
    const allUrls = [];
    enrichedMessages.forEach(msg => {
      if (msg.text) {
        const { phones, accounts, urls } = extractEntities(msg.text);
        allPhones.push(...phones);
        allAccounts.push(...accounts);
        allUrls.push(...urls);
      }
      if (msg.extracted_phones) allPhones.push(...msg.extracted_phones);
      if (msg.extracted_accounts) allAccounts.push(...msg.extracted_accounts);
      if (msg.extracted_urls) allUrls.push(...msg.extracted_urls);
    });

    conversationResult.extracted_phones = [...new Set(allPhones)];
    conversationResult.extracted_accounts = [...new Set(allAccounts)];
    conversationResult.extracted_urls = [...new Set(allUrls)];

    // Step 4: Run CCID/Vertex checks if we have indicators
    let ccidResult = { found: false, reports: 0 };
    let vertexResult = { found: false, hits: 0, results: [] };
    const checkTarget = conversationResult.extracted_phones[0] || conversationResult.extracted_accounts[0];

    if (checkTarget) {
      try {
        const { checkSemakMule } = require('./semakmule');
        const { searchVertexAI } = require('./vertexSearch');
        const category = conversationResult.extracted_phones[0] ? 'phone' : 'bank';
        const [ccid, vertex] = await Promise.all([
          checkSemakMule(checkTarget, category),
          searchVertexAI(checkTarget),
        ]);
        ccidResult = ccid;
        vertexResult = vertex;

        if (ccidResult.found && conversationResult.risk_level === 'LOW') conversationResult.risk_level = 'MEDIUM';
        if (ccidResult.reports >= 3) conversationResult.risk_level = 'HIGH';
        if (vertexResult.found && conversationResult.risk_level === 'LOW') conversationResult.risk_level = 'MEDIUM';
        if (vertexResult.hits >= 3) conversationResult.risk_level = 'HIGH';
      } catch (err) {
        console.warn('[batch-web] CCID/Vertex check failed:', err.message);
      }
    }

    // Step 5: Build verdict
    const lang = detectLanguage(enrichedMessages.map(m => m.text).join(' '));
    const verdict = buildVerdict(conversationResult, ccidResult, lang, vertexResult);

    // Step 6: Log intelligence
    logScamIntelligence({
      scamType: conversationResult.scam_type,
      riskLevel: conversationResult.risk_level,
      phones: conversationResult.extracted_phones,
      accounts: conversationResult.extracted_accounts,
      urls: conversationResult.extracted_urls,
      confidence: conversationResult.confidence || 0,
    });

    // Step 7: Push alert to guardian if logged-in user has a guardian and it's HIGH/MEDIUM
    let alertSent = false;
    if (req.session?.userId &&
        (conversationResult.risk_level === 'HIGH' || conversationResult.risk_level === 'MEDIUM')) {
      try {
        const db  = getDb();
        const raw = db.exec(`SELECT guardian_id FROM web_accounts WHERE id = ${req.session.userId} LIMIT 1`);
        const gRows = raw && raw[0] && raw[0].values;
        if (gRows && gRows.length) {
          const guardianId = gRows[0][0];
          if (guardianId) {
            const snippet = enrichedMessages.map(m => m.text).join(' | ').slice(0, 120);
            db.run(
              `INSERT INTO family_alerts (guardian_id, elderly_id, elderly_name, risk_level, scam_type, snippet)
               VALUES (?, ?, ?, ?, ?, ?)`,
              [guardianId, req.session.userId, req.session.username,
               conversationResult.risk_level, conversationResult.scam_type || null, snippet]
            );
            pushAlertToGuardian(guardianId, {
              elderly: req.session.username,
              risk_level: conversationResult.risk_level,
              scam_type: conversationResult.scam_type || null,
              snippet,
              time: new Date().toISOString(),
            });
            alertSent = true;
            console.log(`[alert] Pushed alert to guardian ${guardianId} for user ${req.session.username}`);
          }
        }
      } catch (alertErr) { console.warn('[batch alert] error:', alertErr.message); }
    }

    console.log(`[batch-web] Result — risk: ${conversationResult.risk_level}, type: ${conversationResult.scam_type}`);

    res.json({
      verdict,
      risk_level: conversationResult.risk_level,
      scam_type: conversationResult.scam_type,
      alertSent: alertSent,
      confidence: conversationResult.confidence || 0,
      reason_bm: conversationResult.reason_bm,
      reason_en: conversationResult.reason_en,
      extracted_phones: conversationResult.extracted_phones,
      extracted_accounts: conversationResult.extracted_accounts,
      extracted_urls: conversationResult.extracted_urls,
      ccid: ccidResult,
      vertex: vertexResult,
      total_messages: messages.length,
      flow: 'web_batch_conversation',
    });
  } catch (err) {
    console.error('[analyse-batch] error:', err);
    res.status(500).json({
      error: 'Batch analysis failed',
      verdict: 'Sorry, batch analysis failed. Please try again.',
      risk_level: 'UNKNOWN',
    });
  }
});

// ── Web UI: Vertex AI Search API ────────────────────────────────────────────
app.post('/api/search', async (req, res) => {
  try {
    const { query } = req.body;
    if (!query || !query.trim()) {
      return res.status(400).json({ error: 'No query provided' });
    }

    const { searchVertexAI } = require('./vertexSearch');
    const result = await searchVertexAI(query.trim());
    res.json(result);
  } catch (err) {
    console.error('[search] error:', err);
    res.status(500).json({ error: 'Search failed', found: false, hits: 0, results: [] });
  }
});

// ── Health check ────────────────────────────────────────────────────────────
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    env: {
      gemini_configured: !!process.env.GEMINI_API_KEY,
      vt_configured: !!process.env.VIRUSTOTAL_API_KEY,
      vertex_ai_configured: !!process.env.VERTEX_PROJECT_ID && !!process.env.VERTEX_ENGINE_ID,
      whatsapp_web_ready: !!getClient(),
    },
  });
});

// ── Admin auth guard ─────────────────────────────────────────────────────────
function adminGuard(req, res, next) {
  const token = req.headers['x-admin-token'] || req.query.token;
  const expected = process.env.ADMIN_EXPORT_TOKEN;
  if (!expected) {
    return res.status(503).json({ error: 'Admin export not configured. Set ADMIN_EXPORT_TOKEN in .env' });
  }
  if (token !== expected) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
}

// ── Admin: Live intelligence stats ───────────────────────────────────────────
/**
 * GET /api/admin/stats
 * Returns aggregate scam totals for the dashboard tile and hackathon demo.
 * Headers: x-admin-token: <ADMIN_EXPORT_TOKEN>
 */
app.get('/api/admin/stats', adminGuard, (req, res) => {
  try {
    const { getScamStats } = require('./queries');
    res.json(getScamStats());
  } catch (err) {
    console.error('[admin/stats] error:', err);
    res.status(500).json({ error: 'Failed to get stats' });
  }
});

// ── Admin: CSV export for PDRM submission ────────────────────────────────────
/**
 * GET /api/admin/export?from=YYYY-MM-DD&to=YYYY-MM-DD
 * Downloads an anonymised CSV of scam intelligence logs.
 * No user phone numbers are included — only scammer indicators.
 * Headers: x-admin-token: <ADMIN_EXPORT_TOKEN>
 *
 * Column guide sent to PDRM:
 *   id              – internal log ID
 *   scam_type       – e.g. JOB_SCAM, MACAU_SCAM
 *   risk_level      – HIGH | MEDIUM
 *   indicator_phone – scammer phone extracted from reported message
 *   indicator_account – bank account extracted from reported message
 *   indicator_url   – URL extracted from reported message
 *   confidence      – AI confidence 0.0–1.0
 *   user_confirmed  – 1 if victim confirmed they experienced this scam
 *   created_at      – UTC timestamp of the report
 */
app.get('/api/admin/export', adminGuard, (req, res) => {
  try {
    const { getExportData } = require('./queries');
    const { from, to } = req.query;

    const rows = getExportData(from || null, to || null);

    // Build CSV
    const COLS = [
      'id', 'scam_type', 'risk_level',
      'indicator_phone', 'indicator_account', 'indicator_url',
      'confidence', 'user_confirmed', 'created_at',
    ];

    const escape = (v) => {
      if (v === null || v === undefined) return '';
      const s = String(v);
      return s.includes(',') || s.includes('"') || s.includes('\n')
        ? `"${s.replace(/"/g, '""')}"` : s;
    };

    const csvLines = [
      COLS.join(','),
      ...rows.map(r => COLS.map(c => escape(r[c])).join(',')),
    ];

    const filename = `safelah_scam_intel_${new Date().toISOString().slice(0, 10)}.csv`;
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(csvLines.join('\r\n'));

    console.log(`[admin/export] Exported ${rows.length} rows → ${filename}`);
  } catch (err) {
    console.error('[admin/export] error:', err);
    res.status(500).json({ error: 'Export failed' });
  }
});


// ── Start ───────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 8080;

// Start server IMMEDIATELY so Cloud Run health-check passes
const server = app.listen(PORT, '0.0.0.0', () => {
  console.log(`[server] Express listening on 0.0.0.0:${PORT}`);
});

// Setup startup timeout
const startupTimeout = setTimeout(() => {
  console.error('[server] Startup timeout - process exiting');
  process.exit(1);
}, 30000); // 30 second timeout

// Initialize background tasks after server starts
(async () => {
  try {
    console.log('[server] Initializing database...');
    await dbReady;
    console.log('[server] Database ready');

    // Auto-detect Cloud Run (K_SERVICE is always set) or honour SKIP_WHATSAPP
    const skipWA = process.env.SKIP_WHATSAPP === 'true' || !!process.env.K_SERVICE;

    // Initialize WhatsApp Web (skip on Cloud Run / when SKIP_WHATSAPP is set)
    if (skipWA) {
      console.log('[server] WhatsApp skipped — running Web UI only (Cloud Run / SKIP_WHATSAPP)');
    } else {
      console.log('[server] Initializing WhatsApp Web client...');
      try {
        const client = await initializeWhatsApp();

        // Set up message listener
        client.on('message_create', async (message) => {
          // Skip outgoing messages (messages sent by the bot)
          if (message.fromMe) return;

          // Handle incoming message
          try {
            await handleIncoming(message);
          } catch (err) {
            console.error('[message_listener] error:', err);
          }
        });
        console.log('📱 WhatsApp Bot: Listening for messages...');
      } catch (whatsappErr) {
        console.warn('[server] WhatsApp init failed (Web UI still works):', whatsappErr.message);
      }
    }

    // Clear timeout once fully initialized
    clearTimeout(startupTimeout);
    console.log('\n🛡️  SafeLah is fully initialized and ready!\n');

  } catch (err) {
    console.error('[server] Background initialization failed:', err.message);
    // Don't exit - server is already running with Web UI
  }
})();

// Handle uncaught errors
process.on('uncaughtException', (err) => {
  console.error('[server] Uncaught exception:', err);
});

process.on('unhandledRejection', (reason) => {
  console.error('[server] Unhandled rejection:', reason);
});

// ── Live Call Companion feature ──────────────────────────────────────────────
// NOTE: Cloud Run service must be deployed with --timeout=3600 for WebSocket
// sessions to survive long calls. Add this flag to your gcloud run deploy cmd.
// NOTE: getUserMedia() requires HTTPS. Cloud Run provides HTTPS by default.
const expressWs = require('express-ws')(app);
const { setupLiveCallWS } = require('./ws');
const { registerClient, removeClient } = require('./verdictBroadcaster');

// SSE endpoint — phone polls this to receive live verdicts
app.get('/api/live-verdict/:sessionId', (req, res) => {
  const { sessionId } = req.params;
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();
  registerClient(sessionId, res);
  req.on('close', () => removeClient(sessionId));
});

// Register WebSocket handler
setupLiveCallWS(app);
// ── End Live Call Companion ──────────────────────────────────────────────────
