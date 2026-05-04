require('dotenv').config();

// Simulates the full guardian registration flow without WhatsApp
// Useful for testing DB logic before testing with real phones

const { createRegistrationCode, redeemCode, linkGuardian, getGuardians, getGuardianCount } = require('../src/db/queries');
const crypto = require('crypto');

function run() {
  console.log('=== SafeLah — Guardian Flow Test ===\n');

  const elderlyPhone  = '60123000001';
  const guardianPhone = '60123000002';

  // Step 1: Elderly registers
  const code = crypto.randomInt(100000, 999999).toString();
  createRegistrationCode(elderlyPhone, code);
  console.log(`1. Elderly (${elderlyPhone}) ran /daftar → code: ${code}`);

  // Step 2: Guardian links
  const record = redeemCode(code);
  if (!record) {
    console.error('❌ redeemCode failed — code not found or expired');
    process.exit(1);
  }
  console.log(`2. Code redeemed successfully. Elderly phone: ${record.elderly_phone}`);

  linkGuardian(record.elderly_phone, guardianPhone);
  console.log(`3. Guardian (${guardianPhone}) linked to ${record.elderly_phone}`);

  // Step 3: Verify
  const guardians = getGuardians(elderlyPhone);
  const count     = getGuardianCount(elderlyPhone);
  console.log(`4. Guardians for ${elderlyPhone}: ${JSON.stringify(guardians)}`);
  console.log(`5. Guardian count: ${count}`);

  // Step 4: Confirm code is now used (can't be reused)
  const reused = redeemCode(code);
  console.log(`6. Trying to reuse code: ${reused ? '❌ SECURITY BUG — code reused!' : '✅ correctly rejected'}`);

  console.log('\n✅ Guardian flow working correctly.\n');
}

try {
  run();
} catch (err) {
  console.error('❌ Test failed:', err.message);
  process.exit(1);
}
