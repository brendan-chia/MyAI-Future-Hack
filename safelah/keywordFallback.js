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
  { pattern: /tahniah.*menang|congratulations.*won|lucky draw.*klik|hadiah.*RM\s*[\d,]+/i,
    type: 'LUCKY_DRAW',
    reason_bm: 'Mesej ini mendakwa anda memenangi hadiah — penipuan cabutan bertuah.',
    reason_en: 'This message claims you won a prize — a fake lucky draw scam.' },

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

  // Job scam upfront
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
    if (entry.pattern.test(text)) {
      return {
        risk_level: 'HIGH',
        scam_type: entry.type,
        confidence: 0.7,
        reason_bm: entry.reason_bm,
        reason_en: entry.reason_en,
        extracted_phones: [],
        extracted_accounts: [],
        extracted_urls: [],
        source: 'keyword_fallback',
      };
    }
  }
  for (const entry of MEDIUM_RISK_PATTERNS) {
    if (entry.pattern.test(text)) {
      return {
        risk_level: 'MEDIUM',
        scam_type: entry.type,
        confidence: 0.5,
        reason_bm: entry.reason_bm,
        reason_en: entry.reason_en,
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
