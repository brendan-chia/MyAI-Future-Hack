const { sendMessage } = require('../whatsapp');
const { getGuardians, wasAlertSent, markAlertSent } = require('../queries');

const SCAM_LABELS_BM = {
  MACAU_SCAM:      'Penipuan Macau (Pegawai Palsu)',
  LOVE_SCAM:       'Penipuan Cinta',
  INVESTMENT_SCAM: 'Penipuan Pelaburan',
  PARCEL_SCAM:     'Penipuan Pos Laju',
  JOB_SCAM:        'Penipuan Kerja',
  LOAN_SCAM:       'Penipuan Pinjaman',
  PHISHING_LINK:   'Pautan Pancingan Data',
  LUCKY_DRAW:      'Penipuan Cabutan Bertuah',
  CRYPTO_SCAM:     'Penipuan Kripto',
  UNKNOWN_SCAM:    'Penipuan',
};

async function notifyGuardians(elderlyPhone, scamType) {
  const guardians = getGuardians(elderlyPhone);
  if (!guardians.length) return;

  const scamLabel = SCAM_LABELS_BM[scamType] || 'Penipuan';
  const time = new Date().toLocaleTimeString('ms-MY', { hour: '2-digit', minute: '2-digit' });

  for (const { guardian_phone } of guardians) {
    // Dedup: one alert per elderly-guardian pair per 5-minute window
    const alertKey = `${elderlyPhone}:${guardian_phone}:${Math.floor(Date.now() / 300000)}`;
    if (wasAlertSent(alertKey)) {
      console.log(`[guardian] alert already sent for key ${alertKey}, skipping`);
      continue;
    }

    const msg =
      `🔴 SafeLah Guardian Alert\n\n` +
      `Your family member just checked a HIGH-risk message.\n\n` +
      `Scam type: ${scamLabel}\n` +
      `Time: ${time}\n\n` +
      `Please contact them now to make sure they are safe.\n\n` +
      `(SafeLah has already warned them not to transfer money or click links.)`;

    await sendMessage(guardian_phone, msg);
    markAlertSent(alertKey);
    console.log(`[guardian] alert sent to ${guardian_phone} for ${elderlyPhone}`);
  }
}

module.exports = { notifyGuardians };
