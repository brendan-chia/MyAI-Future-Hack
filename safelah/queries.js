const { getDb, saveDb } = require('./connection');

// ── Helper: get one row ──────────────────────────────────────────────────────
function getOne(sql, params = []) {
  const db = getDb();
  const stmt = db.prepare(sql);
  stmt.bind(params);
  if (stmt.step()) {
    const row = stmt.getAsObject();
    stmt.free();
    return row;
  }
  stmt.free();
  return null;
}

// ── Helper: get all rows ─────────────────────────────────────────────────────
function getAll(sql, params = []) {
  const db = getDb();
  const rows = [];
  const stmt = db.prepare(sql);
  stmt.bind(params);
  while (stmt.step()) {
    rows.push(stmt.getAsObject());
  }
  stmt.free();
  return rows;
}

// ── Helper: run a statement ──────────────────────────────────────────────────
function run(sql, params = []) {
  const db = getDb();
  db.run(sql, params);
  saveDb(); // persist after writes
}

// ── Users ────────────────────────────────────────────────────────────────────
function isFirstTimeUser(phone) {
  const user = getOne('SELECT phone FROM users WHERE phone = ?', [phone]);
  if (!user) {
    run('INSERT INTO users (phone) VALUES (?)', [phone]);
    return true;
  }
  return false;
}

function checkRateLimit(phone, maxPerHour = 10) {
  const today = new Date().toISOString().slice(0, 10);
  const user = getOne('SELECT checks_today, last_check_date FROM users WHERE phone = ?', [phone]);

  if (!user) return { allowed: true };

  // Reset counter on new day
  if (user.last_check_date !== today) {
    run('UPDATE users SET checks_today = 0, last_check_date = ? WHERE phone = ?', [today, phone]);
    return { allowed: true };
  }

  if (user.checks_today >= maxPerHour) {
    return { allowed: false };
  }

  run('UPDATE users SET checks_today = checks_today + 1, last_check_date = ? WHERE phone = ?', [today, phone]);
  return { allowed: true };
}

// ── Scam logs ────────────────────────────────────────────────────────────────

/**
 * Log enriched scam intelligence (privacy-safe — no user phone stored).
 *
 * @param {object} opts
 * @param {string}  opts.scamType        - e.g. 'JOB_SCAM'
 * @param {string}  opts.riskLevel       - 'HIGH' | 'MEDIUM' | 'LOW'
 * @param {string[]} [opts.phones]       - scammer phone numbers extracted from message
 * @param {string[]} [opts.accounts]     - bank accounts extracted from message
 * @param {string[]} [opts.urls]         - URLs extracted from message
 * @param {number}  [opts.confidence]    - Gemini confidence 0–1
 */
