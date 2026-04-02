const { sendMessage } = require('./whatsapp');
const { getGuardians, wasAlertSent, markAlertSent } = require('./queries');

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
      `🔴 Amaran Penjaga SelamatLah\n\n` +
      `Ahli keluarga anda baru sahaja menyemak mesej berisiko TINGGI.\n\n` +
      `Jenis penipuan: ${scamLabel}\n` +
      `Masa: ${time}\n\n` +
      `Sila hubungi mereka sekarang untuk pastikan mereka selamat.\n\n` +
      `(SelamatLah telah amaran mereka supaya tidak transfer wang atau klik pautan.)`;

    await sendMessage(guardian_phone, msg);
    markAlertSent(alertKey);
    console.log(`[guardian] alert sent to ${guardian_phone} for ${elderlyPhone}`);
  }
}

module.exports = { notifyGuardians };
