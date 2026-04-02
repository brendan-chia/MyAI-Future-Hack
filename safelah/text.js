const { analyseWithGemini }  = require('./gemini');
const { checkSemakMule }     = require('./semakmule');
const { scanUrl }            = require('./virustotal');
const { sendMessage }        = require('./whatsapp');
const { keywordAnalyse }     = require('./keywordFallback');
const { buildVerdict }       = require('./verdictBuilder');
const { extractEntities }    = require('./extractor');
const { detectLanguage }     = require('./language');
const { notifyGuardians }    = require('./guardian');
const { logScamIntelligence } = require('./queries');

/**
 * Analyze text for scams
 * @param {string} from - phone number
 * @param {string} text - message text
 * @param {boolean} batchMode - if true, don't send verdict automatically or notify guardians
 * @returns {object} analysis result
 */
async function analyseText(from, text, batchMode = false, forceLang = null) {
  const lang = forceLang || detectLanguage(text);
  // from is already a plain phone number (e.g. "60123456789")
  const phone = from;

  // 1. Extract entities from message
  const { phones, accounts, urls } = extractEntities(text);

  // 2. Gemini AI analysis (primary)
  let result = await analyseWithGemini(text);

  // 3. Keyword fallback if Gemini unavailable
  if (!result) {
    console.warn('[text] Gemini unavailable, using keyword fallback');
    result = keywordAnalyse(text);
    // Merge any entities Gemini would have extracted
    result.extracted_phones   = phones;
    result.extracted_accounts = accounts;
    result.extracted_urls     = urls;
  }

  // 4. CCID Semak Mule — check extracted phone/bank numbers
  let ccidResult = { found: false, reports: 0 };
  const checkTarget = (result.extracted_phones[0] || phones[0]) ||
                      (result.extracted_accounts[0] || accounts[0]);
  if (checkTarget) {
    const category = (result.extracted_phones[0] || phones[0]) ? 'phone' : 'bank';
    ccidResult = await checkSemakMule(checkTarget, category);
    if (ccidResult.found && result.risk_level === 'LOW')  result.risk_level = 'MEDIUM';
    if (ccidResult.reports >= 3)                          result.risk_level = 'HIGH';
  }

  // 5. VirusTotal — scan any URLs found
  const urlToScan = (result.extracted_urls[0] || urls[0]);
  if (urlToScan) {
    const vtResult = await scanUrl(urlToScan);
    if (vtResult?.is_malicious) {
      result.risk_level = 'HIGH';
      result.scam_type  = result.scam_type || 'PHISHING_LINK';
    }
  }

  // Store CCID result in result object for batch processing
  result.ccidResult = ccidResult;

  // In batch mode, don't send verdict or notify yet - just return for batch processing
  if (batchMode) {
    console.log(`[text-batch] ${phone} → risk: ${result.risk_level}, type: ${result.scam_type}, source: ${result.source || 'gemini'}`);
    return result;
  }

  // 6. Send verdict to user (normal mode only)
  const verdictMsg = buildVerdict(result, ccidResult, lang);
  await sendMessage(from, verdictMsg);

  // 7. Notify guardians if HIGH risk (normal mode only)
  if (result.risk_level === 'HIGH') {
    await notifyGuardians(phone, result.scam_type);
  }

  // 8. Log enriched intelligence (anonymised — caller phone used ONLY for state estimate)
  logScamIntelligence({
    scamType:    result.scam_type,
    riskLevel:   result.risk_level,
    callerPhone: phone,
    phones:      result.extracted_phones   || phones,
    accounts:    result.extracted_accounts || accounts,
    urls:        result.extracted_urls     || urls,
    confidence:  result.confidence         || 0,
  });

  console.log(`[text] ${phone} → risk: ${result.risk_level}, type: ${result.scam_type}, source: ${result.source || 'gemini'}`);
  
  return result;
}

module.exports = { analyseText };
