const initSqlJs = require('sql.js');
const fs = require('fs');
const path = require('path');

const DB_PATH = path.join(__dirname, 'lms.db');

class DatabaseWrapper {
  constructor(rawDb) {
    this.db = rawDb;
  }

  save() {
    const data = this.db.export();
    const buffer = Buffer.from(data);
    fs.writeFileSync(DB_PATH, buffer);
  }

  prepare(sql) {
    return {
      run: (...params) => {
        try {
          this.db.run(sql, params);
          const lastId = this.db.exec("SELECT last_insert_rowid() as id");
          this.save();
          return { lastInsertRowid: lastId.length ? lastId[0].values[0][0] : 0, changes: this.db.getRowsModified() };
        } catch (e) { console.error('SQL Error:', e.message, sql); throw e; }
      },
      get: (...params) => {
        try {
          const stmt = this.db.prepare(sql);
          stmt.bind(params);
          if (stmt.step()) {
            const cols = stmt.getColumnNames();
            const vals = stmt.get();
            stmt.free();
            const row = {};
            cols.forEach((c, i) => row[c] = vals[i]);
            return row;
          }
          stmt.free();
          return undefined;
        } catch (e) { console.error('SQL Error:', e.message); return undefined; }
      },
      all: (...params) => {
        try {
          const stmt = this.db.prepare(sql);
          stmt.bind(params);
          const rows = [];
          while (stmt.step()) {
            const cols = stmt.getColumnNames();
            const vals = stmt.get();
            const row = {};
            cols.forEach((c, i) => row[c] = vals[i]);
            rows.push(row);
          }
          stmt.free();
          return rows;
        } catch (e) { console.error('SQL Error:', e.message); return []; }
      }
    };
  }

  exec(sql) {
    try {
      this.db.run(sql);
      this.save();
    } catch (e) { console.error('SQL Exec Error:', e.message); }
  }
}

let db;

