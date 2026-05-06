/**
 * routes/videoRoutes.js
 * Video analysis endpoints — NEW FILE, does not modify server.js
 *
 * Endpoints:
 *   POST /api/video/analyze        — Mode A: single video (multipart OR JSON url)
 *   POST /api/video/analyze-batch  — Mode B: URL-only batch (JSON)
 *
 * Cloud Run note:
 *   Cloud Run enforces a 32 MB HTTP request body limit for JSON.
 *   File uploads MUST use multipart/form-data — files are streamed to /tmp.
 *   URL mode is always JSON and is not affected by this limit.
 */

'use strict';

const express  = require('express');
const router   = express.Router();
const crypto   = require('crypto');
const fs       = require('fs');
const path     = require('path');
const os       = require('os');
const busboy   = require('busboy');
const { analyseVideo } = require('../services/videoAnalysis');

// ── Concurrency semaphore ─────────────────────────────────────────────────────
const BATCH_CONCURRENCY = 5;

function createSemaphore(limit) {
  let active = 0;
  const queue = [];
  return function acquire() {
    return new Promise(resolve => {
      const tryRun = () => {
        if (active < limit) { active++; resolve(() => { active--; if (queue.length) queue.shift()(); }); }
        else queue.push(tryRun);
      };
      tryRun();
    });
  };
}

// ── Multipart stream helper ───────────────────────────────────────────────────
/**
 * Parse a multipart/form-data request.
 * Streams the 'video' file field directly to a temp file — no base64, no memory spike.
 * Cloud Run /tmp allows up to 512 MB.
 */
function parseMultipart(req) {
  return new Promise((resolve, reject) => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'safelah-up-'));
    let filePath = null;
    let originalName = 'video.mp4';
    const fields = {};

    const bb = busboy({
      headers: req.headers,
      limits: { fileSize: 512 * 1024 * 1024 }, // 512 MB
    });

    bb.on('file', (fieldname, stream, info) => {
      originalName = info.filename || 'video.mp4';
      const ext    = path.extname(originalName).toLowerCase() || '.mp4';
      filePath     = path.join(tmpDir, crypto.randomUUID() + ext);
      const out    = fs.createWriteStream(filePath);
      stream.pipe(out);
      out.on('error', reject);
      stream.on('error', reject);
    });

    bb.on('field', (name, val) => { fields[name] = val; });
    bb.on('finish', () => resolve({ filePath, originalName, tmpDir, fields }));
    bb.on('error', reject);

    req.pipe(bb);
  });
}

// ── Mode A: Single video analysis ─────────────────────────────────────────────
/**
 * POST /api/video/analyze
 *
 * File uploads  → multipart/form-data, field name: 'video'
 * URL analysis  → application/json { source:'url', value:'<url>' }
 */
router.post('/analyze', async (req, res) => {
  const ct = (req.headers['content-type'] || '').toLowerCase();

  try {
    let item;

    if (ct.includes('multipart/form-data')) {
      // ── Multipart — Cloud Run safe (streams to /tmp, no 32 MB limit) ────
      const { filePath, originalName, tmpDir } = await parseMultipart(req);

      if (!filePath) {
        return res.status(400).json({ success: false, error: 'No video file received in multipart upload.' });
      }

      console.log(`[videoRoutes] Multipart upload — file=${originalName}`);
      // 'localfile' source tells videoAnalysis to skip base64 decode
      item = { source: 'localfile', localPath: filePath, originalName, tmpDir };

    } else {
      // ── JSON — for URL mode (and base64 only in local dev) ──────────────
      const { source, value, originalName } = req.body;

      if (!source || !value) {
        return res.status(400).json({
          success: false,
          error: 'For file uploads use multipart/form-data. For URLs: { source:"url", value:"<url>" }',
        });
      }

      if (source === 'file') {
        console.warn('[videoRoutes] base64 JSON file upload — will fail on Cloud Run if file >32 MB');
      }

      item = { source, value, originalName };
    }

    const result = await analyseVideo(item);
    return res.json(result);

  } catch (err) {
    console.error('[videoRoutes /analyze] error:', err.message);
    return res.status(500).json({
      success:            false,
      error:              err.message || 'Video analysis failed',
      final_verdict:      'SAFE',
      final_risk_score:   0,
      primary_threat:     'NONE',
      final_explanation:  'An unexpected error occurred during analysis.',
      recommended_action: 'Please try again.',
    });
  }
});

// ── Mode B: Batch video analysis ──────────────────────────────────────────────
/**
 * POST /api/video/analyze-batch
 * Body: { items: [ { id, source:'url', value:'<url>' } ] }
 *
 * Cloud Run: use source:'url' for all items.
 * For file batches locally, base64 in value is supported.
 */
router.post('/analyze-batch', async (req, res) => {
  try {
    const { items } = req.body;

    if (!items || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ success: false, error: 'items must be a non-empty array' });
    }

    for (const item of items) {
      if (!item.id || !item.source || !item.value) {
        return res.status(400).json({
          success: false,
          error: 'Each item must have id, source, and value fields',
        });
      }
    }

    const batchId = crypto.randomUUID();
    const acquire = createSemaphore(BATCH_CONCURRENCY);

    console.log(`[videoRoutes] Batch — batchId=${batchId}, items=${items.length}`);

    const results = await Promise.all(items.map(async (item) => {
      const release = await acquire();
      try {
        const analysis = await analyseVideo(item);
        return { id: item.id, ...analysis };
      } catch (err) {
        return {
          id:                 item.id,
          success:            false,
          error:              err.message,
          final_verdict:      'SAFE',
          final_risk_score:   0,
          primary_threat:     'NONE',
          final_explanation:  `Failed: ${err.message}`,
          recommended_action: 'Skip or retry.',
        };
      } finally {
        release();
      }
    }));

    console.log(`[videoRoutes] Batch done — batchId=${batchId}`);
    return res.json({ success: true, batch_id: batchId, results });

  } catch (err) {
    console.error('[videoRoutes /analyze-batch] error:', err.message);
    return res.status(500).json({ success: false, error: err.message, batch_id: null, results: [] });
  }
});

module.exports = router;
