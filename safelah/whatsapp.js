const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');
const fs = require('fs');

// whatsapp-web.js client instance
let whatsappClient = null;

/**
 * Initialize WhatsApp client with QR code authentication
 */
async function initializeWhatsApp() {
  return new Promise((resolve, reject) => {
    whatsappClient = new Client({
      authStrategy: new LocalAuth(),
      puppeteer: {
        headless: true,
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-gpu',
          '--disable-web-resources',
          '--disable-default-apps',
          '--disable-extensions',
          '--disable-sync',
          '--disable-translate',
          '--mute-audio',
          '--no-default-browser-check',
          '--no-first-run',
          '--no-pings',
          '--disable-blink-features=AutomationControlled',
        ],
        timeout: 0,
      },
    });
    // Add timeout for initialization
    const initTimeout = setTimeout(() => {
      console.error('[whatsapp] Initialization timeout - browser may be hanging');
      reject(new Error('WhatsApp initialization timeout after 60 seconds'));
    }, 60000);

    // QR code event for authentication
    whatsappClient.on('qr', (qr) => {
      console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      console.log('SCAN THIS QR CODE WITH YOUR PHONE:');
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

      // Display QR code in terminal
      const qrcode = require('qrcode-terminal');
      qrcode.generate(qr, { small: true });

      console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
    });

    // Client ready
    whatsappClient.on('ready', () => {
      console.log('[whatsapp] ✅ Bot is ready!');
      clearTimeout(initTimeout);
      resolve(whatsappClient);
    });

    // Authentication failed
    whatsappClient.on('auth_failure', (msg) => {
      console.error('[whatsapp] 🔴 Authentication failed:', msg);
      clearTimeout(initTimeout);
      reject(new Error(msg));
    });

    // Error handler
    whatsappClient.on('error', (err) => {
      console.error('[whatsapp] Error:', err);
      clearTimeout(initTimeout);
      reject(err);
    });

    // Session restored
    whatsappClient.on('authenticated', () => {
      console.log('[whatsapp] Session authenticated');
    });

    // Disconnected
    whatsappClient.on('disconnected', (reason) => {
      console.warn('[whatsapp] Disconnected:', reason);
    });

    // Initialize with error handling
    try {
      whatsappClient.initialize().catch((err) => {
        console.error('[whatsapp] Initialization error:', err);
        clearTimeout(initTimeout);
        reject(err);
      });
    } catch (err) {
      console.error('[whatsapp] Fatal initialization error:', err);
      clearTimeout(initTimeout);
      reject(err);
    }
  });
}

/**
 * Get the WhatsApp client instance
 */
function getClient() {
  return whatsappClient;
}

/**
 * Send a WhatsApp text message
 * @param {string} to — phone number (plain digits like "60123456789" or with @c.us/@s.whatsapp.net)
 * @param {string} text — message body
 */
async function sendMessage(to, text) {
  try {
    if (!whatsappClient) {
      throw new Error('WhatsApp client not initialized');
    }

    // Format phone number to chat ID if needed
    let chatId = to;
    if (!chatId.includes('@')) {
      // Normalize phone number
      let phone = String(to).replace(/\D/g, '');
      if (phone.startsWith('0')) phone = '60' + phone.slice(1);
      if (!phone.startsWith('60')) phone = '60' + phone;
      chatId = `${phone}@c.us`;
    }

    await whatsappClient.sendMessage(chatId, text);
    console.log(`[whatsapp] ✉️ sent to ${to}`);
  } catch (err) {
    console.error('[whatsapp] send failed:', err.message);
  }
}

/**
 * Download media from a message
 * @param {object} message — whatsapp-web.js message object
 * @returns {Buffer | null} — media buffer or null
 */
async function downloadMedia(message) {
  try {
    console.log(`[whatsapp] Checking media - hasMedia: ${message.hasMedia}, mime: ${message.mime}`);
    
    if (!message.hasMedia) {
      console.warn('[whatsapp] Message has no media flag');
      return null;
    }

    if (!message.media) {
      console.warn('[whatsapp] Message.media is empty, attempting download...');
    }

    // whatsapp-web.js already has media data
    console.log('[whatsapp] Starting downloadMedia from server...');
    const mediaData = await message.downloadMedia();
    
    if (!mediaData) {
      console.error('[whatsapp] downloadMedia returned null/undefined');
      return null;
    }

    console.log(`[whatsapp] Media downloaded successfully - mime: ${mediaData.mimetype}, size: ${mediaData.data?.length || 0} bytes`);

    return {
      data: Buffer.from(mediaData.data, 'base64'),
      mimetype: mediaData.mimetype || 'image/jpeg',
    };
  } catch (err) {
    console.error('[whatsapp] media download failed:', err.message);
    console.error('[whatsapp] Stack:', err.stack);
    return null;
  }
}

/**
 * Normalize phone number to Malaysian format
 */
function normalizePhone(phone) {
  let p = String(phone).replace(/\D/g, '');
  if (p.startsWith('0')) p = '60' + p.slice(1);
  if (!p.startsWith('60')) p = '60' + p;
  return p;
}

module.exports = { initializeWhatsApp, getClient, sendMessage, downloadMedia, normalizePhone }; 
