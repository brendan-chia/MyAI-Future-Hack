// Fallback when Gemini API is unavailable — covers the most dangerous Malaysian scam patterns
// Each entry: { pattern, type, reason_bm, reason_en }

const HIGH_RISK_PATTERNS = [
  // ── Macau Scam — government impersonation ──
  { pattern: /pdrm|polis diraja|bank negara|bnm|mahkamah|lhdn|kastam|sprm|macc/i,
    type: 'MACAU_SCAM',
    reason_bm: 'Mesej ini menyamar sebagai pihak berkuasa kerajaan — taktik biasa Macau Scam.',
    reason_en: 'This message impersonates a government authority — a classic Macau Scam tactic.' },
  { pattern: /akaun.*ditamatkan|akaun.*dibekukan|wang.*haram|pengedaran dadah/i,
    type: 'MACAU_SCAM',
    reason_bm: 'Mesej ini mendakwa akaun anda terlibat dalam aktiviti haram — penipuan biasa.',
    reason_en: 'This message claims your account is involved in illegal activity — a common scam.' },
  { pattern: /tangkap|waran tangkap|muflis|bankrap|kes jenayah/i,
    type: 'MACAU_SCAM',
    reason_bm: 'Mesej ini mengancam tindakan undang-undang palsu untuk menakutkan anda.',
    reason_en: 'This message uses fake legal threats to scare you.' },
  { pattern: /jabatan kastam|imigresen.*tahan|dokumen.*haram/i,
    type: 'MACAU_SCAM',
    reason_bm: 'Mesej ini menyamar sebagai pegawai kastam/imigresen.',
    reason_en: 'This message impersonates customs/immigration officers.' },

  // ── Urgency + money transfer ──
  { pattern: /(segera|urgent|immediately).{0,30}(transfer|bayar|deposit|bank in)/i,
    type: 'UNKNOWN_SCAM',
    reason_bm: 'Mesej ini mendesak anda membuat bayaran segera — tanda penipuan.',
    reason_en: 'This message urgently demands payment — a scam indicator.' },
  { pattern: /(24 jam|hari ini|malam ini).{0,30}(bayar|transfer|deposit)/i,
    type: 'UNKNOWN_SCAM',
    reason_bm: 'Mesej ini menekan anda bayar dalam masa terhad — taktik penipuan.',
    reason_en: 'This message pressures you to pay within a time limit — a scam tactic.' },

  // ── Lucky draw / prize ──
  { pattern: /congratulations.{0,120}(gift.?card|amazon|facebook user|claim your prize|reserved.{0,20}for you|click.*continue|klik.*continue)/i,
    type: 'LUCKY_DRAW',
    reason_bm: 'Mesej ini mendakwa anda memenagi hadiah (Amazon/Gift Card/dll) — penipuan cabutan bertuah.',
    reason_en: 'This message falsely claims you won a prize (Amazon/Gift Card/etc.) — a fake lucky draw scam.' },
  { pattern: /tahniah.*menang|congratulations.*won|lucky draw.*klik|hadiah.*RM\s*[\d,]+/i,
    type: 'LUCKY_DRAW',
    reason_bm: 'Mesej ini mendakwa anda memenangi hadiah — penipuan cabutan bertuah.',
    reason_en: 'This message claims you won a prize — a fake lucky draw scam.' },
  { pattern: /(gift.?card|amazon|shopee|lazada).{0,80}(claim|redeem|click|klik|continue|collect).{0,80}(minute|second|minit|saat|\d+\s*(min|sec))/i,
    type: 'LUCKY_DRAW',
    reason_bm: 'Mesej ini menawarkan hadiah dengan pautan dan kiraan masa menurun — penipuan.',
    reason_en: 'This message offers a prize with a link and countdown timer — a scam.' },

  // ── Phishing URLs ──
  { pattern: /bit\.ly\/|tinyurl\.com\/|rb\.gy\/|cutt\.ly\//i,
    type: 'PHISHING_LINK',
    reason_bm: 'Mesej ini mengandungi pautan pendek yang mencurigakan.',
    reason_en: 'This message contains a suspicious shortened URL.' },
  { pattern: /maybank2u[^.a-z]|cimbclicks[^.a-z]|publicbank-[^.a-z]/i,
    type: 'PHISHING_LINK',
    reason_bm: 'Mesej ini mengandungi pautan palsu yang menyerupai laman bank.',
    reason_en: 'This message contains a fake link mimicking a bank website.' },
  { pattern: /myeg-[^.a-z]|ssm-[^.a-z]|lhdn-[^.a-z]/i,
    type: 'PHISHING_LINK',
    reason_bm: 'Mesej ini mengandungi pautan palsu yang menyerupai portal kerajaan.',
    reason_en: 'This message contains a fake link mimicking a government portal.' },

  // ── Family emergency / "Ah Boy" impersonation scam ──
  { pattern: /(number baru|new number|nombor baru|phone (rosak|spoil|broken)).{0,200}(accident|kemalangan|hospital|polis|police|bayar|pay|settle|RM\s*[\d,]+)/is,
    type: 'FAMILY_EMERGENCY_SCAM',
    reason_bm: 'Mesej ini meniru ahli keluarga dengan nombor baru dan meminta wang kecemasan — penipuan keluarga yang sangat biasa di Malaysia.',
    reason_en: 'This message impersonates a family member with a new number and requests emergency money — a very common Malaysian family scam.' },
  { pattern: /(accident|kemalangan).{0,150}(bayar|pay|settle|RM\s*[\d,]+|lawyer|peguam).{0,100}(police|polis|court|mahkamah)/is,
    type: 'FAMILY_EMERGENCY_SCAM',
    reason_bm: 'Mesej mendakwa kemalangan dan meminta wang untuk "selesai" dengan polis/peguam — penipuan.',
    reason_en: 'Message claims an accident and requests money to "settle" with police/lawyer — a scam.' },
  { pattern: /(jangan (bagitau|beritahu|cakap)|don.t tell|rahsia).{0,100}(bayar|pay|RM|wang|money)/is,
    type: 'FAMILY_EMERGENCY_SCAM',
    reason_bm: 'Meminta kerahsiaan dan wang pada masa yang sama adalah tanda jelas penipuan.',
    reason_en: 'Requesting secrecy combined with a money request is a clear scam indicator.' },

  // ── DuitNow QR fake payment scam ──
  { pattern: /duitnow.{0,50}(qr|scan|bayar|payment|pay).{0,100}(countdown|timer|\d+\s*second|minit)/is,
    type: 'PAYMENT_SCAM',
    reason_bm: 'QR DuitNow dengan kiraan masa menurun — kemungkinan penipu meminta anda membayar bukan menerima.',
    reason_en: 'DuitNow QR with countdown timer — likely a scammer requesting payment from you, not sending to you.' },

  // ── Job scam upfront ──
  /bayar.{0,20}dahulu.{0,20}kerja|yuran.{0,20}pendaftaran.{0,20}kerja/i,
];

