const axios = require('axios');
const cheerio = require('cheerio');
const { CookieJar } = require('tough-cookie');
const { wrapper } = require('axios-cookiejar-support');

const CCID_BASE = 'https://semakmule.rmp.gov.my';

// Simple in-memory cache — avoids hammering CCID and hitting rate limits
const cache = new Map();
const CACHE_TTL = 3600000; // 1 hour

async function checkSemakMule(value, category = 'phone') {
  const cacheKey = `${category}:${value}`;
  const cached = cache.get(cacheKey);
  if (cached && Date.now() - cached.time < CACHE_TTL) {
    console.log(`[ccid] cache hit for ${cacheKey}`);
    return cached.data;
  }

  try {
    // Fresh cookie jar per request (CCID requires valid session)
    const jar = new CookieJar();
    const client = wrapper(axios.create({ jar, timeout: 8000 }));

    // Step 1: GET homepage to establish session cookie
    await client.get(CCID_BASE);

    // Step 2: POST the check form
    const catMap = { phone: '1', bank: '2', company: '3' };
    const params = new URLSearchParams();
    params.append('cat', catMap[category] || '1');
    params.append('val', value);

    const response = await client.post(`${CCID_BASE}/index.php`, params, {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    });

    const $ = cheerio.load(response.data);

    // Try multiple selectors — CCID occasionally updates their layout
    const alertDanger = $('.alert-danger').length > 0;
    const resultText = $('.result-count, .report-count, #result').text().trim();
    const reportCount = parseInt(resultText.match(/\d+/)?.[0]) || 0;
    const isListed = alertDanger || reportCount > 0;

    const result = {
      found: isListed,
      reports: reportCount,
      source: 'ccid_semakmule',
      checked_at: new Date().toISOString(),
    };

    cache.set(cacheKey, { data: result, time: Date.now() });
    console.log(`[ccid] ${value} → found: ${result.found}, reports: ${result.reports}`);
    return result;
  } catch (err) {
    console.error('[ccid] scraper error:', err.message);
    // Graceful degradation — CCID being down must not crash the bot
    return { found: false, reports: 0, source: 'ccid_unavailable' };
  }
}

module.exports = { checkSemakMule };
