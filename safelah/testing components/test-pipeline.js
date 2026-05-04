require('dotenv').config();
const { analyseWithGemini }  = require('../src/services/gemini');
const { keywordAnalyse }     = require('../src/utils/keywordFallback');
const { buildVerdict }       = require('../src/utils/verdictBuilder');
const { extractEntities }    = require('../src/utils/extractor');
const { detectLanguage }     = require('../src/utils/language');

// Runs the full analysis pipeline and prints what the user would receive
// Does NOT send to WhatsApp — safe to run anytime

const DEMO_MESSAGES = [
  `Ini panggilan daripada PDRM Bukit Aman. Akaun bank anda nombor 1234567890123 telah dikenal pasti terlibat dalam kes pengubahan wang haram. Anda perlu hadir ke balai polis ATAU transfer RM10,000 ke akaun selamat kami dalam masa 24 jam. Hubungi Sarjan Ahmad: 0123456789`,

  `Tahniah! No telefon anda 0198765432 telah dipilih dalam cabutan bertuah Touch 'n Go. Anda memenangi RM6,888! Tuntut hadiah anda sebelum 11:59 malam ini: http://touchngo-prize.xyz/claim`,

  `Kerja Part Time dari rumah! Hanya like & komen di Facebook, dapat RM80-RM350 sehari. No experience needed. DM saya sekarang atau WhatsApp: 0187654321`,

  `Eh boleh tolong tengokkan mesej ni? Dia kata dia dari bank kata akaun saya kena freeze sebab suspicious activity. Dia minta saya bagi TAC number untuk 'verify'`,

  `Jom makan nasi lemak esok pagi? Kedai dekat office bukak pukul 7.`,
];

async function run() {
  console.log('=== SafeLah — Full Pipeline Test (No WhatsApp) ===\n');

  for (let i = 0; i < DEMO_MESSAGES.length; i++) {
    const text = DEMO_MESSAGES[i];
    const lang = detectLanguage(text);
    const { phones, accounts, urls } = extractEntities(text);

    console.log(`─── Message ${i + 1} ───────────────────────────────────────`);
    console.log(`Text: "${text.substring(0, 80)}..."`);
    console.log(`Detected language: ${lang}`);
    console.log(`Extracted — phones: [${phones}], accounts: [${accounts}], urls: [${urls}]`);

    // Try Gemini first, fall back to keywords
    let result = await analyseWithGemini(text);
    if (!result) {
      console.log('⚠️  Gemini unavailable — using keyword fallback');
      result = keywordAnalyse(text);
    }

    console.log(`Analysis — risk: ${result.risk_level}, type: ${result.scam_type}, confidence: ${result.confidence}`);
    console.log(`Reason (BM): ${result.reason_bm}`);

    const verdict = buildVerdict(result, { found: false, reports: 0 }, lang);
    console.log('\n--- USER WOULD RECEIVE ---');
    console.log(verdict);
    console.log('\n');

    await new Promise(r => setTimeout(r, 2000)); // rate limit pause
  }

  console.log('✅ Pipeline test complete.');
}

run().catch(console.error);
