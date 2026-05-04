const axios = require('axios');

const VT_BASE = 'https://www.virustotal.com/api/v3';

// Rate limiter — free tier: 4 req/min, 500/day
let vtRequestCount = 0;
let vtWindowStart = Date.now();

function canMakeRequest() {
  const now = Date.now();
  if (now - vtWindowStart > 60000) {
    vtRequestCount = 0;
    vtWindowStart = now;
  }
  if (vtRequestCount >= 4) return false;
  vtRequestCount++;
  return true;
}

async function scanUrl(url) {
  if (!process.env.VIRUSTOTAL_API_KEY) {
    console.log('[virustotal] no API key configured, skipping');
    return null;
  }

  if (!canMakeRequest()) {
    console.log('[virustotal] rate limit reached, skipping');
    return null;
  }

  try {
    const headers = { 'x-apikey': process.env.VIRUSTOTAL_API_KEY };

    // Submit URL
    const submitRes = await axios.post(
      `${VT_BASE}/urls`,
      new URLSearchParams({ url }),
      { headers: { ...headers, 'Content-Type': 'application/x-www-form-urlencoded' } }
    );

    const analysisId = submitRes.data.data.id;
    await new Promise(r => setTimeout(r, 3000)); // wait for scan

    // Get results
    const result = await axios.get(`${VT_BASE}/analyses/${analysisId}`, { headers });
    const stats = result.data.data.attributes.stats;
    const maliciousCount = (stats.malicious || 0) + (stats.suspicious || 0);

    console.log(`[virustotal] ${url} → malicious: ${maliciousCount}`);
    return {
      is_malicious: maliciousCount >= 3,
      malicious_count: maliciousCount,
      total_engines: Object.values(stats).reduce((a, b) => a + b, 0),
      source: 'virustotal',
    };
  } catch (err) {
    console.error('[virustotal] error:', err.message);
    return null;
  }
}

module.exports = { scanUrl };