function logScamIntelligence({ scamType, riskLevel, phones = [], accounts = [], urls = [], confidence = 0 }) {
  run(
    `INSERT INTO scam_logs
       (scam_type, risk_level, indicator_phone, indicator_account, indicator_url, confidence)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [
      scamType || 'UNKNOWN',
      riskLevel,
      phones[0]    || null,   // store first extracted scammer number (not caller)
      accounts[0]  || null,
      urls[0]      || null,
      confidence,
    ]
  );
}

/** Backward-compat thin wrapper */
function logScam(scamType, riskLevel) {
  logScamIntelligence({ scamType, riskLevel });
}

// ── Intelligence stats (for dashboard) ───────────────────────────────────────
function getScamStats() {
  const total   = getOne('SELECT COUNT(*) as n FROM scam_logs WHERE risk_level IN ("HIGH","MEDIUM")');
  const byType  = getAll('SELECT scam_type, COUNT(*) as n FROM scam_logs WHERE risk_level IN ("HIGH","MEDIUM") GROUP BY scam_type ORDER BY n DESC');
  const recent7 = getOne(`SELECT COUNT(*) as n FROM scam_logs WHERE created_at >= date('now','-7 days') AND risk_level IN ("HIGH","MEDIUM")`);
  return { total: total?.n || 0, recent7: recent7?.n || 0, byType };
}

/** Returns rows suitable for CSV export to hand off to PDRM */
function getExportData(from, to) {
  const where = from && to
    ? `WHERE created_at BETWEEN '${from}' AND '${to}'`
    : '';
  return getAll(`
    SELECT
      id,
      scam_type,
      risk_level,
      indicator_phone,
      indicator_account,
      indicator_url,
      confidence,
      user_confirmed,
      created_at
    FROM scam_logs
    ${where}
    ORDER BY created_at DESC
  `);
}

// ── Guardian registration codes ───────────────────────────────────────────────
function createRegistrationCode(elderlyPhone, code) {
  const expires = new Date(Date.now() + 86400000).toISOString(); // 24h
  run(
    'INSERT OR REPLACE INTO registration_codes (code, elderly_phone, expires_at, used) VALUES (?, ?, ?, 0)',
    [code, elderlyPhone, expires]
  );
}

function redeemCode(code) {
  const record = getOne(
    "SELECT * FROM registration_codes WHERE code = ? AND used = 0 AND expires_at > datetime('now')",
    [code]
  );
  if (record) {
    run('UPDATE registration_codes SET used = 1 WHERE code = ?', [code]);
  }
  return record || null;
}

// ── Guardians ─────────────────────────────────────────────────────────────────
function linkGuardian(elderlyPhone, guardianPhone) {
  run('INSERT OR IGNORE INTO guardians (elderly_phone, guardian_phone) VALUES (?, ?)', [elderlyPhone, guardianPhone]);
}

function getGuardians(elderlyPhone) {
  return getAll('SELECT guardian_phone FROM guardians WHERE elderly_phone = ?', [elderlyPhone]);
}

function getGuardianCount(phone) {
  const row = getOne('SELECT COUNT(*) as cnt FROM guardians WHERE elderly_phone = ?', [phone]);
  return row?.cnt || 0;
}

// ── Alert dedup ───────────────────────────────────────────────────────────────
function wasAlertSent(key) {
  return !!getOne('SELECT 1 FROM sent_alerts WHERE alert_key = ?', [key]);
}

function markAlertSent(key) {
  run('INSERT OR IGNORE INTO sent_alerts (alert_key) VALUES (?)', [key]);
}

// ── User sessions (batch mode) ─────────────────────────────────────────────────
function getSession(phone) {
  const session = getOne('SELECT * FROM user_sessions WHERE phone = ?', [phone]);
  if (session && session.batch_messages) {
    session.batch_messages = JSON.parse(session.batch_messages);
  }
  return session;
}

function startBatchSession(phone, lang = 'en') {
  run(
    `INSERT OR REPLACE INTO user_sessions (phone, session_state, batch_messages, language, created_at, updated_at) 
     VALUES (?, 'batch_collection', '[]', ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
    [phone, lang]
  );
}

function addMessageToBatch(phone, messageText) {
  const session = getSession(phone);
  if (!session || session.session_state !== 'batch_collection') {
    return false;
  }
  
  const messages = session.batch_messages || [];
  messages.push({
    type: 'text',
    text: messageText,
    timestamp: new Date().toISOString(),
  });
  
  run(
    'UPDATE user_sessions SET batch_messages = ?, updated_at = CURRENT_TIMESTAMP WHERE phone = ?',
    [JSON.stringify(messages), phone]
  );
  return true;
}

function addImageToBatch(phone, base64Data, mimeType) {
  const session = getSession(phone);
  if (!session || session.session_state !== 'batch_collection') {
    return false;
  }
  
  const messages = session.batch_messages || [];
  messages.push({
    type: 'image',
    data: base64Data,
    mime: mimeType || 'image/jpeg',
    timestamp: new Date().toISOString(),
  });
  
  run(
    'UPDATE user_sessions SET batch_messages = ?, updated_at = CURRENT_TIMESTAMP WHERE phone = ?',
    [JSON.stringify(messages), phone]
  );
  return true;
}

function addAudioToBatch(phone, transcript) {
  const session = getSession(phone);
  if (!session || session.session_state !== 'batch_collection') {
    return false;
  }
  
  const messages = session.batch_messages || [];
  messages.push({
    type: 'audio',
    text: transcript,
    timestamp: new Date().toISOString(),
  });
  
  run(
    'UPDATE user_sessions SET batch_messages = ?, updated_at = CURRENT_TIMESTAMP WHERE phone = ?',
    [JSON.stringify(messages), phone]
  );
  return true;
}

function getBatchMessages(phone) {
  const session = getSession(phone);
  return session ? (session.batch_messages || []) : [];
}

function clearBatchSession(phone) {
  run(
    'UPDATE user_sessions SET session_state = "normal", batch_messages = "[]", updated_at = CURRENT_TIMESTAMP WHERE phone = ?',
    [phone]
  );
}

function setSessionState(phone, state) {
  run(
    'UPDATE user_sessions SET session_state = ?, updated_at = CURRENT_TIMESTAMP WHERE phone = ?',
    [state, phone]
  );
}

function saveClarificationAnswer(phone, messageIndex, question, answer) {
  run(
    'INSERT INTO clarification_answers (phone, message_index, question, user_answer) VALUES (?, ?, ?, ?)',
    [phone, messageIndex, question, answer]
  );
}

function getClarificationAnswers(phone, messageIndex) {
  return getAll(
    'SELECT question, user_answer FROM clarification_answers WHERE phone = ? AND message_index = ?',
    [phone, messageIndex]
  );
}

module.exports = {
  isFirstTimeUser,
  checkRateLimit,
  logScam,
  createRegistrationCode,
  redeemCode,
  linkGuardian,
  getGuardians,
  getGuardianCount,
  wasAlertSent,
  markAlertSent,
  getSession,
  startBatchSession,
  addMessageToBatch,
  addImageToBatch,
  addAudioToBatch,
  getBatchMessages,
  clearBatchSession,
  setSessionState,
  saveClarificationAnswer,
  getClarificationAnswers,
  logScamIntelligence,
  getScamStats,
  getExportData,
};
