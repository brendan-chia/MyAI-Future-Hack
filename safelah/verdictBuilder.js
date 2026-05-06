const SCAM_LABELS = {
  bm: {
    MACAU_SCAM:              'Penipuan Macau (Pegawai Palsu)',
    LOVE_SCAM:               'Penipuan Cinta',
    INVESTMENT_SCAM:         'Penipuan Pelaburan',
    PARCEL_SCAM:             'Penipuan Pos Laju / Parsel',
    JOB_SCAM:                'Penipuan Kerja',
    LOAN_SCAM:               'Penipuan Pinjaman',
    PHISHING_LINK:           'Pautan Pancingan Data (Phishing)',
    LUCKY_DRAW:              'Penipuan Cabutan Bertuah / Hadiah',
    CRYPTO_SCAM:             'Penipuan Kripto / Pelaburan Digital',
    FAMILY_EMERGENCY_SCAM:   'Penipuan Kecemasan Keluarga (Nombor Baru)',
    PAYMENT_SCAM:            'Penipuan Pembayaran QR / DuitNow',
    UNKNOWN_SCAM:            'Penipuan (Jenis Tidak Diketahui)',
  },
  en: {
    MACAU_SCAM:              'Macau Scam (Fake Official)',
    LOVE_SCAM:               'Love / Romance Scam',
    INVESTMENT_SCAM:         'Investment Scam',
    PARCEL_SCAM:             'Parcel / Courier Scam',
    JOB_SCAM:                'Job Scam',
    LOAN_SCAM:               'Loan Scam',
    PHISHING_LINK:           'Phishing Link',
    LUCKY_DRAW:              'Fake Lucky Draw / Prize Scam',
    CRYPTO_SCAM:             'Crypto / Digital Investment Scam',
    FAMILY_EMERGENCY_SCAM:   'Family Emergency Impersonation Scam',
    PAYMENT_SCAM:            'Fake QR Payment / DuitNow Scam',
    UNKNOWN_SCAM:            'Scam (Type Unknown)',
  },
};

function buildVerdict(analysisResult, ccidResult, lang = 'bm', vertexResult = null) {
  const { risk_level, scam_type, reason_bm, reason_en } = analysisResult;
  const label    = SCAM_LABELS[lang]?.[scam_type] || SCAM_LABELS[lang]?.UNKNOWN_SCAM || '';

  // Use vertexResult from analysisResult if not passed directly
  const vtx = vertexResult || analysisResult.vertexResult;
  const vertexNote = vtx?.found
    ? (lang === 'bm'
        ? `\n📊 ${vtx.hits} rekod sepadan ditemui dalam pangkalan data SafeLah.`
        : `\n📊 ${vtx.hits} matching record(s) found in SafeLah database.`)
    : '';

  const combinedNote = vertexNote;

  switch (risk_level) {
    case 'HIGH':   return buildHigh(lang, label, reason_bm, reason_en, combinedNote);
    case 'MEDIUM': return buildMedium(lang, label, reason_bm, reason_en, combinedNote);
    default:       return buildLow(lang);
  }
}

function buildHigh(lang, label, reasonBM, reasonEN, ccidNote) {
  const t = {
    bm: `🔴 AMARAN: Ini kemungkinan besar PENIPUAN\n\nJenis: ${label}\nSebab: ${reasonBM}${ccidNote}\n\n❌ JANGAN:\n• Transfer wang\n• Klik sebarang pautan\n• Bagi maklumat peribadi atau kata laluan\n\n✅ Sudah transfer wang? Hubungi SEGERA:\nHotline Anti-Scam: 997 (8pg-8mlm setiap hari)\nPDRM CCID: 03-2610 1559\n\nBagus sebab semak dulu! 🛡️`,
    en: `🔴 WARNING: This is likely a SCAM\n\nType: ${label}\nReason: ${reasonEN}${ccidNote}\n\n❌ DO NOT:\n• Transfer any money\n• Click any links\n• Share personal info or passwords\n\n✅ Already transferred money? Call IMMEDIATELY:\nAnti-Scam Hotline: 997 (8am-8pm daily)\nPDRM CCID: 03-2610 1559\n\nGood thing you checked first! 🛡️`,
  };
  return t[lang] || t.bm;
}

function buildMedium(lang, label, reasonBM, reasonEN, ccidNote) {
  const t = {
    bm: `⚠️ BERHATI-HATI: Mesej ini mencurigakan\n\nJenis syak: ${label}\nSebab: ${reasonBM}${ccidNote}\n\nDisyorkan:\n1. Sahkan dengan pihak berkenaan melalui nombor RASMI (bukan nombor dalam mesej ini)\n2. Tanya pendapat ahli keluarga dahulu\n\nKalau masih ragu-ragu, jangan bayar dulu.`,
    en: `⚠️ CAUTION: This message looks suspicious\n\nSuspected type: ${label}\nReason: ${reasonEN}${ccidNote}\n\nRecommended:\n1. Verify through official channels (NOT numbers in this message)\n2. Ask a family member first\n\nWhen in doubt, don't pay.`,
  };
  return t[lang] || t.bm;
}

function buildLow(lang) {
  const t = {
    bm: `✅ Mesej ini nampak selamat\n\nTiada tanda-tanda penipuan jelas ditemui.\n\nIngat: Sentiasa berhati-hati. Jangan transfer wang kepada orang yang anda tidak kenal secara peribadi.\n\nBoleh forwardkan mesej lain untuk disemak bila-bila masa. 🛡️`,
    en: `✅ This message appears safe\n\nNo clear scam indicators found.\n\nReminder: Always be careful. Never transfer money to someone you don't know personally.\n\nForward other messages anytime for checking. 🛡️`,
  };
  return t[lang] || t.bm;
}

module.exports = { buildVerdict };
