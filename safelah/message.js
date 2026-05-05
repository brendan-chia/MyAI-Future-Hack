const { sendMessage } = require('./whatsapp');
const { analyseText } = require('./services/text');
const { analyseImage } = require('./services/image');
const { analyseAudio } = require('./services/audio');
const { handleCommand } = require('./commands');
const { isFirstTimeUser, checkRateLimit, getSession, addMessageToBatch, addImageToBatch, addAudioToBatch } = require('./queries');
const { processClarificationAnswer, processClarificationAnswerForConversation } = require('./sessionManager');

// Dedup guard — prevents double-processing
const processedIds = new Set();

const ONBOARDING_MSG =
  `Hello and welcome to SafeLah! 🛡️\n\n` +
  `I’m here to help you check suspicious messages so you do not get scammed.\n\n` +
  `How to use:\n` +
  `• Forward any suspicious message here\n` +
  `• I will check it and tell you within a few seconds\n\n` +
  `Free. Safe. No personal information is shared.\n\n` +
  `Send /help to see more commands.\n` +
  `Want to register a family member as a Guardian? Send /register.`;

const RATE_LIMIT_MSG =
  `You have made many checks today. 😊\n` +
  `Please try again tomorrow.\n\n` +
  `Need urgent help?\n` +
  `Anti-Scam Hotline: 997 (8am-8pm daily)`;

const UNSUPPORTED_MSG =
  `Sorry, I can only check:\n` +
  `• Text messages\n` +
  `• Screenshots (images)\n` +
  `• Voice notes / audio\n\n` +
  `Please forward it again in one of those formats. 🙏`;

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
        const lang = updatedSession?.language || 'en';
        
        const msgs = {
          bm: `✅ ${audioCount} audio(s), ${imageCount} image(s), ${textCount} message(s) collected.\n\nSend /analyze to analyze or continue forwarding.`,
          en: `✅ ${audioCount} audio(s), ${imageCount} image(s), ${textCount} message(s) collected.\n\nSend /analyze to analyze or continue forwarding.`,
        };
        
        await sendMessage(phone, msgs[lang] || msgs.bm);
      }
      return;
    } else if (hasMedia && (msgType === 'ptt' || msgType === 'audio')) {
      // Transcribe audio and add to batch
      const { transcribeAudio } = require('./services/speech');
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
            const lang = updatedSession?.language || 'en';
            
            const msgs = {
              bm: `✅ ${audioCount} audio(s), ${imageCount} image(s), ${textCount} message(s) collected.\n\nSend /analyze to analyze or continue forwarding.`,
              en: `✅ ${audioCount} audio(s), ${imageCount} image(s), ${textCount} message(s) collected.\n\nSend /analyze to analyze or continue forwarding.`,
            };
            
            await sendMessage(phone, msgs[lang] || msgs.bm);
          }
        } else {
          const lang = session?.language || 'en';
          const msgs = {
            bm: 'Sorry, could not transcribe audio. Please try again.',
            en: 'Sorry, could not transcribe audio. Please try again.',
          };
          await sendMessage(phone, msgs[lang] || msgs.bm);
        }
      } catch (err) {
        console.error('[batch] Audio processing error:', err.message);
        const lang = session?.language || 'en';
        const msgs = {
          bm: 'Sorry, there was an error processing the audio. Please try again.',
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
            const lang = updatedSession?.language || 'en';
            
            const msgs = {
              bm: `✅ ${audioCount} audio(s), ${imageCount} image(s), ${textCount} message(s) collected.\n\nSend /analyze to analyze or continue forwarding.`,
              en: `✅ ${audioCount} audio(s), ${imageCount} image(s), ${textCount} message(s) collected.\n\nSend /analyze to analyze or continue forwarding.`,
            };
            
            await sendMessage(phone, msgs[lang] || msgs.bm);
          }
        } else {
          const lang = session?.language || 'en';
          const msgs = {
            bm: 'Sorry, could not download image. Please try again.',
            en: 'Sorry, could not download image. Please try again.',
          };
          await sendMessage(phone, msgs[lang] || msgs.bm);
        }
      } catch (err) {
        console.error('[batch] Image processing error:', err.message);
        const lang = session?.language || 'en';
        const msgs = {
          bm: 'Sorry, there was an error processing the image. Please try again.',
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
    await sendMessage(phone, '⏳ Checking image... please wait a moment.');
    await analyseImage(phone, message);
  } else if (hasMedia && (msgType === 'ptt' || msgType === 'audio')) {
    // Audio message (voice note)
    await sendMessage(phone, '⏳ Transcribing audio... please wait a moment.');
    await analyseAudio(phone, message);
  } else if (text) {
    // Text message
    await sendMessage(phone, '⏳ Checking... please wait a moment.');
    await analyseText(phone, text);
  } else {
    await sendMessage(phone, UNSUPPORTED_MSG);
  }
}

module.exports = { handleIncoming };
