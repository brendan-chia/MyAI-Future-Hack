const crypto = require('crypto');
const { sendMessage } = require('./whatsapp');
const { createRegistrationCode, redeemCode, linkGuardian, getGuardianCount, startBatchSession } = require('./queries');
const { analyzeBatchMessages } = require('./sessionManager');

const COMMANDS = {
  '/daftar':  { handler: handleRegister, lang: 'en' },
  '/jaga':    { handler: handleLink, lang: 'en' },
  '/bantuan': { handler: handleHelp, lang: 'en' },
  '/status':  { handler: handleStatus, lang: 'en' },
  '/mula':   { handler: handleStart, lang: 'en' },
  '/analisis': { handler: handleAnalyze, lang: 'en' },
  '/batalkan':  { handler: handleCancel, lang: 'en' },
  '/panggilan': { handler: handleLiveCall, lang: 'en' },
  '/start':    { handler: handleStart, lang: 'en' },
  '/register': { handler: handleRegister, lang: 'en' },
  '/family':     { handler: handleLink, lang: 'en' },
  '/help':     { handler: handleHelp, lang: 'en' },
  '/info':     { handler: handleStatus, lang: 'en' },
  '/begin':    { handler: handleStart, lang: 'en' },
  '/analyze':  { handler: handleAnalyze, lang: 'en' },
  '/scan':     { handler: handleAnalyze, lang: 'en' },
  '/live':     { handler: handleLiveCall, lang: 'en' },
  '/call':     { handler: handleLiveCall, lang: 'en' },
  '/monitor':  { handler: handleLiveCall, lang: 'en' },
  '/stop':     { handler: handleCancel, lang: 'en' },
};

// Returns true if the message was a command (skip scam analysis)
async function handleCommand(from, text) {
  const parts = text.trim().split(/\s+/);
  const cmd   = parts[0].toLowerCase();
  const cmdConfig = COMMANDS[cmd];
  if (!cmdConfig) return false;
  await cmdConfig.handler(from, parts.slice(1), cmdConfig.lang);
  return true;
}

async function handleRegister(from, args, lang = 'en') {
  const code = crypto.randomInt(100000, 999999).toString();
  createRegistrationCode(from, code);

  const messages = {
    bm: `Hello! 👨‍👩‍👧‍👦 To register a Guardian:\n\n` +
      `Your Guardian Code: *${code}*\n\n` +
      `Share this code with your family member. They need to send:\n\n` +
      `/family ${code}\n\n` +
      `...to the SafeLah bot (same number).\n\n` +
      `The code is valid for 24 hours. No personal information will be shared. 🛡️`,
    en: `Hello! 👨‍👩‍👧‍👦 To register a Guardian:\n\n` +
        `Your Guardian Code: *${code}*\n\n` +
        `Share this code with your family member. They need to send:\n\n` +
        `/link ${code}\n\n` +
      `...to the SafeLah bot (same number).\n\n` +
      `The code is valid for 24 hours. No personal information will be shared. 🛡️`,
  };

  await sendMessage(from, messages[lang] || messages.bm);
}

async function handleLink(from, args, lang = 'en') {
  const code = args[0];
  
  const errorMessages = {
    bm: 'Please enter a code. Example: /family 482910',
    en: 'Please enter code. Example: /link 482910',
  };

  const invalidMessages = {
    bm: 'The code is invalid or expired. Ask your family member for a new code using /register.',
    en: 'Code is invalid or expired. Ask your family member for a new code using /register.',
  };

  const successMessages = {
    bm: `✅ Success! You are now a Guardian.\n\n` +
      `You will receive silent alerts when your family member checks high-risk messages.\n\n` +
      `Alerts only contain risk level and scam type — original message content is not shared.\n\n` +
      `Thank you for protecting your family. 🛡️`,
    en: `✅ Success! You are now a Guardian.\n\n` +
        `You will receive silent alerts when your family member checks high-risk messages.\n\n` +
        `Alerts only contain risk level and scam type — original message content is not shared.\n\n` +
        `Thank you for protecting your family. 🛡️`,
  };

  const notifyMessages = {
    bm: `✅ A new Guardian has been registered.\n\n` +
      `They will receive alerts when SafeLah detects high-risk messages you check.\n\n` +
      `You can register more Guardians using /register again.`,
    en: `✅ A new Guardian has been registered.\n\n` +
        `They will receive alerts when SafeLah detects high-risk messages you check.\n\n` +
        `You can register more Guardians using /register again.`,
  };

  if (!code) {
    await sendMessage(from, errorMessages[lang] || errorMessages.bm);
    return;
  }

  const record = redeemCode(code);
  if (!record) {
    await sendMessage(from, invalidMessages[lang] || invalidMessages.bm);
    return;
  }

  linkGuardian(record.elderly_phone, from);
  await sendMessage(from, successMessages[lang] || successMessages.bm);
  await sendMessage(record.elderly_phone, notifyMessages[lang] || notifyMessages.bm);
}

