const { extractTextFromImage, analyseImageWithGemini } = require('./gemini');
const { sendMessage, downloadMedia } = require('../whatsapp');
const { buildVerdict }       = require('../verdictBuilder');
const { runScamDetectionFlow } = require('./text');
const { detectLanguage }     = require('../language');
const { notifyGuardians }    = require('./guardian');
const { logScamIntelligence } = require('../queries');

/**
 * Two-stage image analysis:
 *   Stage 1 — Gemini Vision extracts text + visual cues from the screenshot
 *   Stage 2 — Extracted text goes through the SAME deep scam analysis pipeline
 *             that text messages use (Gemini NLP + CCID + VirusTotal)
 *
 * @param {string} from      — plain phone number (e.g. "60123456789")
 * @param {object} message   — whatsapp-web.js message object
 */
async function analyseImage(from, message) {
  try {
    // ── Download image ──────────────────────────────────────────────────
    console.log(`[image] Processing image from ${from}, msgType: ${message.type}, hasMedia: ${message.hasMedia}`);
    const mediaResult = await downloadMedia(message);

    if (!mediaResult) {
      console.error(`[image] Download failed for ${from}`);
      await sendMessage(from,
        'Sorry, could not download this image. Please try again or send the text message instead. 🙏'
      );
      return;
    }

    const base64Image = mediaResult.data.toString('base64');
    const mime = mediaResult.mimetype || 'image/jpeg';
    console.log(`[image] Image downloaded - mime: ${mime}, size: ${base64Image.length} chars (base64)`);

    // ── Stage 1: Extract text + visual cues from image ──────────────────
    console.log(`[image] Stage 1 — Extracting text & visual cues...`);
    const extraction = await extractTextFromImage(base64Image, mime);

    if (!extraction || !extraction.extracted_text) {
      // Fallback: use legacy single-pass analysis if extraction fails
      console.warn(`[image] Stage 1 extraction failed, falling back to single-pass analysis`);
      const fallbackResult = await analyseImageWithGemini(base64Image, mime);
      if (!fallbackResult) {
        await sendMessage(from,
          'Sorry, could not analyze this image right now.\n\nPlease send the text message for review, or try again shortly. 🙏'
        );
        return;
      }
      const verdictMsg = buildVerdict(fallbackResult, { found: false, reports: 0 }, 'en');
      await sendMessage(from, verdictMsg);
      if (fallbackResult.risk_level === 'HIGH') await notifyGuardians(from, fallbackResult.scam_type);
      logScamIntelligence({
        scamType:   fallbackResult.scam_type,
        riskLevel:  fallbackResult.risk_level,
        callerPhone: from,
        phones:     fallbackResult.extracted_phones   || [],
        accounts:   fallbackResult.extracted_accounts || [],
        urls:       fallbackResult.extracted_urls     || [],
        confidence: fallbackResult.confidence         || 0,
      });
      console.log(`[image-fallback] ${from} → risk: ${fallbackResult.risk_level}, type: ${fallbackResult.scam_type}`);
      return;
    }

    console.log(`[image] Stage 1 complete — extracted ${extraction.extracted_text.length} chars`);
    console.log(`[image]   phones: ${JSON.stringify(extraction.phones)}`);
    console.log(`[image]   accounts: ${JSON.stringify(extraction.accounts)}`);
    console.log(`[image]   urls: ${JSON.stringify(extraction.urls)}`);
    console.log(`[image]   visual_cues: ${extraction.visual_cues?.substring(0, 120)}...`);

    // ── Stage 2: Deep scam analysis (same pipeline as text messages) ─────
    console.log(`[image] Stage 2 — Deep scam analysis on extracted text...`);

    const text = extraction.extracted_text;
    const lang = detectLanguage(text);

    const result = await runScamDetectionFlow({
      text,
      phone: from,
      visualContext: extraction.visual_cues || '',
      preExtractedPhones: extraction.phones || [],
      preExtractedAccounts: extraction.accounts || [],
      preExtractedUrls: extraction.urls || [],
    });
    const ccidResult = result.ccidResult || { found: false, reports: 0 };

    // ── Send verdict ────────────────────────────────────────────────────
    const verdictMsg = buildVerdict(result, ccidResult, lang);
    await sendMessage(from, verdictMsg);

    // ── Notify guardians if HIGH ────────────────────────────────────────
    if (result.risk_level === 'HIGH') {
      await notifyGuardians(from, result.scam_type);
    }

    logScamIntelligence({
      scamType:   result.scam_type,
      riskLevel:  result.risk_level,
      callerPhone: from,
      phones:     result.extracted_phones   || [],
      accounts:   result.extracted_accounts || [],
      urls:       result.extracted_urls     || [],
      confidence: result.confidence         || 0,
    });
    console.log(`[image] ${from} → risk: ${result.risk_level}, type: ${result.scam_type}, source: 2-stage`);
  } catch (err) {
    console.error('[image] handler error:', err.message);
    console.error('[image] Stack:', err.stack);
    await sendMessage(from,
      'Sorry, could not process this image. Please try again or send the text message instead.'
    );
  }
}