async function initDB() {
  const SQL = await initSqlJs();
  let rawDb;
  if (fs.existsSync(DB_PATH)) {
    const buf = fs.readFileSync(DB_PATH);
    rawDb = new SQL.Database(buf);
  } else {
    rawDb = new SQL.Database();
  }
  rawDb.run('PRAGMA journal_mode = WAL');
  rawDb.run('PRAGMA foreign_keys = ON');

  db = new DatabaseWrapper(rawDb);

  const schemas = [
    `CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT UNIQUE NOT NULL,
      email TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      first_name TEXT NOT NULL,
      last_name TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'student',
      phone TEXT,
      avatar TEXT,
      status TEXT DEFAULT 'active',
      created_at TEXT DEFAULT (datetime('now'))
    )`,
    `CREATE TABLE IF NOT EXISTS categories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      description TEXT,
      color TEXT DEFAULT '#1a237e',
      sort_order INTEGER DEFAULT 0
    )`,
    `CREATE TABLE IF NOT EXISTS courses (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      course_id TEXT UNIQUE NOT NULL,
      title TEXT NOT NULL,
      description TEXT,
      category_id INTEGER,
      instructor_id INTEGER,
      thumbnail TEXT,
      difficulty TEXT DEFAULT 'beginner',
      duration_hours REAL DEFAULT 0,
      course_fee REAL DEFAULT 0,
      status TEXT DEFAULT 'draft',
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (category_id) REFERENCES categories(id),
      FOREIGN KEY (instructor_id) REFERENCES users(id)
    )`,
    `CREATE TABLE IF NOT EXISTS lessons (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      lesson_id TEXT UNIQUE NOT NULL,
      course_id TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT,
      sort_order INTEGER DEFAULT 0,
      duration_minutes INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (course_id) REFERENCES courses(course_id)
    )`,
    `CREATE TABLE IF NOT EXISTS videos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      video_id TEXT UNIQUE NOT NULL,
      lesson_id TEXT NOT NULL,
      title TEXT NOT NULL,
      filename TEXT NOT NULL,
      filepath TEXT NOT NULL,
      mime_type TEXT DEFAULT 'video/mp4',
      file_size INTEGER DEFAULT 0,
      duration_seconds INTEGER DEFAULT 0,
      batch_number INTEGER DEFAULT 1,
      batch_name TEXT DEFAULT 'Batch 1',
      upload_by INTEGER,
      status TEXT DEFAULT 'active',
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (lesson_id) REFERENCES lessons(lesson_id),
      FOREIGN KEY (upload_by) REFERENCES users(id)
    )`,
    `CREATE TABLE IF NOT EXISTS batches (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      batch_id TEXT UNIQUE NOT NULL,
      lesson_id TEXT NOT NULL,
      batch_number INTEGER NOT NULL,
      batch_name TEXT NOT NULL,
      description TEXT,
      video_count INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (lesson_id) REFERENCES lessons(lesson_id)
    )`,
    `CREATE TABLE IF NOT EXISTS enrollments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      course_id TEXT NOT NULL,
      enrolled_at TEXT DEFAULT (datetime('now')),
      status TEXT DEFAULT 'active',
      progress_pct REAL DEFAULT 0,
      payment_amount REAL DEFAULT 0,
      payment_method TEXT DEFAULT 'cash',
      payment_status TEXT DEFAULT 'pending',
      invoice_number TEXT,
      invoice_date TEXT,
      invoice_pdf TEXT,
      FOREIGN KEY (user_id) REFERENCES users(id),
      FOREIGN KEY (course_id) REFERENCES courses(course_id)
    )`,
    `CREATE TABLE IF NOT EXISTS lesson_progress (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      lesson_id TEXT NOT NULL,
      video_watched_pct REAL DEFAULT 0,
      completed INTEGER DEFAULT 0,
      last_watched_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id),
      FOREIGN KEY (lesson_id) REFERENCES lessons(lesson_id)
    )`,
    `CREATE TABLE IF NOT EXISTS quizzes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      quiz_id TEXT UNIQUE NOT NULL,
      course_id TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT,
      time_limit_minutes INTEGER DEFAULT 30,
      pass_pct REAL DEFAULT 70,
      status TEXT DEFAULT 'active',
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (course_id) REFERENCES courses(course_id)
    )`,
    `CREATE TABLE IF NOT EXISTS quiz_questions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      quiz_id TEXT NOT NULL,
      question_text TEXT NOT NULL,
      question_type TEXT DEFAULT 'multiple_choice',
      option_a TEXT,
      option_b TEXT,
      option_c TEXT,
      option_d TEXT,
      correct_answer TEXT NOT NULL,
      points INTEGER DEFAULT 1,
      sort_order INTEGER DEFAULT 0,
      FOREIGN KEY (quiz_id) REFERENCES quizzes(quiz_id)
    )`,
    `CREATE TABLE IF NOT EXISTS quiz_attempts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      quiz_id TEXT NOT NULL,
      score REAL DEFAULT 0,
      total_points INTEGER DEFAULT 0,
      earned_points REAL DEFAULT 0,
      passed INTEGER DEFAULT 0,
      answers TEXT,
      started_at TEXT DEFAULT (datetime('now')),
      completed_at TEXT,
      FOREIGN KEY (user_id) REFERENCES users(id),
      FOREIGN KEY (quiz_id) REFERENCES quizzes(quiz_id)
    )`,
    `CREATE TABLE IF NOT EXISTS batch_links (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      link_id TEXT UNIQUE NOT NULL,
      lesson_id TEXT NOT NULL,
      batch_number INTEGER DEFAULT 1,
      title TEXT NOT NULL,
      youtube_url TEXT NOT NULL,
      youtube_id TEXT,
      duration TEXT DEFAULT '',
      sort_order INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (lesson_id) REFERENCES lessons(lesson_id)
    )`
  ];

  for (const sql of schemas) {
    db.db.run(sql);
  }

  db.save();
  console.log('LMS Database initialized');
}

function saveDB() {
  if (db) db.save();
}

module.exports = { initDB, getDB: () => db, saveDB };