const MEDIUM_RISK_PATTERNS = [
  /untung.{0,20}(tinggi|%)|keuntungan.{0,30}sebulan|passive income/i,
  /kerja dari rumah.{0,20}RM|part.?time.{0,20}RM.{0,20}sehari/i,
  /pinjaman.{0,20}tiada.{0,20}semak|loan.{0,20}no.{0,20}credit check/i,
  /klik pautan|click link|link di bawah|link dibawah/i,
  /telegram.{0,30}(group|kumpulan).{0,30}(pelaburan|untung|profit)/i,
  /crypto.{0,20}(untung|profit|guarantee|dijamin)/i,
  /modal.{0,20}kecil.{0,20}untung.{0,20}besar/i,
];

function keywordAnalyse(text) {
  for (const entry of HIGH_RISK_PATTERNS) {
    const pattern = entry?.pattern || entry;
    if (pattern instanceof RegExp && pattern.test(text)) {
      return {
        risk_level: 'HIGH',
        scam_type: entry.type || 'UNKNOWN_SCAM',
        confidence: 0.7,
        reason_bm: entry.reason_bm || 'Mesej ini mengandungi corak yang sering dikaitkan dengan penipuan.',
        reason_en: entry.reason_en || 'This message contains patterns often associated with scams.',
        extracted_phones: [],
        extracted_accounts: [],
        extracted_urls: [],
        source: 'keyword_fallback',
      };
    }
  }
  for (const entry of MEDIUM_RISK_PATTERNS) {
    const pattern = entry?.pattern || entry;
    if (pattern instanceof RegExp && pattern.test(text)) {
      return {
        risk_level: 'MEDIUM',
        scam_type: entry.type || 'UNKNOWN_SCAM',
        confidence: 0.5,
        reason_bm: entry.reason_bm || 'Mesej ini mempunyai beberapa tanda amaran yang memerlukan semakan lanjut.',
        reason_en: entry.reason_en || 'This message shows warning signs that require caution.',
        extracted_phones: [],
        extracted_accounts: [],
        extracted_urls: [],
        source: 'keyword_fallback',
      };
    }
  }
  return {
    risk_level: 'LOW',
    scam_type: null,
    confidence: 0.6,
    reason_bm: 'Tiada tanda-tanda penipuan jelas ditemui.',
    reason_en: 'No clear scam indicators found.',
    extracted_phones: [],
    extracted_accounts: [],
    extracted_urls: [],
    source: 'keyword_fallback',
  };
}

module.exports = { keywordAnalyse };
