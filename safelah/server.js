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

    // Reuse the same analysis function from handleIncoming
    const result = await require('./text').analyseText(from, text);

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

// ── Health check ────────────────────────────────────────────────────────────
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    env: {
      gemini_configured: !!process.env.GEMINI_API_KEY,
      vt_configured: !!process.env.VIRUSTOTAL_API_KEY,
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
 *   state_estimate  – approximate state of the VICTIM (from phone prefix)
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
      'state_estimate', 'confidence', 'user_confirmed', 'created_at',
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

    // Initialize WhatsApp Web
    console.log('[server] Initializing WhatsApp Web client...');
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

    // Start Express server for web UI
    app.listen(PORT, () => {
      console.log(`\n🛡️  SelamatLah is running at http://localhost:${PORT}`);
      console.log(`📱 WhatsApp Bot: Listening for messages...`);
      console.log(`🌐 Web UI: http://localhost:${PORT}\n`);
    });
  } catch (err) {
    console.error('[server] Initialization failed:', err);
    process.exit(1);
  }
})();
