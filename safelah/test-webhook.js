require('dotenv').config();
const axios = require('axios');

const PORT = process.env.PORT || 3000;
const BASE = `http://localhost:${PORT}`;

// Payloads to test different message types
const PAYLOADS = {
  text_scam: {
    label: 'Text — Macau Scam',
    body: {
      object: 'whatsapp_business_account',
      entry: [{
        changes: [{
          value: {
            messaging_product: 'whatsapp',
            messages: [{
              id: `test_${Date.now()}_1`,
              from: '60123456789',
              type: 'text',
              timestamp: String(Math.floor(Date.now() / 1000)),
              text: {
                body: 'Ini panggilan daripada PDRM. Akaun anda digunakan untuk jenayah. Transfer RM3000 ke akaun selamat 1234567890123 dalam masa 24 jam atau ditangkap. Hubungi 0198765432.'
              }
            }]
          },
          field: 'messages'
        }]
      }]
    }
  },

  text_safe: {
    label: 'Text — Safe message',
    body: {
      object: 'whatsapp_business_account',
      entry: [{
        changes: [{
          value: {
            messaging_product: 'whatsapp',
            messages: [{
              id: `test_${Date.now()}_2`,
              from: '60123456789',
              type: 'text',
              timestamp: String(Math.floor(Date.now() / 1000)),
              text: {
                body: 'Eh jom makan laksa petang ni? Ada tempat best kat SS2.'
              }
            }]
          },
          field: 'messages'
        }]
      }]
    }
  },

  text_phishing: {
    label: 'Text — Phishing link',
    body: {
      object: 'whatsapp_business_account',
      entry: [{
        changes: [{
          value: {
            messaging_product: 'whatsapp',
            messages: [{
              id: `test_${Date.now()}_3`,
              from: '60123456789',
              type: 'text',
              timestamp: String(Math.floor(Date.now() / 1000)),
              text: {
                body: 'Akaun Maybank anda akan ditamatkan. Log masuk segera: http://maybank2u-secure-login.xyz/update'
              }
            }]
          },
          field: 'messages'
        }]
      }]
    }
  },

  command_daftar: {
    label: 'Command — /daftar',
    body: {
      object: 'whatsapp_business_account',
      entry: [{
        changes: [{
          value: {
            messaging_product: 'whatsapp',
            messages: [{
              id: `test_${Date.now()}_4`,
              from: '60123456789',
              type: 'text',
              timestamp: String(Math.floor(Date.now() / 1000)),
              text: { body: '/daftar' }
            }]
          },
          field: 'messages'
        }]
      }]
    }
  },

  command_bantuan: {
    label: 'Command — /bantuan',
    body: {
      object: 'whatsapp_business_account',
      entry: [{
        changes: [{
          value: {
            messaging_product: 'whatsapp',
            messages: [{
              id: `test_${Date.now()}_5`,
              from: '60123456789',
              type: 'text',
              timestamp: String(Math.floor(Date.now() / 1000)),
              text: { body: '/bantuan' }
            }]
          },
          field: 'messages'
        }]
      }]
    }
  },
};

async function checkHealth() {
  try {
    const res = await axios.get(`${BASE}/health`);
    console.log('✅ Server health:', JSON.stringify(res.data, null, 2));
    return true;
  } catch {
    console.error(`❌ Server not running on port ${PORT}. Start it with: npm run dev`);
    return false;
  }
}

async function sendPayload(key) {
  const payload = PAYLOADS[key];
  if (!payload) {
    console.error(`Unknown payload key: ${key}`);
    console.log('Available:', Object.keys(PAYLOADS).join(', '));
    return;
  }

  console.log(`\nSending: ${payload.label}`);
  try {
    const res = await axios.post(`${BASE}/webhook`, payload.body, {
      headers: { 'Content-Type': 'application/json' }
    });
    console.log(`✅ Server responded: ${res.status}`);
    console.log('   Watch your server logs for processing output...');
  } catch (err) {
    console.error('❌ Failed:', err.message);
  }
}

async function run() {
  const key = process.argv[2];

  const alive = await checkHealth();
  if (!alive) process.exit(1);

  if (!key) {
    console.log('\nUsage: node scripts/test-webhook.js [payload]\n');
    console.log('Available payloads:');
    Object.entries(PAYLOADS).forEach(([k, v]) => console.log(`  ${k.padEnd(20)} — ${v.label}`));
    console.log('\nExample: node scripts/test-webhook.js text_scam');
    return;
  }

  if (key === 'all') {
    for (const k of Object.keys(PAYLOADS)) {
      await sendPayload(k);
      await new Promise(r => setTimeout(r, 2000)); // gap between tests
    }
  } else {
    await sendPayload(key);
  }
}

run().catch(console.error);
