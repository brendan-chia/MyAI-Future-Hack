const { sendMessage } = require('./whatsapp');
const { analyseText } = require('./text');
const { analyseImage } = require('./image');
const { analyseAudio } = require('./audio');
const { handleCommand } = require('./commands');
const { isFirstTimeUser, checkRateLimit, getSession, addMessageToBatch, addImageToBatch, addAudioToBatch } = require('./queries');
const { processClarificationAnswer, processClarificationAnswerForConversation } = require('./sessionManager');

// Dedup guard — prevents double-processing
const processedIds = new Set();

const ONBOARDING_MSG =
  `Salam dan selamat datang ke SelamatLah! 🛡️\n\n` +
  `Saya di sini untuk membantu anda semak mesej yang mencurigakan — supaya anda tidak kena tipu.\n\n` +
  `Cara guna:\n` +
  `• Forward sebarang mesej syak ke sini\n` +
  `• Saya akan semak dan beritahu anda dalam masa beberapa saat\n\n` +
  `Percuma. Selamat. Tiada maklumat peribadi dikongsi.\n\n` +
  `Hantar /bantuan untuk lihat arahan lain.\n` +
  `Nak daftarkan ahli keluarga sebagai "Penjaga"? Hantar /daftar.`;

const RATE_LIMIT_MSG =
  `Anda telah membuat banyak semakan hari ini. 😊\n` +
  `Cuba lagi esok ya.\n\n` +
  `Perlukan bantuan segera?\n` +
  `Hotline Anti-Scam: 997 (8pg-8mlm setiap hari)`;

const UNSUPPORTED_MSG =
  `Maaf, saya hanya boleh semak:\n` +
  `• Mesej teks\n` +
  `• Tangkapan skrin (gambar/screenshot)\n` +
  `• Nota suara/audio\n\n` +
  `Sila forward semula dalam format tersebut. 🙏`;

/**
 * Handle incoming whatsapp-web.js message object
 *
 * whatsapp-web.js message properties:
 *   - id: { fromMe, remote, id }
 *   - from: phone number with @c.us or @s.whatsapp.net
 *   - to: recipient
 *   - body: text content
 *   - type: "chat", "image", "video", "document", etc.
 *   - hasMedia: boolean
 *   - hasQuotedMsg: boolean
 *   - timestamp: unix timestamp
 *   - author: sender (for groups)
 */
