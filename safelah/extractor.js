// Malaysian phone: 01X-XXXXXXXX, 03-XXXXXXXX, +601X...
const PHONE_REGEX = /(?:\+?60|0)(?:1[0-9][\s-]?[0-9]{7,8}|[3-9][\s-]?[0-9]{7,8})/g;

// Bank account: 10–16 digit strings
const BANK_ACCOUNT_REGEX = /\b\d{10,16}\b/g;

// URLs
const URL_REGEX = /https?:\/\/[^\s]+|www\.[^\s]+/gi;

// Government agencies — key Macau scam signal
const GOV_AGENCY_REGEX = /\b(PDRM|polis|Polis Diraja|Bank Negara|BNM|LHDN|Jabatan Kastam|kastam|SPRM|MACC|mahkamah|court|JPJ|KWSP|EPF|Jabatan Imigresen|MyEG|SSM|MCMC|Suruhanjaya)\b/i;

function extractEntities(text) {
  const phones   = [...new Set((text.match(PHONE_REGEX) || []).map(p => p.replace(/[\s-]/g, '')))];
  const rawAccts = text.match(BANK_ACCOUNT_REGEX) || [];
  // Filter phone numbers out of bank accounts (they overlap numerically)
  const accounts = rawAccts.filter(a => !phones.some(p => p.includes(a)));
  const urls     = [...new Set(text.match(URL_REGEX) || [])];
  const mentionsGovAgency = GOV_AGENCY_REGEX.test(text);

  return { phones, accounts, urls, mentionsGovAgency };
}

module.exports = { extractEntities };