/**
 * Analyse image directly for web API (not from WhatsApp)
 * Also uses the two-stage pipeline.
 *
 * @param {string} base64Data — base64 encoded image
 * @param {string} mimeType   — MIME type
 */
async function analyseImageDirect(base64Data, mimeType) {
  try {
    // Stage 1: Extract
    const extraction = await extractTextFromImage(base64Data, mimeType);

    if (!extraction || !extraction.extracted_text) {
      // Fallback to legacy single-pass
      const fallbackResult = await analyseImageWithGemini(base64Data, mimeType);
      if (!fallbackResult) {
        return {
          verdict: 'Sorry, could not analyze this image right now.\n\nPlease paste the text message instead.',
          risk_level: 'UNKNOWN',
        };
      }
      const verdictMsg = buildVerdict(fallbackResult, { found: false, reports: 0 }, 'en');
      logScamIntelligence({
        scamType:   fallbackResult.scam_type,
        riskLevel:  fallbackResult.risk_level,
        phones:     fallbackResult.extracted_phones   || [],
        accounts:   fallbackResult.extracted_accounts || [],
        urls:       fallbackResult.extracted_urls     || [],
        confidence: fallbackResult.confidence         || 0,
      });
      return { verdict: verdictMsg, risk_level: fallbackResult.risk_level, scam_type: fallbackResult.scam_type };
    }

    // Stage 2: Deep analysis
    const text = extraction.extracted_text;
    const result = await runScamDetectionFlow({
      text,
      phone: 'web-upload',
      visualContext: extraction.visual_cues || '',
      preExtractedPhones: extraction.phones || [],
      preExtractedAccounts: extraction.accounts || [],
      preExtractedUrls: extraction.urls || [],
    });
    const ccidResult = result.ccidResult || { found: false, reports: 0 };

    const verdictMsg = buildVerdict(result, ccidResult, detectLanguage(text));
    logScamIntelligence({
      scamType:   result.scam_type,
      riskLevel:  result.risk_level,
      phones:     result.extracted_phones   || [],
      accounts:   result.extracted_accounts || [],
      urls:       result.extracted_urls     || [],
      confidence: result.confidence         || 0,
    });

    return {
      verdict: verdictMsg,
      risk_level: result.risk_level,
      scam_type: result.scam_type,
      confidence: result.confidence || 0,
      reason_bm: result.reason_bm,
      reason_en: result.reason_en,
      extracted_phones: result.extracted_phones || [],
      extracted_accounts: result.extracted_accounts || [],
      extracted_urls: result.extracted_urls || [],
      ccid: ccidResult,
      vertex: result.vertexResult || { found: false, hits: 0, results: [] },
      flow: 'genkit_scamDetectionFlow_image_stage2',
    };
  } catch (err) {
    console.error('[image_direct] error:', err);
    return {
      verdict: 'Sorry, could not process this image.',
      risk_level: 'UNKNOWN',
    };
  }
}

module.exports = { analyseImage, analyseImageDirect };
