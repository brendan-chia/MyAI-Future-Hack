const { analyseWithGemini }  = require('./gemini');
const { checkSemakMule }     = require('../external integration/semakmule');
const { searchVertexAI }     = require('./vertexSearch');
const { scanUrl }            = require('../external integration/virustotal');
const { sendMessage }        = require('../whatsapp');
const { keywordAnalyse }     = require('../keywordFallback');
const { buildVerdict }       = require('../verdictBuilder');
const { extractEntities }    = require('../extractor');
const { detectLanguage }     = require('../language');
const { notifyGuardians }    = require('../guardian');
const { logScamIntelligence } = require('../queries');
const { ai }                = require('./gemini');
const { z }                 = require('zod');

function uniqueStrings(values = []) {
  return [...new Set((Array.isArray(values) ? values : []).filter(v => typeof v === 'string' && v.trim()))];
}

function normalizeFlowResult(raw = {}, fallbackEntities = {}) {
  const safe = { ...raw };
  const allowedRisk = ['HIGH', 'MEDIUM', 'LOW'];

  safe.risk_level = allowedRisk.includes(safe.risk_level) ? safe.risk_level : 'LOW';
  safe.scam_type = safe.scam_type ?? null;
  safe.confidence = Number.isFinite(Number(safe.confidence)) ? Number(safe.confidence) : 0.6;
  safe.reason_bm = typeof safe.reason_bm === 'string' && safe.reason_bm.trim()
    ? safe.reason_bm
    : 'Tiada tanda-tanda penipuan jelas ditemui.';
  safe.reason_en = typeof safe.reason_en === 'string' && safe.reason_en.trim()
    ? safe.reason_en
    : 'No clear scam indicators found.';

  safe.extracted_phones = Array.isArray(safe.extracted_phones)
    ? safe.extracted_phones
    : (fallbackEntities.phones || []);
  safe.extracted_accounts = Array.isArray(safe.extracted_accounts)
    ? safe.extracted_accounts
    : (fallbackEntities.accounts || []);
  safe.extracted_urls = Array.isArray(safe.extracted_urls)
    ? safe.extracted_urls
    : (fallbackEntities.urls || []);

  return safe;
}

/**
 * Analyze text for scams
 * @param {string} from - phone number
 * @param {string} text - message text
 * @param {boolean} batchMode - if true, don't send verdict automatically or notify guardians
 * @returns {object} analysis result
 */
// ── Genkit flow: wraps layers 1–4 of the analysis pipeline ──────────────────
const scamDetectionFlow = ai.defineFlow(
  {
    name: 'scamDetectionFlow',
    inputSchema: z.object({
      text:      z.string(),
      phone:     z.string(),
      visual_context: z.string().optional(),
      pre_extracted_phones: z.array(z.string()).optional(),
      pre_extracted_accounts: z.array(z.string()).optional(),
      pre_extracted_urls: z.array(z.string()).optional(),
    }),
    outputSchema: z.object({
      risk_level:         z.enum(['HIGH', 'MEDIUM', 'LOW']),
      scam_type:          z.string().nullable().optional(),
      confidence:         z.coerce.number(),
      reason_bm:          z.string(),
      reason_en:          z.string(),
      extracted_phones:   z.array(z.string()),
      extracted_accounts: z.array(z.string()),
      extracted_urls:     z.array(z.string()),
      source:             z.string().optional(),
      ccidResult:         z.any().optional(),
      vertexResult:       z.any().optional(),
    }),
  },
  async ({ text, phone, visual_context = '', pre_extracted_phones = [], pre_extracted_accounts = [], pre_extracted_urls = [] }) => {

    // Layer 1 — pre-filter (keyword + entity extraction, free, offline)
    const extracted = extractEntities(text);
    const phones = uniqueStrings([...(extracted.phones || []), ...pre_extracted_phones]);
    const accounts = uniqueStrings([...(extracted.accounts || []), ...pre_extracted_accounts]);
    const urls = uniqueStrings([...(extracted.urls || []), ...pre_extracted_urls]);

    // Layer 2 — short-circuit: if keyword fallback catches obvious HIGH, skip Gemini
    const quickCheck = keywordAnalyse(text);
    if (quickCheck.risk_level === 'HIGH' && quickCheck.source === 'keyword_fallback') {
      quickCheck.extracted_phones   = phones;
      quickCheck.extracted_accounts = accounts;
      quickCheck.extracted_urls     = urls;
      quickCheck.ccidResult         = { found: false, reports: 0 };
      return normalizeFlowResult(quickCheck, { phones, accounts, urls });
    }

    // Layer 3 — Gemini AI analysis (only runs if layer 1 is inconclusive)
    let result = await analyseWithGemini(text, visual_context);

    if (!result) {
      // Gemini unavailable — fall back to keyword result
      console.warn('[flow] Gemini unavailable, using keyword fallback');
      result = quickCheck;
      result.extracted_phones   = phones;
      result.extracted_accounts = accounts;
      result.extracted_urls     = urls;
    }

    result = normalizeFlowResult(result, { phones, accounts, urls });

    // Layer 4 — aggregate signals: CCID Semak Mule + Vertex AI Search + VirusTotal
    let ccidResult   = { found: false, reports: 0 };
    let vertexResult = { found: false, hits: 0, results: [] };
    const checkTarget = (result.extracted_phones[0] || phones[0]) ||
                        (result.extracted_accounts[0] || accounts[0]);

    if (checkTarget) {
      const category = (result.extracted_phones[0] || phones[0]) ? 'phone' : 'bank';

      // Run CCID + Vertex AI Search in parallel for speed
      const [ccid, vertex] = await Promise.all([
        checkSemakMule(checkTarget, category),
        searchVertexAI(checkTarget),
      ]);
      ccidResult   = ccid;
      vertexResult = vertex;

      // CCID escalation
      if (ccidResult.found && result.risk_level === 'LOW') result.risk_level = 'MEDIUM';
      if (ccidResult.reports >= 3)                         result.risk_level = 'HIGH';

      // Vertex AI Search escalation
      if (vertexResult.found && result.risk_level === 'LOW') result.risk_level = 'MEDIUM';
      if (vertexResult.hits >= 3)                            result.risk_level = 'HIGH';
    }

    const urlToScan = result.extracted_urls[0] || urls[0];
    if (urlToScan) {
      // Also search Vertex AI for the URL
      const [vtResult, vtxUrl] = await Promise.all([
        scanUrl(urlToScan),
        searchVertexAI(urlToScan),
      ]);
      if (vtResult?.is_malicious) {
        result.risk_level = 'HIGH';
        result.scam_type  = result.scam_type || 'PHISHING_LINK';
      }
      // Merge Vertex URL results
      if (vtxUrl.found && !vertexResult.found) {
        vertexResult = vtxUrl;
        if (result.risk_level === 'LOW') result.risk_level = 'MEDIUM';
      }
    }

    result.ccidResult   = ccidResult;
    result.vertexResult = vertexResult;
    return result;
  }
);

