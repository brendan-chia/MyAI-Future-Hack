require('dotenv').config();
const express = require('express');
const path = require('path');
const { dbReady } = require('./connection');
const { handleIncoming } = require('./message');
const { initializeWhatsApp, getClient } = require('./whatsapp');

const app = express();

// Middleware
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: false }));
app.use(express.static(path.join(__dirname, 'public')));

// ── Web UI: Text analysis API ───────────────────────────────────────────────
app.post('/api/analyse', async (req, res) => {
  try {
    const { text, sessionId } = req.body;
    if (!text || !text.trim()) {
      return res.status(400).json({ error: 'No text provided' });
    }

    // Use sessionId or default to 'web-user'
    const from = sessionId || 'web-user';

    // Web-safe pipeline: returns full verdict + flow metadata without WhatsApp side effects
    const { analyseTextDirect } = require('./text');
    const result = await analyseTextDirect(from, text);

    res.json(result);
  } catch (err) {
    console.error('[analyse] error:', err);
    res.status(500).json({
      error: 'Analysis failed',
      verdict: 'Maaf, semakan tidak tersedia sekarang.\n\n❌ Jangan transfer wang kepada orang tidak dikenali\n❌ Jangan klik pautan dalam mesej tidak dikenali\n\nHotline Anti-Scam: 997',
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

    res.json(result);
  } catch (err) {
    console.error('[analyse-image] error:', err);
    res.status(500).json({ error: 'Image analysis failed', risk_level: 'UNKNOWN' });
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

    const filename = `selamatlah_scam_intel_${new Date().toISOString().slice(0, 10)}.csv`;
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
const PORT = process.env.PORT || 3000;

(async () => {
  try {
    // Wait for database to be ready
    await dbReady;

    // Initialize WhatsApp Web (skip on Cloud Run / when SKIP_WHATSAPP is set)
    if (process.env.SKIP_WHATSAPP === 'true') {
      console.log('[server] SKIP_WHATSAPP=true — running Web UI only (no WhatsApp bot)');
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

    // Start Express server for web UI
    app.listen(PORT, () => {
      console.log(`\n🛡️  SafeLah is running at http://localhost:${PORT}`);
      console.log(`🌐 Web UI: http://localhost:${PORT}\n`);
    });
  } catch (err) {
    console.error('[server] Initialization failed:', err);
    process.exit(1);
  }
})();
