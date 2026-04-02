const MALAY_KEYWORDS = /\b(saya|anda|ini|ada|tidak|boleh|tolong|terima|kasih|selamat|wang|polis|bank|nombor|akaun|nak|dah|lah|tak|ya|betul|tipu|scam|penipuan|bayar|transfer|menang|hadiah|tahniah|klik|pautan|segera|jangan|hutang|kerja|peluang)\b/i;

function detectLanguage(text) {
  // Only support Malay and English
  if (MALAY_KEYWORDS.test(text)) return 'bm';
  return 'en'; // default to English
}

module.exports = { detectLanguage };