async function runScamDetectionFlow({ text, phone, visualContext = '', preExtractedPhones = [], preExtractedAccounts = [], preExtractedUrls = [] }) {
  return scamDetectionFlow({
    text,
    phone,
    visual_context: visualContext,
    pre_extracted_phones: preExtractedPhones,
    pre_extracted_accounts: preExtractedAccounts,
    pre_extracted_urls: preExtractedUrls,
  });
}

async function analyseTextDirect(sessionId, text, forceLang = null) {
  const lang = forceLang || detectLanguage(text);
  const result = await runScamDetectionFlow({
    text,
    phone: sessionId || 'web-user',
  });
  const ccidResult = result.ccidResult || { found: false, reports: 0 };
  const vertexResult = result.vertexResult || { found: false, hits: 0, results: [] };
  const verdict = buildVerdict(result, ccidResult, lang, vertexResult);

  logScamIntelligence({
    scamType: result.scam_type,
    riskLevel: result.risk_level,
    phones: result.extracted_phones || [],
    accounts: result.extracted_accounts || [],
    urls: result.extracted_urls || [],
    confidence: result.confidence || 0,
  });

  return {
    verdict,
    risk_level: result.risk_level,
    scam_type: result.scam_type,
    confidence: result.confidence || 0,
    reason_bm: result.reason_bm,
    reason_en: result.reason_en,
    extracted_phones: result.extracted_phones || [],
    extracted_accounts: result.extracted_accounts || [],
    extracted_urls: result.extracted_urls || [],
    ccid: ccidResult,
    vertex: vertexResult,
    flow: 'genkit_scamDetectionFlow',
  };
}

  async function analyseText(from, text, batchMode = false, forceLang = null) {
  const lang  = forceLang || detectLanguage(text);
  const phone = from;

  // ── Run the Genkit flow (layers 1–4) ──────────────────────────────────────
  const result = await runScamDetectionFlow({ text, phone });
  const ccidResult = result.ccidResult || { found: false, reports: 0 };

  // ── Everything below is unchanged from your original code ─────────────────

  if (batchMode) {
    console.log(`[text-batch] ${phone} → risk: ${result.risk_level}, type: ${result.scam_type}, source: ${result.source || 'gemini'}`);
    return result;
  }

  // Send verdict to user
  const verdictMsg = buildVerdict(result, ccidResult, lang);
  await sendMessage(from, verdictMsg);

  // Notify guardians if HIGH risk
  if (result.risk_level === 'HIGH') {
    await notifyGuardians(phone, result.scam_type);
  }

  // Log enriched intelligence
  logScamIntelligence({
    scamType:    result.scam_type,
    riskLevel:   result.risk_level,
    callerPhone: phone,
    phones:      result.extracted_phones   || [],
    accounts:    result.extracted_accounts || [],
    urls:        result.extracted_urls     || [],
    confidence:  result.confidence         || 0,
  });

  console.log(`[text] ${phone} → risk: ${result.risk_level}, type: ${result.scam_type}, source: ${result.source || 'gemini'}`);
  return result;
}

module.exports = { analyseText, analyseTextDirect, runScamDetectionFlow };
