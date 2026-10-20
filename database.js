const { DatabaseSync } = require('node:sqlite');
const path = require('node:path');

const dbPath = path.join(__dirname, 'database.sqlite');
const db = new DatabaseSync(dbPath);

// Veritabanı performans ve kilitlenme (locked) önleme ayarları
try {
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec('PRAGMA busy_timeout = 5000;');
  db.exec('PRAGMA synchronous = NORMAL;');
} catch (e) {
  console.warn('SQLite pragma uyarısı:', e.message);
}

// Tabloları oluştur
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    user_id TEXT PRIMARY KEY,
    nickname TEXT DEFAULT NULL,
    messages INTEGER DEFAULT 0,
    voice_seconds INTEGER DEFAULT 0,
    xp INTEGER DEFAULT 0,
    level INTEGER DEFAULT 0,
    gender TEXT DEFAULT NULL,
    playstyle TEXT DEFAULT NULL,
    last_message_at INTEGER DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS pending_registrations (
    user_id TEXT PRIMARY KEY,
    gender TEXT DEFAULT NULL,
    playstyle TEXT DEFAULT NULL,
    updated_at INTEGER DEFAULT 0
  );
`);

try {
  db.exec('ALTER TABLE users ADD COLUMN nickname TEXT DEFAULT NULL;');
} catch (e) {}

// Prepared statements
const getUserStmt = db.prepare('SELECT * FROM users WHERE user_id = ?');
const insertUserStmt = db.prepare('INSERT OR IGNORE INTO users (user_id) VALUES (?)');
const updateMessageStmt = db.prepare(`
  UPDATE users 
  SET messages = messages + 1, xp = xp + ?, last_message_at = ? 
  WHERE user_id = ?
`);
const updateVoiceStmt = db.prepare(`
  UPDATE users 
  SET voice_seconds = voice_seconds + ?, xp = xp + ? 
  WHERE user_id = ?
`);
const updateLevelStmt = db.prepare('UPDATE users SET level = ? WHERE user_id = ?');
const getTopUsersStmt = db.prepare('SELECT * FROM users ORDER BY xp DESC LIMIT ?');

const getPendingStmt = db.prepare('SELECT * FROM pending_registrations WHERE user_id = ?');
const setPendingGenderStmt = db.prepare(`
  INSERT INTO pending_registrations (user_id, gender, updated_at) 
  VALUES (?, ?, ?) 
  ON CONFLICT(user_id) DO UPDATE SET gender = excluded.gender, updated_at = excluded.updated_at
`);
const setPendingPlaystyleStmt = db.prepare(`
  INSERT INTO pending_registrations (user_id, playstyle, updated_at) 
  VALUES (?, ?, ?) 
  ON CONFLICT(user_id) DO UPDATE SET playstyle = excluded.playstyle, updated_at = excluded.updated_at
`);
const clearPendingStmt = db.prepare('DELETE FROM pending_registrations WHERE user_id = ?');
const saveUserRegistrationStmt = db.prepare(`
  UPDATE users SET gender = ?, playstyle = ?, nickname = ? WHERE user_id = ?
`);
const updatePlaystyleStmt = db.prepare('UPDATE users SET playstyle = ? WHERE user_id = ?');

// Güvenli çalıştırma sarmalayıcısı (Safe execution)
function safeRun(fn, fallback = null) {
  try {
    return fn();
  } catch (err) {
    console.error('Veritabanı işlem hatası:', err.message);
    return fallback;
  }
}

module.exports = {
  getUser(userId) {
    return safeRun(() => {
      insertUserStmt.run(userId);
      return getUserStmt.get(userId);
    }, { user_id: userId, nickname: null, messages: 0, voice_seconds: 0, xp: 0, level: 0, gender: null, playstyle: null });
  },

  addMessageXp(userId, xpGain, timestamp) {
    return safeRun(() => {
      insertUserStmt.run(userId);
      updateMessageStmt.run(xpGain, timestamp, userId);
      return getUserStmt.get(userId);
    }, { user_id: userId, messages: 1, voice_seconds: 0, xp: xpGain, level: 0 });
  },

  addVoiceXp(userId, seconds, xpGain) {
    return safeRun(() => {
      insertUserStmt.run(userId);
      updateVoiceStmt.run(seconds, xpGain, userId);
      return getUserStmt.get(userId);
    }, { user_id: userId, messages: 0, voice_seconds: seconds, xp: xpGain, level: 0 });
  },

  setLevel(userId, newLevel) {
    safeRun(() => updateLevelStmt.run(newLevel, userId));
  },

  getTopUsers(limit = 10) {
    return safeRun(() => getTopUsersStmt.all(limit), []);
  },

  getPending(userId) {
    return safeRun(() => getPendingStmt.get(userId), null);
  },

  setPendingGender(userId, gender) {
    return safeRun(() => {
      setPendingGenderStmt.run(userId, gender, Date.now());
      return getPendingStmt.get(userId);
    }, { user_id: userId, gender, playstyle: null });
  },

  setPendingPlaystyle(userId, playstyle) {
    return safeRun(() => {
      setPendingPlaystyleStmt.run(userId, playstyle, Date.now());
      return getPendingStmt.get(userId);
    }, { user_id: userId, gender: null, playstyle });
  },

  completeRegistration(userId, gender, playstyle, nickname = null) {
    safeRun(() => {
      insertUserStmt.run(userId);
      saveUserRegistrationStmt.run(gender, playstyle, nickname, userId);
      clearPendingStmt.run(userId);
    });
  },

  updateUserPlaystyle(userId, playstyle) {
    safeRun(() => {
      insertUserStmt.run(userId);
      updatePlaystyleStmt.run(playstyle, userId);
    });
  }
};
