const crypto = require('crypto');
const { sendMessage } = require('./whatsapp');
const { createRegistrationCode, redeemCode, linkGuardian, getGuardianCount, startBatchSession } = require('./queries');
const { analyzeBatchMessages } = require('./sessionManager');

const COMMANDS = {
  // Malay commands
  '/daftar':  { handler: handleRegister, lang: 'bm' },
  '/jaga':    { handler: handleLink, lang: 'bm' },
  '/bantuan': { handler: handleHelp, lang: 'bm' },
  '/status':  { handler: handleStatus, lang: 'bm' },
  '/mula':   { handler: handleStart, lang: 'bm' },
  '/analisis': { handler: handleAnalyze, lang: 'bm' },
  '/batalkan':  { handler: handleCancel, lang: 'bm' },
  
  // English commands
  '/start':    { handler: handleStart, lang: 'en' },
  '/register': { handler: handleRegister, lang: 'en' },
  '/family':     { handler: handleLink, lang: 'en' },
  '/help':     { handler: handleHelp, lang: 'en' },
  '/info':     { handler: handleStatus, lang: 'en' },
  '/begin':    { handler: handleStart, lang: 'en' },
  '/analyze':  { handler: handleAnalyze, lang: 'en' },
  '/scan':     { handler: handleAnalyze, lang: 'en' },  // Alias for backward compatibility
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

async function handleRegister(from, args, lang = 'bm') {
  const code = crypto.randomInt(100000, 999999).toString();
  createRegistrationCode(from, code);

  const messages = {
    bm: `Salam! 👨‍👩‍👧‍👦 Untuk daftarkan Penjaga anda:\n\n` +
        `Kod Penjaga anda: *${code}*\n\n` +
        `Kongsi kod ini dengan anak atau ahli keluarga anda. Mereka perlu hantar:\n\n` +
        `/jaga ${code}\n\n` +
        `...kepada bot SelamatLah (nombor yang sama).\n\n` +
        `Kod sah selama 24 jam. Tiada maklumat peribadi akan dikongsi. 🛡️`,
    en: `Hello! 👨‍👩‍👧‍👦 To register a Guardian:\n\n` +
        `Your Guardian Code: *${code}*\n\n` +
        `Share this code with your family member. They need to send:\n\n` +
        `/link ${code}\n\n` +
        `...to the SelamatLah bot (same number).\n\n` +
        `Code is valid for 24 hours. No personal info will be shared. 🛡️`,
  };

  await sendMessage(from, messages[lang] || messages.bm);
}

async function handleLink(from, args, lang = 'bm') {
  const code = args[0];
  
  const errorMessages = {
    bm: 'Sila masukkan kod. Contoh: /jaga 482910',
    en: 'Please enter code. Example: /link 482910',
  };

  const invalidMessages = {
    bm: 'Kod tidak sah atau sudah tamat tempoh. Minta kod baru daripada ahli keluarga anda dengan /daftar.',
    en: 'Code is invalid or expired. Ask your family member for a new code using /register.',
  };

  const successMessages = {
    bm: `✅ Berjaya! Anda kini adalah Penjaga.\n\n` +
        `Anda akan dapat amaran senyap apabila ahli keluarga anda menyemak mesej berisiko tinggi.\n\n` +
        `Amaran hanya mengandungi tahap risiko dan jenis penipuan — tiada kandungan mesej asal dikongsi.\n\n` +
        `Terima kasih kerana jaga keluarga anda. 🛡️`,
    en: `✅ Success! You are now a Guardian.\n\n` +
        `You will receive silent alerts when your family member checks high-risk messages.\n\n` +
        `Alerts only contain risk level and scam type — original message content is not shared.\n\n` +
        `Thank you for protecting your family. 🛡️`,
  };

  const notifyMessages = {
    bm: `✅ Seorang Penjaga baru telah didaftarkan.\n\n` +
        `Mereka akan dapat amaran apabila SelamatLah kesan mesej berisiko tinggi yang anda semak.\n\n` +
        `Anda boleh daftarkan lebih ramai Penjaga dengan /daftar semula.`,
    en: `✅ A new Guardian has been registered.\n\n` +
        `They will receive alerts when SelamatLah detects high-risk messages you check.\n\n` +
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

async function handleHelp(from, args, lang = 'bm') {
  const messages = {
    bm: `SelamatLah — Panduan Penggunaan 🛡️\n\n` +
        `ANALISIS CEPAT (default):\n` +
        `• Forwardkan mana-mana mesej syak ke sini\n` +
        `• Saya akan semak dan beritahu sama ada selamat atau penipuan\n\n` +
        `ANALISIS BERKELANJUTAN (untuk multi-mesej):\n` +
        `/mula — Mula mod batch (kumpul beberapa mesej)\n` +
        `• Hantar mesej teks atau gambar\n` +
        `• Saya akan kumpul semuanya untuk analisis konteks penuh\n` +
        `/analisis — Analisis semua mesej & gambar yang dikumpul\n` +
        `/batalkan — Batalkan mod batch\n\n` +
        `ARAHAN LAIN:\n` +
        `/daftar — Daftarkan ahli keluarga sebagai Penjaga\n` +
        `/jaga [kod] — Jadilah Penjaga untuk ahli keluarga\n` +
        `/status — Lihat bilangan Penjaga anda\n` +
        `/bantuan — Paparkan mesej ini\n\n` +
        `KECEMASAN:\n` +
        `Hotline Anti-Scam: 997 (8pg-8mlm setiap hari)\n` +
        `PDRM CCID: 03-2610 1559`,
    en: `SelamatLah — User Guide 🛡️\n\n` +
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

async function handleStatus(from, args, lang = 'bm') {
  const count = getGuardianCount(from);
  
  const messages = {
    bm: `Status akaun anda:\n\n` +
        `👨‍👩‍👧‍👦 Penjaga berdaftar: ${count}\n\n` +
        `${count === 0 ? 'Anda belum ada Penjaga. Hantar /daftar untuk daftarkan ahli keluarga.' : 'Anda boleh daftarkan lebih ramai dengan /daftar.'}`,
    en: `Your account status:\n\n` +
        `👨‍👩‍👧‍👦 Registered Guardians: ${count}\n\n` +
        `${count === 0 ? 'You have no Guardians yet. Use /register to add a family member.' : 'You can register more Guardians using /register.'}`,
  };

  await sendMessage(from, messages[lang] || messages.bm);
}

async function handleStart(from, args, lang = 'bm') {
  startBatchSession(from, lang);
  
  const messages = {
    bm: `🎯 Mod Analisis Berkelanjutan Dimulai!\n\n` +
        `Sekarang anda boleh:\n` +
        `1. Forwardkan atau hantar seberapa banyak mesej, gambar, atau nota suara\n` +
        `2. Setiap item akan dikumpulkan\n` +
        `3. Hantar /analisis apabila selesai\n` +
        `4. Saya akan analisis semua dan tanya soalan jika perlu untuk ketepatan\n\n` +
        `Perintah:\n` +
        `• /analisis — Analisis semua mesej, gambar & audio yang dikumpul\n` +
        `• /batalkan — Batalkan mod ini\n\n` +
        `Mari kita mula! 🚀`,
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

async function handleAnalyze(from, args, lang = 'bm') {
  await analyzeBatchMessages(from, lang);
}

async function handleCancel(from, args, lang = 'bm') {
  const { clearBatchSession } = require('./queries');
  clearBatchSession(from);
  if (global.pendingClarification?.[from]) {
    delete global.pendingClarification[from];
  }
  
  const messages = {
    bm: `✅ Analisis dibatalkan. Hantar /start untuk analisis baru atau forward mesej untuk analisis cepat.`,
    en: `✅ Analysis cancelled. Use /begin for a new batch analysis or forward a message for quick analysis.`,
  };

  await sendMessage(from, messages[lang] || messages.bm);
}

module.exports = { handleCommand };