async function handleIncoming(message) {
  const msgId = message.id.id;                        // unique message ID
  const from = message.from;                          // "60123456789@c.us"
  const text = (message.body || '').trim();
  const hasMedia = message.hasMedia || false;
  const msgType = message.type || 'chat';             // "chat", "image", "video", etc.

  // Extract plain phone number: "60123456789@c.us" → "60123456789"
  const phone = from.replace('@c.us', '').replace('@s.whatsapp.net', '');

  // Dedup guard
  if (!msgId || processedIds.has(msgId)) return;
  processedIds.add(msgId);
  setTimeout(() => processedIds.delete(msgId), 60000);

  console.log(`[message] from: ${phone}, text: "${text}", type: ${msgType}, hasMedia: ${hasMedia}`);

  // Onboarding for new users
  if (isFirstTimeUser(phone)) {
    await sendMessage(phone, ONBOARDING_MSG);
    // Still process their first message after onboarding
  }

  // Rate limit check (increased for testing)
  const { allowed } = checkRateLimit(phone, 60);
  if (!allowed) {
    await sendMessage(phone, RATE_LIMIT_MSG);
    return;
  }

  // Check for commands first (text only)
  if (text) {
    const wasCommand = await handleCommand(phone, text);
    if (wasCommand) return;
  }

  // Check if user is waiting for clarification answer
  if (global.pendingClarification?.[phone]) {
    if (text) {
      const state = global.pendingClarification[phone];
      if (state.isConversationLevel) {
        await processClarificationAnswerForConversation(phone, text);
      } else {
        await processClarificationAnswer(phone, text);
      }
      return;
    }
  }

  // Check if user is in batch collection mode
  const session = getSession(phone);
  if (session && session.session_state === 'batch_collection') {
    // Prevent commands from being added as batch messages
    const isCommand = text && (text.startsWith('/scan') || text.startsWith('/analyze') || text.startsWith('/stop') || text.startsWith('/batalkan'));
    
    if (text && !isCommand) {
      // Add text message to batch
      const added = addMessageToBatch(phone, text);
      if (added) {
        const updatedSession = getSession(phone);
        const messages = updatedSession?.batch_messages || [];
        const audioCount = messages.filter(m => m.type === 'audio').length;
        const imageCount = messages.filter(m => m.type === 'image').length;
        const textCount = messages.filter(m => m.type === 'text').length;
        const lang = updatedSession?.language || 'bm';
        
        const msgs = {
          bm: `✅ Audio ${audioCount}, Gambar ${imageCount}, Mesej ${textCount} dikumpul.\n\nHantar /analisis untuk analisis atau terus forward mesej/audio/gambar lain.`,
          en: `✅ ${audioCount} audio(s), ${imageCount} image(s), ${textCount} message(s) collected.\n\nSend /analyze to analyze or continue forwarding.`,
        };
        
        await sendMessage(phone, msgs[lang] || msgs.bm);
      }
      return;
    } else if (hasMedia && (msgType === 'ptt' || msgType === 'audio')) {
      // Transcribe audio and add to batch
      const { transcribeAudio } = require('./speech');
      try {
        console.log(`[batch] Processing audio for ${phone}...`);
        const transcript = await transcribeAudio(message);
        
        if (transcript && transcript.trim().length > 0) {
          const added = addAudioToBatch(phone, transcript);
          
          if (added) {
            const updatedSession = getSession(phone);
            const messages = updatedSession?.batch_messages || [];
            const audioCount = messages.filter(m => m.type === 'audio').length;
            const imageCount = messages.filter(m => m.type === 'image').length;
            const textCount = messages.filter(m => m.type === 'text').length;
            const lang = updatedSession?.language || 'bm';
            
            const msgs = {
              bm: `✅ Audio ${audioCount}, Gambar ${imageCount}, Mesej ${textCount} ditambah.\n\nHantar /analisis untuk analisis atau terus forward mesej lain.`,
              en: `✅ ${audioCount} audio(s), ${imageCount} image(s), ${textCount} message(s) collected.\n\nSend /analyze to analyze or continue forwarding.`,
            };
            
            await sendMessage(phone, msgs[lang] || msgs.bm);
          }
        } else {
          const lang = session?.language || 'bm';
          const msgs = {
            bm: 'Maaf, tidak dapat mentranskripsi audio. Sila cuba lagi.',
            en: 'Sorry, could not transcribe audio. Please try again.',
          };
          await sendMessage(phone, msgs[lang] || msgs.bm);
        }
      } catch (err) {
        console.error('[batch] Audio processing error:', err.message);
        const lang = session?.language || 'bm';
        const msgs = {
          bm: 'Maaf, ralat semasa memproses audio. Sila cuba lagi.',
          en: 'Sorry, error processing audio. Please try again.',
        };
        await sendMessage(phone, msgs[lang] || msgs.bm);
      }
      return;
    } else if (hasMedia && (msgType === 'image' || msgType === 'document')) {
      // Add image to batch instead of analyzing immediately
      const { downloadMedia } = require('./whatsapp');
      try {
        console.log(`[batch] Processing image for ${phone}...`);
        const mediaResult = await downloadMedia(message);
        
        if (mediaResult) {
          const base64Image = mediaResult.data.toString('base64');
          const added = addImageToBatch(phone, base64Image, mediaResult.mimetype);
          
          if (added) {
            const updatedSession = getSession(phone);
            const messages = updatedSession?.batch_messages || [];
            const audioCount = messages.filter(m => m.type === 'audio').length;
            const imageCount = messages.filter(m => m.type === 'image').length;
            const textCount = messages.filter(m => m.type === 'text').length;
            const lang = updatedSession?.language || 'bm';
            
            const msgs = {
              bm: `✅ Audio ${audioCount}, Gambar ${imageCount}, Mesej ${textCount} dikumpul.\n\nHantar /analisis untuk analisis atau terus forward mesej/audio/gambar lain.`,
              en: `✅ ${audioCount} audio(s), ${imageCount} image(s), ${textCount} message(s) collected.\n\nSend /analyze to analyze or continue forwarding.`,
            };
            
            await sendMessage(phone, msgs[lang] || msgs.bm);
          }
        } else {
          const lang = session?.language || 'bm';
          const msgs = {
            bm: 'Maaf, tidak dapat memuat turun gambar. Sila cuba lagi.',
            en: 'Sorry, could not download image. Please try again.',
          };
          await sendMessage(phone, msgs[lang] || msgs.bm);
        }
      } catch (err) {
        console.error('[batch] Image processing error:', err.message);
        const lang = session?.language || 'bm';
        const msgs = {
          bm: 'Maaf, ralat semasa memproses gambar. Sila cuba lagi.',
          en: 'Sorry, error processing image. Please try again.',
        };
        await sendMessage(phone, msgs[lang] || msgs.bm);
      }
      return;
    }
  }

  // Normal mode: Determine message type and route
  if (hasMedia && (msgType === 'image' || msgType === 'document')) {
    // Image/media message
    await sendMessage(phone, '⏳ Sedang semak gambar... sila tunggu sebentar.');
    await analyseImage(phone, message);
  } else if (hasMedia && (msgType === 'ptt' || msgType === 'audio')) {
    // Audio message (voice note)
    await sendMessage(phone, '⏳ Transcribing audio... please wait a moment.');
    await analyseAudio(phone, message);
  } else if (text) {
    // Text message
    await sendMessage(phone, '⏳ Sedang semak... sila tunggu sebentar.');
    await analyseText(phone, text);
  } else {
    await sendMessage(phone, UNSUPPORTED_MSG);
  }
}

module.exports = { handleIncoming };
