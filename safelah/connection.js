const initSqlJs = require('sql.js');
const fs = require('fs');
const path = require('path');

const dbPath = process.env.DB_PATH || './safelah.db';
let db = null;

// sql.js is async to initialize — this promise resolves when DB is ready
const dbReady = (async () => {
  const SQL = await initSqlJs();

  // Load existing DB file if it exists, otherwise create new
  if (fs.existsSync(dbPath)) {
    const buffer = fs.readFileSync(dbPath);
    db = new SQL.Database(buffer);
  } else {
    db = new SQL.Database();
  }

  // Performance settings
  db.run('PRAGMA journal_mode = WAL');
  db.run('PRAGMA busy_timeout = 5000');
  db.run('PRAGMA synchronous = NORMAL');

  // ── Schema ─────────────────────────────────────────────────────────────────
  db.run(`
    CREATE TABLE IF NOT EXISTS users (
      phone          TEXT PRIMARY KEY,
      language       TEXT DEFAULT 'bm',
      registered_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
      checks_today   INTEGER DEFAULT 0,
      last_check_date TEXT
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS guardians (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      elderly_phone  TEXT NOT NULL,
      guardian_phone TEXT NOT NULL,
      linked_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(elderly_phone, guardian_phone)
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS registration_codes (
      code          TEXT PRIMARY KEY,
      elderly_phone TEXT NOT NULL,
      created_at    DATETIME DEFAULT CURRENT_TIMESTAMP,
      expires_at    DATETIME NOT NULL,
      used          INTEGER DEFAULT 0
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS scam_logs (
      id               INTEGER PRIMARY KEY AUTOINCREMENT,
      scam_type        TEXT,
      risk_level       TEXT,
      -- Extracted indicators (anonymised — no user phone stored)
      indicator_phone  TEXT,
      indicator_account TEXT,
      indicator_url    TEXT,
      -- Confidence score from Gemini (0.0–1.0)
      confidence       REAL DEFAULT 0,
      -- Whether user confirmed this was a real scam attempt they experienced
      user_confirmed   INTEGER DEFAULT 0,
      created_at       DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS sent_alerts (
      alert_key TEXT PRIMARY KEY,
      sent_at   DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS user_sessions (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      phone           TEXT NOT NULL,
      session_state   TEXT DEFAULT 'normal',
      batch_messages  TEXT,
      language        TEXT DEFAULT 'bm',
      created_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(phone)
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS clarification_answers (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      phone           TEXT NOT NULL,
      message_index   INTEGER NOT NULL,
      question        TEXT NOT NULL,
      user_answer     TEXT,
      created_at      DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // ── Web accounts (web UI guardian/elderly login — separate from WhatsApp users) ──
  db.run(`
    CREATE TABLE IF NOT EXISTS web_accounts (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      role           TEXT NOT NULL,        -- 'guardian' or 'elderly'
      username       TEXT UNIQUE NOT NULL,
      password       TEXT NOT NULL,        -- bcrypt hash
      phone          TEXT,                 -- optional contact number
      guardian_code  TEXT,                 -- 6-digit code issued to guardians
      guardian_id    INTEGER,              -- elderly links to guardian web_accounts.id
      created_at     DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // ── Family alerts (scam alerts pushed to guardian when elderly detects danger) ──
  db.run(`
    CREATE TABLE IF NOT EXISTS family_alerts (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      guardian_id  INTEGER NOT NULL,
      elderly_id   INTEGER NOT NULL,
      elderly_name TEXT,
      risk_level   TEXT,
      scam_type    TEXT,
      snippet      TEXT,
      is_read      INTEGER DEFAULT 0,
      created_at   DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // ── Migrations: Add missing columns to existing tables ──────────────────────
  console.log('[db] Running migrations...');
  const migrations = [
    [`ALTER TABLE user_sessions ADD COLUMN language TEXT DEFAULT 'bm'`, 'user_sessions.language'],
    [`ALTER TABLE scam_logs ADD COLUMN indicator_phone TEXT`, 'scam_logs.indicator_phone'],
    [`ALTER TABLE scam_logs ADD COLUMN indicator_account TEXT`, 'scam_logs.indicator_account'],
    [`ALTER TABLE scam_logs ADD COLUMN indicator_url TEXT`, 'scam_logs.indicator_url'],
    [`ALTER TABLE scam_logs ADD COLUMN confidence REAL DEFAULT 0`, 'scam_logs.confidence'],
    [`ALTER TABLE scam_logs ADD COLUMN user_confirmed INTEGER DEFAULT 0`, 'scam_logs.user_confirmed'],
  ];
  for (const [sql, colName] of migrations) {
    try {
      db.exec(sql);
      console.log(`[db] ✅ Migration: Added ${colName}`);
    } catch (err) {
      if (err.message && (err.message.includes('duplicate column') || err.message.includes('already exists'))) {
        // already applied — silent
      } else {
        console.warn(`[db] ⚠️  Migration warning for ${colName}:`, err.message);
      }
    }
  }

  console.log('[db] SQLite ready (sql.js) at', dbPath);
  return db;
})();

// Save DB to disk periodically and on exit
function saveDb() {
  if (!db) return;
  try {
    const data = db.export();
    const buffer = Buffer.from(data);
    fs.writeFileSync(dbPath, buffer);
  } catch (err) {
    console.error('[db] save error:', err.message);
  }
}

// Auto-save every 30 seconds
setInterval(saveDb, 30000);

// Save on exit
process.on('exit', saveDb);
process.on('SIGINT', () => { saveDb(); process.exit(); });
process.on('SIGTERM', () => { saveDb(); process.exit(); });

function getDb() {
  return db;
}

module.exports = { dbReady, getDb, saveDb };
