require('dotenv').config();
const { checkSemakMule } = require('../src/services/semakmule');

// Known test values — use numbers from public PDRM press releases
const TESTS = [
  { value: '0123456789', category: 'phone',   label: 'Sample phone number' },
  { value: '1234567890', category: 'bank',    label: 'Sample bank account' },
];

async function run() {
  console.log('=== SelamatLah — CCID Semak Mule Test ===\n');
  console.log('Note: CCID site may be slow. Each check takes 3-8 seconds.\n');

  for (const t of TESTS) {
    process.stdout.write(`Checking ${t.label} (${t.value})... `);
    try {
      const result = await checkSemakMule(t.value, t.category);
      console.log(`✅ source: ${result.source}, found: ${result.found}, reports: ${result.reports}`);
    } catch (err) {
      console.log(`❌ Error: ${err.message}`);
    }
    await new Promise(r => setTimeout(r, 1000));
  }

  console.log('\nIf source is "ccid_unavailable", the scraper failed gracefully.');
  console.log('This is expected if CCID site is down — bot will still work via Gemini.\n');
}

run().catch(console.error);
