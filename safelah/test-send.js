require('dotenv').config();
const { initializeWhatsApp, sendMessage } = require('./whatsapp');

// Usage: node test-send.js 60123456789
// Sends a test message to the specified phone number

async function run() {
  const to = process.argv[2];

  if (!to) {
    console.error('Usage: node test-send.js 60123456789');
    process.exit(1);
  }

  try {
    console.log('Initializing WhatsApp client...');
    await initializeWhatsApp();

    console.log(`\nSending test message to ${to}...`);

    await sendMessage(to,
      `✅ SafeLah test berjaya!\n\n` +
      `Bot anda berfungsi dengan baik. 🛡️\n\n` +
      `Hantar sebarang mesej syak untuk disemak.`
    );

    console.log('✓ Message sent! Check your WhatsApp!');
    process.exit(0);
  } catch (err) {
    console.error('❌ Send failed:', err.message);
    process.exit(1);
  }
}

run();