async function handleHelp(from, args, lang = 'en') {
  const messages = {
  bm: `SafeLah — User Guide 🛡️\n\n` +
    `QUICK ANALYSIS (default):\n` +
    `• Forward any suspicious message here\n` +
    `• I will check and tell you if it's safe or a scam\n\n` +
    `BATCH ANALYSIS (for multiple messages, images & audio):\n` +
    `/begin — Start batch mode (collect messages)\n` +
    `• Send text messages, images, or voice notes\n` +
    `• I will collect and analyze everything together for full context\n` +
    `/analyze — Analyze all collected messages, images & audio\n` +
    `/stop — Cancel batch mode\n\n` +
    `OTHER COMMANDS:\n` +
    `/live - Open real-time phone call monitoring\n` +
    `/register — Register a family member as Guardian\n` +
    `/link [code] — Become a Guardian for family member\n` +
    `/info — View your registered Guardians\n` +
    `/help — Show this message\n\n` +
    `EMERGENCY:\n` +
    `Anti-Scam Hotline: 997 (8am-8pm daily)\n` +
    `PDRM CCID: 03-2610 1559`,
  en: `SafeLah — User Guide 🛡️\n\n` +
    `QUICK ANALYSIS (default):\n` +
    `• Forward any suspicious message here\n` +
    `• I will check and tell you if it's safe or a scam\n\n` +
    `BATCH ANALYSIS (for multiple messages, images & audio):\n` +
    `/begin — Start batch mode (collect messages)\n` +
    `• Send text messages, images, or voice notes\n` +
    `• I will collect and analyze everything together for full context\n` +
    `/analyze — Analyze all collected messages, images & audio\n` +
    `/stop — Cancel batch mode\n\n` +
    `OTHER COMMANDS:\n` +
    `/live - Open real-time phone call monitoring\n` +
    `/register — Register a family member as Guardian\n` +
    `/link [code] — Become a Guardian for family member\n` +
    `/info — View your registered Guardians\n` +
    `/help — Show this message\n\n` +
    `EMERGENCY:\n` +
    `Anti-Scam Hotline: 997 (8am-8pm daily)\n` +
    `PDRM CCID: 03-2610 1559`,
  };

  await sendMessage(from, messages[lang] || messages.bm);
}

async function handleStatus(from, args, lang = 'en') {
  const count = getGuardianCount(from);
  
  const messages = {
    bm: `Your account status:\n\n` +
      `👨‍👩‍👧‍👦 Registered Guardians: ${count}\n\n` +
      `${count === 0 ? 'You have no Guardians yet. Use /register to add a family member.' : 'You can register more Guardians using /register.'}`,
    en: `Your account status:\n\n` +
        `👨‍👩‍👧‍👦 Registered Guardians: ${count}\n\n` +
        `${count === 0 ? 'You have no Guardians yet. Use /register to add a family member.' : 'You can register more Guardians using /register.'}`,
  };

  await sendMessage(from, messages[lang] || messages.bm);
}

async function handleStart(from, args, lang = 'en') {
  startBatchSession(from, lang);
  
  const messages = {
    bm: `🎯 Batch Analysis Mode Started!\n\n` +
      `You can now:\n` +
      `1. Forward or send as many messages, images, or voice notes as you want\n` +
      `2. Each item will be collected\n` +
      `3. Send /analyze when finished\n` +
      `4. I will analyze everything and ask questions if needed for accuracy\n\n` +
      `Commands:\n` +
      `• /analyze — Analyze all collected messages, images & audio\n` +
      `• /stop — Cancel this mode\n\n` +
      `Let's get started! 🚀`,
    en: `🎯 Batch Analysis Mode Started!\n\n` +
        `You can now:\n` +
        `1. Forward or send as many messages, images, or voice notes as you want\n` +
        `2. Each will be collected together\n` +
        `3. Send /analyze when done\n` +
        `4. I will analyze all together and ask questions if needed for accuracy\n\n` +
        `Commands:\n` +
        `• /analyze — Analyze all collected messages, images & audio\n` +
        `• /stop — Cancel this mode\n\n` +
        `Let's get started! 🚀`,
  };

  await sendMessage(from, messages[lang] || messages.bm);
}

async function handleAnalyze(from, args, lang = 'en') {
  await analyzeBatchMessages(from, lang);
}

async function handleCancel(from, args, lang = 'en') {
  const { clearBatchSession } = require('./queries');
  clearBatchSession(from);
  if (global.pendingClarification?.[from]) {
    delete global.pendingClarification[from];
  }
  
  const messages = {
    bm: `✅ Analysis cancelled. Use /start for a new batch analysis or forward a message for quick analysis.`,
    en: `✅ Analysis cancelled. Use /begin for a new batch analysis or forward a message for quick analysis.`,
  };

  await sendMessage(from, messages[lang] || messages.bm);
}

function getLiveCallUrl() {
  const baseUrl =
    process.env.PUBLIC_BASE_URL ||
    process.env.APP_BASE_URL ||
    process.env.WEB_BASE_URL ||
    `http://localhost:${process.env.PORT || 8080}`;

  return `${baseUrl.replace(/\/$/, '')}/live-call.html`;
}

async function handleLiveCall(from, args, lang = 'en') {
  const url = getLiveCallUrl();
  const messages = {
    bm:
      `Live Call Companion\n\n` +
      `Open this link before or during a suspicious phone call:\n${url}\n\n` +
      `Tap Start Monitoring, allow microphone access, and put the phone call on speaker. The button will change to Stop Monitoring so you can stop anytime.\n\n` +
      `For WhatsApp voice notes, just forward the audio here and I will analyze it directly.`,
    en:
      `Live Call Companion\n\n` +
      `Open this link before or during a suspicious phone call:\n${url}\n\n` +
      `Tap Start Monitoring, allow microphone access, and put the phone call on speaker. The button will change to Stop Monitoring so you can stop anytime.\n\n` +
      `For WhatsApp voice notes, just forward the audio here and I will analyze it directly.`,
  };

  await sendMessage(from, messages[lang] || messages.en);
}

module.exports = { handleCommand };
