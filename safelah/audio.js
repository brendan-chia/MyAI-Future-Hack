const { analyseAudioWithGemini }  = require('./gemini');
const { sendMessage, downloadMedia } = require('./whatsapp');
const { buildVerdict }            = require('./verdictBuilder');
const { runScamDetectionFlow }    = require('./text');
const { detectLanguage }          = require('./language');
const { notifyGuardians }         = require('./guardian');
const { logScamIntelligence }     = require('./queries');

async function analyseAudio(from, message) {
  try {
    console.log(`[audio] Processing audio from ${from}, type: ${message.type}`);

    // ── Download audio ──────────────────────────────────────────────────
    const mediaResult = await downloadMedia(message);
    if (!mediaResult) {
      await sendMessage(from,
        'Sorry, could not download this audio. Please try again or send the text message instead. 🙏'
      );
      return;
    }

    const base64Audio = mediaResult.data.toString('base64');
    const mime = mediaResult.mimetype || 'audio/ogg';
    console.log(`[audio] Downloaded - mime: ${mime}, size: ${base64Audio.length} chars`);

    // ── Stage 1: Transcribe audio ───────────────────────────────────────
    console.log(`[audio] Stage 1 — Transcribing audio...`);
    const extraction = await analyseAudioWithGemini(base64Audio, mime);

    if (!extraction || !extraction.extracted_text) {
      await sendMessage(from,
        'Sorry, could not transcribe this audio.\n\nPlease send the text message instead for review. 🙏'
      );
      return;
    }

    console.log(`[audio] Stage 1 complete — transcribed ${extraction.extracted_text.length} chars`);

    // ── Stage 2: Deep scam analysis (same pipeline as text + image) ─────
    console.log(`[audio] Stage 2 — Deep scam analysis on transcript...`);

    const text = extraction.extracted_text;
    const lang = detectLanguage(text);

    const result = await runScamDetectionFlow({
      text,
      phone: from,
      visualContext: extraction.visual_cues || '',      // audio cues go here
      preExtractedPhones:   extraction.phones   || [],
      preExtractedAccounts: extraction.accounts || [],
      preExtractedUrls:     extraction.urls     || [],
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
      scamType:    result.scam_type,
      riskLevel:   result.risk_level,
      callerPhone: from,
      phones:      result.extracted_phones   || [],
      accounts:    result.extracted_accounts || [],
      urls:        result.extracted_urls     || [],
      confidence:  result.confidence         || 0,
    });

    console.log(`[audio] ${from} → risk: ${result.risk_level}, type: ${result.scam_type}`);

  } catch (err) {
    console.error('[audio] handler error:', err.message);
    await sendMessage(from,
      'Sorry, could not process this audio. Please try again or send the text message instead.'
    );
  }
}

module.exports = { analyseAudio };