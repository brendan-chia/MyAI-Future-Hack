require('dotenv').config();
const { analyseWithGemini, analyseImageWithGemini } = require('../src/services/gemini');

const TEST_MESSAGES = [
  {
    label: 'Macau Scam (BM)',
    text: 'Ini adalah panggilan daripada Polis DiRaja Malaysia. Akaun bank anda telah digunakan untuk aktiviti pengubahan wang haram. Anda perlu transfer RM5000 ke akaun selamat kami dalam masa 24 jam atau anda akan ditangkap. Hubungi 0123456789 segera.',
    expected: 'HIGH',
  },
  {
    label: 'Lucky Draw Scam',
    text: 'Tahniah! Anda telah dipilih sebagai pemenang cabutan bertuah Shopee. Hadiah RM8,888 menanti anda. Klik pautan ini untuk tuntut hadiah: http://shopee-lucky.xyz/claim?id=60123456789',
    expected: 'HIGH',
  },
  {
    label: 'Job Scam',
    text: 'Kerja sambilan mudah! Like & share post je dapat RM50-RM200 sehari. Kerja dari rumah. Tiada pengalaman diperlukan. WhatsApp saya sekarang: 0198765432',
    expected: 'HIGH',
  },
  {
    label: 'Investment Scam',
    text: 'JOIN GROUP VIP PELABURAN KRIPTO KAMI! Modal RM500 boleh dapat RM5000 dalam masa 7 hari. Dijamin untung. Telegram: t.me/cryptovip_malaysia',
    expected: 'HIGH',
  },
  {
    label: 'Parcel Scam',
    text: 'Pos Malaysia: Bungkusan anda ditahan di kastam. Bayar duti kastam RM45 untuk melepaskan. Klik: http://posmalaysia-kastam.com/bayar',
    expected: 'HIGH',
  },
  {
    label: 'Safe message',
    text: 'Jom makan tengah hari kat kedai mamak belakang pejabat? Nasi lemak sedap hari ni',
    expected: 'LOW',
  },
];

async function runTests() {
  console.log('=== SafeLah — Gemini API Test ===\n');

  if (!process.env.GEMINI_API_KEY) {
    console.error('❌ GEMINI_API_KEY not set in .env');
    process.exit(1);
  }

  let passed = 0;
  let failed = 0;

  for (const tc of TEST_MESSAGES) {
    process.stdout.write(`Testing: ${tc.label}... `);
    try {
      const result = await analyseWithGemini(tc.text);

      if (!result) {
        console.log('❌ NULL response (Gemini unavailable or error)');
        failed++;
        continue;
      }

      const pass = result.risk_level === tc.expected;
      if (pass) {
        console.log(`✅ ${result.risk_level} (${result.scam_type || 'none'})`);
        passed++;
      } else {
        console.log(`⚠️  Got ${result.risk_level}, expected ${tc.expected} — ${result.reason_en}`);
        failed++;
      }
    } catch (err) {
      console.log(`❌ Error: ${err.message}`);
      failed++;
    }

    // Respect free tier rate limits (15 req/min)
    await new Promise(r => setTimeout(r, 1500));
  }

  console.log(`\n─────────────────────────────────`);
  console.log(`Results: ${passed}/${TEST_MESSAGES.length} passed, ${failed} failed`);

  if (failed === 0) {
    console.log('✅ All tests passed — Gemini is working correctly\n');
  } else {
    console.log('⚠️  Some tests failed — check logs above\n');
  }
}

runTests().catch(console.error);
