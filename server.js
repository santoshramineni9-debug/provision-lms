const express = require('express');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const { initDB, getDB, saveDB } = require('./db');

const app = express();
let currentUser = null;
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.static(path.join(__dirname, 'public'), { maxAge: 0, etag: false }));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

const videoStorage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, path.join(__dirname, 'uploads/videos')),
  filename: (req, file, cb) => cb(null, Date.now() + '-' + Math.floor(Math.random()*1000) + '-' + file.originalname.replace(/\s+/g, '_'))
});
const uploadVideo = multer({ storage: videoStorage, limits: { fileSize: 500 * 1024 * 1024 } });

function uid() { return 'USR' + String(Date.now()).slice(-6) + String(Math.floor(Math.random() * 1000)); }
function cid() { return 'CRS' + String(Date.now()).slice(-6) + String(Math.floor(Math.random() * 1000)); }
function lid() { return 'LES' + String(Date.now()).slice(-6) + String(Math.floor(Math.random() * 1000)); }
function vid() { return 'VID' + String(Date.now()).slice(-6) + String(Math.floor(Math.random() * 1000)); }
function qid() { return 'QUIZ' + String(Date.now()).slice(-6) + String(Math.floor(Math.random() * 1000)); }

// ========== AUTH ==========
app.post('/api/auth/login', (req, res) => {
  const { email, password } = req.body;
  const user = db.prepare('SELECT * FROM users WHERE email = ? AND password = ?').get(email, password);
  if (!user) return res.status(401).json({ error: 'Invalid credentials' });
  currentUser = user;
  const { password: _, ...safe } = user;
  res.json(safe);
});

app.post('/api/auth/register', (req, res) => {
  const { email, password, first_name, last_name, phone } = req.body;
  if (!email || !password || !first_name || !last_name) return res.status(400).json({ error: 'All fields required' });
  const exists = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
  if (exists) return res.status(400).json({ error: 'Email already registered' });
  const userId = uid();
  db.prepare('INSERT INTO users (user_id, email, password, first_name, last_name, role, phone, page_access) VALUES (?,?,?,?,?,?,?,?)').run(userId, email, password, first_name, last_name, 'student', phone || null, 'my-courses,catalog,my-quizzes,my-invoices,account');
  saveDB();
  const user = db.prepare('SELECT * FROM users WHERE user_id = ?').get(userId);
  const { password: _, ...safe } = user;
  res.json(safe);
});

// ========== USERS (Admin) ==========
app.get('/api/users', (req, res) => {
  const users = db.prepare('SELECT id, user_id, email, first_name, last_name, role, phone, status, page_access, created_at FROM users ORDER BY created_at DESC').all();
  res.json(users);
});

app.get('/api/users/:userId', (req, res) => {
  const user = db.prepare('SELECT id, user_id, email, first_name, last_name, role, phone, status, page_access, created_at FROM users WHERE user_id = ?').get(req.params.userId);
  if (!user) return res.status(404).json({ error: 'Not found' });
  res.json(user);
});

app.put('/api/users/:userId', (req, res) => {
  const { first_name, last_name, phone, role, status, page_access } = req.body;
  db.prepare('UPDATE users SET first_name=COALESCE(?,first_name), last_name=COALESCE(?,last_name), phone=COALESCE(?,phone), role=COALESCE(?,role), status=COALESCE(?,status), page_access=COALESCE(?,page_access) WHERE user_id=?').run(first_name, last_name, phone, role, status, page_access, req.params.userId);
  saveDB();
  res.json({ message: 'Updated' });
});

app.delete('/api/users/:userId', (req, res) => {
  db.prepare("UPDATE users SET status = 'inactive' WHERE user_id = ?").run(req.params.userId);
  saveDB();
  res.json({ message: 'Deactivated' });
});

app.post('/api/users', (req, res) => {
  if (!currentUser || currentUser.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
  const { email, password, first_name, last_name, phone, role, page_access } = req.body;
  if (!email || !password || !first_name || !last_name) return res.status(400).json({ error: 'Email, password, first name, last name required' });
  const exists = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
  if (exists) return res.status(400).json({ error: 'Email already exists' });
  const userId = uid();
  db.prepare('INSERT INTO users (user_id, email, password, first_name, last_name, role, phone, page_access) VALUES (?,?,?,?,?,?,?,?)').run(userId, email, password, first_name, last_name, role || 'student', phone || null, page_access || 'my-courses,catalog,my-quizzes,my-invoices,account');
  saveDB();
  res.json({ message: 'Student created', user_id: userId });
});

// ========== CATEGORIES ==========
app.get('/api/categories', (req, res) => {
  res.json(db.prepare('SELECT * FROM categories ORDER BY sort_order, name').all());
});

app.post('/api/categories', (req, res) => {
  const { name, description, color } = req.body;
  db.prepare('INSERT INTO categories (name, description, color) VALUES (?,?,?)').run(name, description || '', color || '#1a237e');
  saveDB();
  res.json({ message: 'Created', id: db.prepare('SELECT last_insert_rowid() as id').get().id });
});

app.put('/api/categories/:id', (req, res) => {
  const { name, description, color } = req.body;
  db.prepare('UPDATE categories SET name=COALESCE(?,name), description=COALESCE(?,description), color=COALESCE(?,color) WHERE id=?').run(name, description, color, req.params.id);
  saveDB();
  res.json({ message: 'Updated' });
});

app.delete('/api/categories/:id', (req, res) => {
  db.prepare('DELETE FROM categories WHERE id=?').run(req.params.id);
  saveDB();
  res.json({ message: 'Deleted' });
});

// ========== COURSES ==========
app.get('/api/courses', (req, res) => {
  const { category_id, status, instructor_id } = req.query;
  let q = `SELECT c.*, cat.name as category_name, u.first_name || ' ' || u.last_name as instructor_name,
    (SELECT COUNT(*) FROM lessons WHERE course_id = c.course_id) as lesson_count,
    (SELECT COUNT(*) FROM enrollments WHERE course_id = c.course_id AND status='active') as enrolled_count
    FROM courses c LEFT JOIN categories cat ON c.category_id = cat.id LEFT JOIN users u ON c.instructor_id = u.id WHERE 1=1`;
  const params = [];
  if (category_id) { q += ' AND c.category_id = ?'; params.push(category_id); }
  if (status) { q += ' AND c.status = ?'; params.push(status); }
  if (instructor_id) { q += ' AND c.instructor_id = ?'; params.push(instructor_id); }
  q += ' ORDER BY c.created_at DESC';
  res.json(db.prepare(q).all(...params));
});

app.get('/api/courses/:courseId', (req, res) => {
  const course = db.prepare(`SELECT c.*, cat.name as category_name, u.first_name || ' ' || u.last_name as instructor_name
    FROM courses c LEFT JOIN categories cat ON c.category_id = cat.id LEFT JOIN users u ON c.instructor_id = u.id
    WHERE c.course_id = ?`).get(req.params.courseId);
  if (!course) return res.status(404).json({ error: 'Not found' });
  course.lessons = db.prepare('SELECT * FROM lessons WHERE course_id = ? ORDER BY sort_order').all(req.params.courseId);
  for (const lesson of course.lessons) {
    lesson.videos = db.prepare('SELECT video_id, title, duration_seconds, status, batch_number, batch_name FROM videos WHERE lesson_id = ? ORDER BY batch_number, created_at').all(lesson.lesson_id);
    lesson.batches = db.prepare('SELECT * FROM batches WHERE lesson_id = ? ORDER BY batch_number').all(lesson.lesson_id);
    lesson.links = db.prepare('SELECT * FROM batch_links WHERE lesson_id = ? ORDER BY batch_number, sort_order').all(lesson.lesson_id);
  }
  course.quizzes = db.prepare('SELECT quiz_id, title, time_limit_minutes, pass_pct, status FROM quizzes WHERE course_id = ?').all(req.params.courseId);
  res.json(course);
});

app.post('/api/courses', (req, res) => {
  const { title, description, category_id, instructor_id, difficulty, duration_hours, course_fee, status } = req.body;
  const courseId = cid();
  db.prepare('INSERT INTO courses (course_id, title, description, category_id, instructor_id, difficulty, duration_hours, course_fee, status) VALUES (?,?,?,?,?,?,?,?,?)').run(courseId, title, description || '', category_id || null, instructor_id || null, difficulty || 'beginner', duration_hours || 0, course_fee || 0, status || 'draft');
  saveDB();
  res.json({ course_id: courseId, message: 'Course created' });
});

app.put('/api/courses/:courseId', (req, res) => {
  const { title, description, category_id, instructor_id, difficulty, duration_hours, course_fee, status, thumbnail } = req.body;
  db.prepare(`UPDATE courses SET title=COALESCE(?,title), description=COALESCE(?,description), category_id=COALESCE(?,category_id),
    instructor_id=COALESCE(?,instructor_id), difficulty=COALESCE(?,difficulty), duration_hours=COALESCE(?,duration_hours),
    course_fee=COALESCE(?,course_fee), status=COALESCE(?,status), thumbnail=COALESCE(?,thumbnail) WHERE course_id=?`).run(title, description, category_id, instructor_id, difficulty, duration_hours, course_fee, status, thumbnail, req.params.courseId);
  saveDB();
  res.json({ message: 'Updated' });
});

app.delete('/api/courses/:courseId', (req, res) => {
  db.prepare("UPDATE courses SET status = 'archived' WHERE course_id = ?").run(req.params.courseId);
  saveDB();
  res.json({ message: 'Archived' });
});

// ========== LESSONS ==========
app.post('/api/lessons', (req, res) => {
  const { course_id, title, description, sort_order, duration_minutes } = req.body;
  const lessonId = lid();
  db.prepare('INSERT INTO lessons (lesson_id, course_id, title, description, sort_order, duration_minutes) VALUES (?,?,?,?,?,?)').run(lessonId, course_id, title, description || '', sort_order || 0, duration_minutes || 0);
  saveDB();
  res.json({ lesson_id: lessonId, message: 'Lesson created' });
});

app.put('/api/lessons/:lessonId', (req, res) => {
  const { title, description, sort_order, duration_minutes } = req.body;
  db.prepare('UPDATE lessons SET title=COALESCE(?,title), description=COALESCE(?,description), sort_order=COALESCE(?,sort_order), duration_minutes=COALESCE(?,duration_minutes) WHERE lesson_id=?').run(title, description, sort_order, duration_minutes, req.params.lessonId);
  saveDB();
  res.json({ message: 'Updated' });
});

app.delete('/api/lessons/:lessonId', (req, res) => {
  db.prepare('DELETE FROM videos WHERE lesson_id = ?').run(req.params.lessonId);
  db.prepare('DELETE FROM batches WHERE lesson_id = ?').run(req.params.lessonId);
  db.prepare('DELETE FROM lessons WHERE lesson_id = ?').run(req.params.lessonId);
  saveDB();
  res.json({ message: 'Lesson deleted' });
});

// ========== BATCHES ==========
app.get('/api/batches', (req, res) => {
  const { lesson_id } = req.query;
  let q = 'SELECT * FROM batches';
  const params = [];
  if (lesson_id) { q += ' WHERE lesson_id = ?'; params.push(lesson_id); }
  q += ' ORDER BY batch_number ASC';
  res.json(db.prepare(q).all(...params));
});

app.get('/api/batches/:batchId', (req, res) => {
  const batch = db.prepare('SELECT * FROM batches WHERE batch_id = ?').get(req.params.batchId);
  if (!batch) return res.status(404).json({ error: 'Not found' });
  batch.videos = db.prepare('SELECT * FROM videos WHERE lesson_id = ? AND batch_number = ? ORDER BY id').all(batch.lesson_id, batch.batch_number);
  res.json(batch);
});

app.delete('/api/batches/:batchId', (req, res) => {
  const batch = db.prepare('SELECT * FROM batches WHERE batch_id = ?').get(req.params.batchId);
  if (!batch) return res.status(404).json({ error: 'Not found' });
  const videos = db.prepare('SELECT * FROM videos WHERE lesson_id = ? AND batch_number = ?').all(batch.lesson_id, batch.batch_number);
  for (const v of videos) {
    const fpath = path.join(__dirname, v.filepath);
    if (fs.existsSync(fpath)) fs.unlinkSync(fpath);
  }
  db.prepare('DELETE FROM videos WHERE lesson_id = ? AND batch_number = ?').run(batch.lesson_id, batch.batch_number);
  db.prepare('DELETE FROM batches WHERE batch_id = ?').run(req.params.batchId);
  saveDB();
  res.json({ message: 'Batch and ' + videos.length + ' video(s) deleted' });
});

// ========== VIDEOS ==========
app.post('/api/videos/upload', uploadVideo.array('videos', 50), (req, res) => {
  if (!req.files || !req.files.length) return res.status(400).json({ error: 'No files uploaded' });
  const { lesson_id, batch_number, batch_name, title } = req.body;
  const batchNum = parseInt(batch_number) || 1;
  const batchNm = batch_name || 'Batch ' + batchNum;

  const results = [];
  for (const file of req.files) {
    const videoId = vid();
    const videoTitle = title ? title + ' - ' + file.originalname : file.originalname;
    db.prepare('INSERT INTO videos (video_id, lesson_id, title, filename, filepath, mime_type, file_size, batch_number, batch_name, upload_by) VALUES (?,?,?,?,?,?,?,?,?,?)').run(videoId, lesson_id, videoTitle, file.filename, '/uploads/videos/' + file.filename, file.mimetype, file.size, batchNum, batchNm, null);
    results.push({ video_id: videoId, filename: file.filename, size: file.size });
  }

  // Create or update batch record
  const existingBatch = db.prepare('SELECT id FROM batches WHERE lesson_id = ? AND batch_number = ?').get(lesson_id, batchNum);
  if (existingBatch) {
    db.prepare('UPDATE batches SET video_count = (SELECT COUNT(*) FROM videos WHERE lesson_id = ? AND batch_number = ?), batch_name = ? WHERE id = ?').run(lesson_id, batchNum, batchNm, existingBatch.id);
  } else {
    const batchId = 'BATCH' + String(Date.now()).slice(-6) + String(Math.floor(Math.random() * 1000));
    db.prepare('INSERT INTO batches (batch_id, lesson_id, batch_number, batch_name, video_count) VALUES (?,?,?,?,?)').run(batchId, lesson_id, batchNum, batchNm, results.length);
  }

  saveDB();
  res.json({ message: results.length + ' video(s) uploaded to ' + batchNm, count: results.length, batch_name: batchNm, videos: results });
});

app.get('/api/videos/:videoId', (req, res) => {
  const video = db.prepare('SELECT * FROM videos WHERE video_id = ?').get(req.params.videoId);
  if (!video) return res.status(404).json({ error: 'Not found' });
  res.json(video);
});

app.delete('/api/videos/:videoId', (req, res) => {
  const video = db.prepare('SELECT * FROM videos WHERE video_id = ?').get(req.params.videoId);
  if (video) {
    const fpath = path.join(__dirname, video.filepath);
    if (fs.existsSync(fpath)) fs.unlinkSync(fpath);
  }
  db.prepare('DELETE FROM videos WHERE video_id = ?').run(req.params.videoId);
  saveDB();
  res.json({ message: 'Deleted' });
});

// Stream video — NO download, range request for seeking
app.get('/api/stream/:videoId', (req, res) => {
  const video = db.prepare('SELECT * FROM videos WHERE video_id = ?').get(req.params.videoId);
  if (!video) return res.status(404).json({ error: 'Not found' });
  const filePath = path.join(__dirname, video.filepath);
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'File missing' });
  const stat = fs.statSync(filePath);
  const fileSize = stat.size;
  const range = req.headers.range;
  if (range) {
    const parts = range.replace(/bytes=/, '').split('-');
    const start = parseInt(parts[0], 10);
    const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
    const chunkSize = end - start + 1;
    const stream = fs.createReadStream(filePath, { start, end });
    res.writeHead(206, {
      'Content-Range': `bytes ${start}-${end}/${fileSize}`,
      'Accept-Ranges': 'bytes',
      'Content-Length': chunkSize,
      'Content-Type': video.mime_type || 'video/mp4',
      'Content-Disposition': 'inline',
      'X-Content-Type-Options': 'nosniff'
    });
    stream.pipe(res);
  } else {
    res.writeHead(200, {
      'Content-Length': fileSize,
      'Content-Type': video.mime_type || 'video/mp4',
      'Content-Disposition': 'inline',
      'Accept-Ranges': 'bytes',
      'X-Content-Type-Options': 'nosniff'
    });
    fs.createReadStream(filePath).pipe(res);
  }
});

// ========== BATCH LINKS (YouTube) ==========
function extractYouTubeId(url) {
  const patterns = [
    /(?:youtube\.com\/watch\?v=)([a-zA-Z0-9_-]{11})/,
    /(?:youtu\.be\/)([a-zA-Z0-9_-]{11})/,
    /(?:youtube\.com\/embed\/)([a-zA-Z0-9_-]{11})/,
    /(?:youtube\.com\/v\/)([a-zA-Z0-9_-]{11})/,
    /^([a-zA-Z0-9_-]{11})$/
  ];
  for (const p of patterns) {
    const m = url.match(p);
    if (m) return m[1];
  }
  return null;
}

function lid2() { return 'LNK' + String(Date.now()).slice(-6) + String(Math.floor(Math.random() * 1000)); }

app.get('/api/batch-links', (req, res) => {
  const { lesson_id, batch_number } = req.query;
  let q = 'SELECT * FROM batch_links WHERE 1=1';
  const params = [];
  if (lesson_id) { q += ' AND lesson_id = ?'; params.push(lesson_id); }
  if (batch_number) { q += ' AND batch_number = ?'; params.push(parseInt(batch_number)); }
  q += ' ORDER BY batch_number, sort_order';
  res.json(db.prepare(q).all(...params));
});

app.post('/api/batch-links', (req, res) => {
  const { lesson_id, batch_number, title, youtube_url, duration, description } = req.body;
  if (!lesson_id || !youtube_url || !title) return res.status(400).json({ error: 'lesson_id, title, youtube_url required' });
  const youtubeId = extractYouTubeId(youtube_url);
  if (!youtubeId) return res.status(400).json({ error: 'Invalid YouTube URL. Use: youtube.com/watch?v=..., youtu.be/..., or video ID directly' });
  const linkId = lid2();
  const maxOrder = db.prepare('SELECT MAX(sort_order) as m FROM batch_links WHERE lesson_id = ? AND batch_number = ?').get(lesson_id, batch_number || 1);
  const sortOrder = (maxOrder?.m || 0) + 1;
  db.prepare('INSERT INTO batch_links (link_id, lesson_id, batch_number, title, description, youtube_url, youtube_id, duration, sort_order) VALUES (?,?,?,?,?,?,?,?,?)').run(linkId, lesson_id, batch_number || 1, title, description || '', youtube_url, youtubeId, duration || '', sortOrder);
  saveDB();
  res.json({ link_id: linkId, youtube_id: youtubeId, message: 'Link added' });
});

app.put('/api/batch-links/:linkId', (req, res) => {
  const { title, youtube_url, duration, sort_order, description } = req.body;
  let youtubeId = null;
  if (youtube_url) {
    youtubeId = extractYouTubeId(youtube_url);
    if (!youtubeId) return res.status(400).json({ error: 'Invalid YouTube URL' });
  }
  db.prepare('UPDATE batch_links SET title=COALESCE(?,title), description=COALESCE(?,description), youtube_url=COALESCE(?,youtube_url), youtube_id=COALESCE(?,youtube_id), duration=COALESCE(?,duration), sort_order=COALESCE(?,sort_order) WHERE link_id=?').run(title, description, youtube_url, youtubeId, duration, sort_order, req.params.linkId);
  saveDB();
  res.json({ message: 'Updated' });
});

app.delete('/api/batch-links/:linkId', (req, res) => {
  db.prepare('DELETE FROM batch_links WHERE link_id = ?').run(req.params.linkId);
  saveDB();
  res.json({ message: 'Link deleted' });
});

// ========== ENROLLMENTS ==========
app.post('/api/enrollments', (req, res) => {
  const { user_id, course_id, payment_amount, payment_method } = req.body;
  const exists = db.prepare('SELECT id FROM enrollments WHERE user_id = ? AND course_id = ? AND status = ?').get(user_id, course_id, 'active');
  if (exists) return res.status(400).json({ error: 'Already enrolled' });

  const course = db.prepare('SELECT * FROM courses WHERE course_id = ?').get(course_id);
  const student = db.prepare('SELECT * FROM users WHERE id = ?').get(user_id);
  const invoiceNum = 'INV-' + Date.now().toString().slice(-8);
  const invoiceDate = new Date().toISOString().slice(0, 10);
  const amount = payment_amount || (course ? course.course_fee : 0);
  const method = payment_method || 'cash';

  db.prepare('INSERT INTO enrollments (user_id, course_id, payment_amount, payment_method, payment_status, invoice_number, invoice_date) VALUES (?,?,?,?,?,?,?)').run(user_id, course_id, amount, method, amount > 0 ? 'paid' : 'free', invoiceNum, invoiceDate);

  // Generate Invoice PDF
  const PDFDocument = require('pdfkit');
  const invoicesDir = path.join(__dirname, 'uploads', 'invoices');
  if (!fs.existsSync(invoicesDir)) fs.mkdirSync(invoicesDir, { recursive: true });
  const pdfFilename = invoiceNum + '.pdf';
  const pdfPath = path.join(invoicesDir, pdfFilename);

  const doc = new PDFDocument({ margin: 50 });
  const stream = fs.createWriteStream(pdfPath);
  doc.pipe(stream);

  // Header
  doc.fontSize(22).font('Helvetica-Bold').fillColor('#1a237e').text('INVOICE', 50, 50);
  doc.fontSize(10).font('Helvetica').fillColor('#666');
  doc.text('Student LMS - Learning Management System', 50, 78);
  doc.text('Email: prcmarcalling@gmail.com', 50, 92);

  // Invoice info
  doc.fontSize(11).font('Helvetica-Bold').fillColor('#333');
  doc.text('Invoice #: ' + invoiceNum, 400, 50, { align: 'right' });
  doc.text('Date: ' + invoiceDate, 400, 65, { align: 'right' });
  doc.text('Status: PAID', 400, 80, { align: 'right' });

  // Divider
  doc.moveTo(50, 110).lineTo(550, 110).stroke('#1a237e');

  // Bill To
  doc.fontSize(11).font('Helvetica-Bold').fillColor('#1a237e').text('BILL TO:', 50, 125);
  doc.fontSize(10).font('Helvetica').fillColor('#333');
  doc.text('Student: ' + (student ? student.first_name + ' ' + student.last_name : 'N/A'), 50, 142);
  doc.text('Email: ' + (student ? student.email : 'N/A'), 50, 156);
  doc.text('Phone: ' + (student ? (student.phone || 'N/A') : 'N/A'), 50, 170);
  doc.text('Student ID: ' + (student ? student.user_id : 'N/A'), 50, 184);

  // Course Details
  doc.fontSize(11).font('Helvetica-Bold').fillColor('#1a237e').text('COURSE DETAILS:', 50, 210);
  doc.fontSize(10).font('Helvetica').fillColor('#333');
  doc.text('Course: ' + (course ? course.title : 'N/A'), 50, 227);
  doc.text('Difficulty: ' + (course ? course.difficulty : 'N/A'), 50, 241);
  doc.text('Duration: ' + (course ? course.duration_hours + ' hours' : 'N/A'), 50, 255);
  doc.text('Category: ' + (course ? (course.category_id || 'N/A') : 'N/A'), 50, 269);

  // Table header
  let y = 300;
  doc.rect(50, y, 500, 22).fill('#1a237e');
  doc.fontSize(10).font('Helvetica-Bold').fillColor('#fff');
  doc.text('Description', 55, y + 5);
  doc.text('Amount', 420, y + 5, { align: 'right' });

  // Table row
  y += 28;
  doc.rect(50, y, 500, 20).fill('#f5f5f5');
  doc.font('Helvetica').fillColor('#333');
  doc.text('Course Enrollment Fee - ' + (course ? course.title : ''), 55, y + 4);
  doc.text('$' + (amount ? amount.toFixed(2) : '0.00'), 420, y + 4, { align: 'right' });

  // Payment method row
  y += 24;
  doc.text('Payment Method: ' + method.toUpperCase(), 55, y + 4);

  // Total
  y += 35;
  doc.moveTo(50, y).lineTo(550, y).stroke('#ccc');
  y += 10;
  doc.fontSize(12).font('Helvetica-Bold').fillColor('#1a237e');
  doc.text('TOTAL PAID: $' + (amount ? amount.toFixed(2) : '0.00'), 50, y, { align: 'right' });

  // Footer
  y += 50;
  doc.moveTo(50, y).lineTo(550, y).stroke('#1a237e');
  y += 15;
  doc.fontSize(8).font('Helvetica').fillColor('#888');
  doc.text('This is a computer-generated invoice. No signature required.', 50, y, { align: 'center', width: 500 });
  doc.text('Thank you for enrolling! For queries contact prcmarcalling@gmail.com', 50, y + 14, { align: 'center', width: 500 });

  doc.end();
  stream.on('finish', () => {
    db.prepare('UPDATE enrollments SET invoice_pdf = ? WHERE invoice_number = ?').run('/uploads/invoices/' + pdfFilename, invoiceNum);
    saveDB();
  });

  saveDB();
  res.json({ message: 'Enrolled & invoice generated', invoice_number: invoiceNum, invoice_pdf: '/uploads/invoices/' + pdfFilename, payment_status: amount > 0 ? 'paid' : 'free' });
});

app.get('/api/enrollments', (req, res) => {
  const { user_id, course_id } = req.query;
  let q = `SELECT e.*, c.title as course_title, c.course_fee, u.first_name || ' ' || u.last_name as student_name, u.email as student_email, u.phone as student_phone
    FROM enrollments e JOIN courses c ON e.course_id = c.course_id JOIN users u ON e.user_id = u.id WHERE e.status != 'dropped'`;
  const params = [];
  if (user_id) { q += ' AND e.user_id = ?'; params.push(user_id); }
  if (course_id) { q += ' AND e.course_id = ?'; params.push(course_id); }
  q += ' ORDER BY e.enrolled_at DESC';
  res.json(db.prepare(q).all(...params));
});

// Get invoice PDF
app.get('/api/invoices/:invoiceNumber', (req, res) => {
  const enrollment = db.prepare('SELECT * FROM enrollments WHERE invoice_number = ?').get(req.params.invoiceNumber);
  if (!enrollment || !enrollment.invoice_pdf) return res.status(404).json({ error: 'Invoice not found' });
  const pdfPath = path.join(__dirname, enrollment.invoice_pdf);
  if (!fs.existsSync(pdfPath)) return res.status(404).json({ error: 'PDF file missing' });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', 'inline; filename="' + req.params.invoiceNumber + '.pdf"');
  fs.createReadStream(pdfPath).pipe(res);
});

// Get all invoices (admin)
app.get('/api/invoices', (req, res) => {
  const invoices = db.prepare(`SELECT e.invoice_number, e.invoice_date, e.payment_amount, e.payment_method, e.payment_status,
    u.first_name || ' ' || u.last_name as student_name, u.email as student_email, u.phone as student_phone,
    c.title as course_title
    FROM enrollments e JOIN courses c ON e.course_id = c.course_id JOIN users u ON e.user_id = u.id
    WHERE e.invoice_number IS NOT NULL ORDER BY e.enrolled_at DESC`).all();
  res.json(invoices);
});

app.delete('/api/enrollments/:id', (req, res) => {
  db.prepare("UPDATE enrollments SET status = 'dropped' WHERE id = ?").run(req.params.id);
  saveDB();
  res.json({ message: 'Dropped' });
});

// ========== LESSON PROGRESS ==========
app.post('/api/progress', (req, res) => {
  const { user_id, lesson_id, video_watched_pct } = req.body;
  const existing = db.prepare('SELECT id FROM lesson_progress WHERE user_id = ? AND lesson_id = ?').get(user_id, lesson_id);
  if (existing) {
    db.prepare('UPDATE lesson_progress SET video_watched_pct = MAX(video_watched_pct, ?), completed = CASE WHEN ? >= 90 THEN 1 ELSE completed END, last_watched_at = datetime("now") WHERE id = ?').run(video_watched_pct || 0, video_watched_pct || 0, existing.id);
  } else {
    db.prepare('INSERT INTO lesson_progress (user_id, lesson_id, video_watched_pct, completed) VALUES (?,?,?,?)').run(user_id, lesson_id, video_watched_pct || 0, (video_watched_pct || 0) >= 90 ? 1 : 0);
  }
  // Update course enrollment progress
  const lesson = db.prepare('SELECT course_id FROM lessons WHERE lesson_id = ?').get(lesson_id);
  if (lesson) {
    const total = db.prepare('SELECT COUNT(*) as c FROM lessons WHERE course_id = ?').get(lesson.course_id).c;
    const completed = db.prepare('SELECT COUNT(*) as c FROM lesson_progress WHERE user_id = ? AND lesson_id IN (SELECT lesson_id FROM lessons WHERE course_id = ?) AND completed = 1').get(user_id, lesson.course_id).c;
    const pct = total > 0 ? Math.round((completed / total) * 100) : 0;
    db.prepare('UPDATE enrollments SET progress_pct = ? WHERE user_id = ? AND course_id = ?').run(pct, user_id, lesson.course_id);
  }
  saveDB();
  res.json({ message: 'Progress updated' });
});

app.get('/api/progress', (req, res) => {
  const { user_id, course_id } = req.query;
  let q = `SELECT lp.*, l.title as lesson_title FROM lesson_progress lp JOIN lessons l ON lp.lesson_id = l.lesson_id WHERE lp.user_id = ?`;
  const params = [user_id];
  if (course_id) { q += ' AND l.course_id = ?'; params.push(course_id); }
  res.json(db.prepare(q).all(...params));
});

// ========== QUIZZES ==========
app.get('/api/quizzes', (req, res) => {
  const { course_id, course_ids } = req.query;
  let q = `SELECT q.*, c.title as course_title, (SELECT COUNT(*) FROM quiz_questions WHERE quiz_id = q.quiz_id) as question_count
    FROM quizzes q JOIN courses c ON q.course_id = c.course_id WHERE 1=1`;
  const params = [];
  if (course_id) { q += ' AND q.course_id = ?'; params.push(course_id); }
  if (course_ids) {
    const ids = course_ids.split(',').filter(Boolean);
    if (ids.length) { q += ' AND q.course_id IN (' + ids.map(() => '?').join(',') + ')'; params.push(...ids); }
  }
  q += ' ORDER BY q.created_at DESC';
  res.json(db.prepare(q).all(...params));
});

app.get('/api/quizzes/:quizId', (req, res) => {
  const quiz = db.prepare('SELECT q.*, c.title as course_title FROM quizzes q JOIN courses c ON q.course_id = c.course_id WHERE q.quiz_id = ?').get(req.params.quizId);
  if (!quiz) return res.status(404).json({ error: 'Not found' });
  quiz.questions = db.prepare('SELECT * FROM quiz_questions WHERE quiz_id = ? ORDER BY sort_order').all(req.params.quizId);
  res.json(quiz);
});

app.post('/api/quizzes', (req, res) => {
  const { course_id, title, description, time_limit_minutes, pass_pct, questions } = req.body;
  const quizId = qid();
  db.prepare('INSERT INTO quizzes (quiz_id, course_id, title, description, time_limit_minutes, pass_pct) VALUES (?,?,?,?,?,?)').run(quizId, course_id, title, description || '', time_limit_minutes || 30, pass_pct || 70);
  if (questions && questions.length) {
    const ins = db.prepare('INSERT INTO quiz_questions (quiz_id, question_text, option_a, option_b, option_c, option_d, correct_answer, points, sort_order) VALUES (?,?,?,?,?,?,?,?,?)');
    questions.forEach((q, i) => {
      ins.run(quizId, q.question_text, q.option_a, q.option_b, q.option_c, q.option_d, q.correct_answer, q.points || 1, i + 1);
    });
  }
  saveDB();
  res.json({ quiz_id: quizId, message: 'Quiz created' });
});

app.put('/api/quizzes/:quizId', (req, res) => {
  const { title, description, time_limit_minutes, pass_pct, status } = req.body;
  db.prepare('UPDATE quizzes SET title=COALESCE(?,title), description=COALESCE(?,description), time_limit_minutes=COALESCE(?,time_limit_minutes), pass_pct=COALESCE(?,pass_pct), status=COALESCE(?,status) WHERE quiz_id=?').run(title, description, time_limit_minutes, pass_pct, status, req.params.quizId);
  saveDB();
  res.json({ message: 'Updated' });
});

app.delete('/api/quizzes/:quizId', (req, res) => {
  db.prepare('DELETE FROM quiz_questions WHERE quiz_id = ?').run(req.params.quizId);
  db.prepare('DELETE FROM quizzes WHERE quiz_id = ?').run(req.params.quizId);
  saveDB();
  res.json({ message: 'Deleted' });
});

// Submit quiz attempt
app.post('/api/quizzes/:quizId/submit', (req, res) => {
  const { user_id, answers } = req.body;
  const quiz = db.prepare('SELECT * FROM quizzes WHERE quiz_id = ?').get(req.params.quizId);
  if (!quiz) return res.status(404).json({ error: 'Quiz not found' });
  const questions = db.prepare('SELECT * FROM quiz_questions WHERE quiz_id = ?').all(req.params.quizId);
  let earnedPoints = 0;
  let totalPoints = 0;
  const results = [];
  questions.forEach(q => {
    totalPoints += q.points;
    const userAnswer = answers[q.id] || '';
    const isCorrect = userAnswer.toUpperCase() === q.correct_answer.toUpperCase();
    if (isCorrect) earnedPoints += q.points;
    results.push({ question_id: q.id, correct: isCorrect, correct_answer: q.correct_answer, user_answer: userAnswer });
  });
  const score = totalPoints > 0 ? Math.round((earnedPoints / totalPoints) * 100) : 0;
  const passed = score >= quiz.pass_pct ? 1 : 0;
  db.prepare('INSERT INTO quiz_attempts (user_id, quiz_id, score, total_points, earned_points, passed, answers, completed_at) VALUES (?,?,?,?,?,?,?,datetime("now"))').run(user_id, req.params.quizId, score, totalPoints, earnedPoints, passed, JSON.stringify(results));
  saveDB();
  res.json({ score, total_points: totalPoints, earned_points: earnedPoints, passed: !!passed, pass_pct: quiz.pass_pct, results });
});

// Quiz attempts
app.get('/api/quizzes/:quizId/attempts', (req, res) => {
  const { user_id } = req.query;
  let q = `SELECT qa.*, u.first_name || ' ' || u.last_name as student_name FROM quiz_attempts qa JOIN users u ON qa.user_id = u.id WHERE qa.quiz_id = ?`;
  const params = [req.params.quizId];
  if (user_id) { q += ' AND qa.user_id = ?'; params.push(user_id); }
  q += ' ORDER BY qa.started_at DESC';
  res.json(db.prepare(q).all(...params));
});

// ========== ENROLLMENT REPORT ==========
app.get('/api/reports/enrollments', (req, res) => {
  const { course_id, status } = req.query;
  let q = `SELECT e.*, c.title as course_title, c.course_fee, c.difficulty,
    u.first_name || ' ' || u.last_name as student_name, u.email as student_email, u.phone as student_phone, u.user_id as student_user_id,
    cat.name as category_name
    FROM enrollments e
    JOIN courses c ON e.course_id = c.course_id
    JOIN users u ON e.user_id = u.id
    LEFT JOIN categories cat ON c.category_id = cat.id
    WHERE 1=1`;
  const params = [];
  if (course_id) { q += ' AND e.course_id = ?'; params.push(course_id); }
  if (status) { q += ' AND e.status = ?'; params.push(status); }
  q += ' ORDER BY e.enrolled_at DESC';
  const enrollments = db.prepare(q).all(...params);
  const summary = {
    total: enrollments.length,
    active: enrollments.filter(e => e.status === 'active').length,
    dropped: enrollments.filter(e => e.status === 'dropped').length,
    totalRevenue: enrollments.reduce((s, e) => s + (e.payment_amount || 0), 0),
    paidCount: enrollments.filter(e => e.payment_status === 'paid').length,
    pendingCount: enrollments.filter(e => e.payment_status === 'pending').length,
    freeCount: enrollments.filter(e => e.payment_status === 'free' || e.payment_status === 'free').length
  };
  res.json({ enrollments, summary });
});

// ========== DUES REPORT ==========
app.get('/api/reports/dues', (req, res) => {
  let q = `SELECT e.*, c.title as course_title, c.course_fee,
    u.first_name || ' ' || u.last_name as student_name, u.email as student_email, u.phone as student_phone, u.user_id as student_user_id
    FROM enrollments e
    JOIN courses c ON e.course_id = c.course_id
    JOIN users u ON e.user_id = u.id
    WHERE e.status = 'active' AND e.payment_status != 'paid'
    ORDER BY e.enrolled_at DESC`;
  const dues = db.prepare(q).all();
  const summary = {
    totalDues: dues.length,
    totalPendingAmount: dues.reduce((s, e) => s + (e.payment_amount || 0), 0),
    byStudent: {}
  };
  dues.forEach(d => {
    if (!summary.byStudent[d.student_name]) summary.byStudent[d.student_name] = { name: d.student_name, email: d.student_email, phone: d.student_phone, count: 0, amount: 0 };
    summary.byStudent[d.student_name].count++;
    summary.byStudent[d.student_name].amount += (d.payment_amount || 0);
  });
  res.json({ dues, summary });
});

// ========== ONBOARDING ==========
app.get('/api/onboarding/videos', (req, res) => {
  const setting = db.prepare("SELECT value FROM settings WHERE key = 'onboarding_videos'").get();
  const single = db.prepare("SELECT value FROM settings WHERE key = 'onboarding_video_url'").get();
  if (setting && setting.value) {
    try { res.json(JSON.parse(setting.value)); return; } catch(e) {}
  }
  const url = single ? single.value : 'https://www.youtube.com/watch?v=E3B12pGWBUg';
  res.json([{ title: 'Introduction to LMS', url: url, youtube_id: extractYouTubeId(url) || 'E3B12pGWBUg' }]);
});

app.post('/api/onboarding/videos', (req, res) => {
  if (!currentUser || currentUser.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
  const { videos } = req.body;
  if (!Array.isArray(videos)) return res.status(400).json({ error: 'videos array required' });
  const cleaned = videos.map(v => {
    const ytId = extractYouTubeId(v.url);
    return { title: v.title || 'Untitled', url: v.url, youtube_id: ytId || null };
  }).filter(v => v.youtube_id);
  db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('onboarding_videos', ?)").run(JSON.stringify(cleaned));
  saveDB();
  res.json({ message: 'Onboarding videos updated', count: cleaned.length });
});

app.post('/api/onboarding/complete', (req, res) => {
  const { user_id } = req.body;
  db.prepare('UPDATE users SET onboarding_watched = 1 WHERE id = ?').run(user_id);
  saveDB();
  res.json({ message: 'Onboarding completed' });
});

// ========== DASHBOARD STATS ==========
app.get('/api/stats', (req, res) => {
  const totalStudents = db.prepare("SELECT COUNT(*) as c FROM users WHERE role='student' AND status='active'").get().c;
  const totalCourses = db.prepare("SELECT COUNT(*) as c FROM courses WHERE status != 'archived'").get().c;
  const totalVideos = db.prepare('SELECT COUNT(*) as c FROM videos').get().c;
  const totalEnrollments = db.prepare("SELECT COUNT(*) as c FROM enrollments WHERE status='active'").get().c;
  const totalQuizzes = db.prepare('SELECT COUNT(*) as c FROM quizzes').get().c;
  const recentEnrollments = db.prepare(`SELECT e.*, u.first_name || ' ' || u.last_name as student_name, c.title as course_title
    FROM enrollments e JOIN users u ON e.user_id = u.id JOIN courses c ON e.course_id = c.course_id
    ORDER BY e.enrolled_at DESC LIMIT 5`).all();
  const topCourses = db.prepare(`SELECT c.*, (SELECT COUNT(*) FROM enrollments WHERE course_id = c.course_id AND status='active') as enrolled_count
    FROM courses c WHERE c.status='published' ORDER BY enrolled_count DESC LIMIT 5`).all();
  res.json({ totalStudents, totalCourses, totalVideos, totalEnrollments, totalQuizzes, recentEnrollments, topCourses });
});

// Catch-all
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const PORT = process.env.PORT || 3001;
let db;
async function start() {
  await initDB();
  db = getDB();

  try { db.prepare("ALTER TABLE videos ADD COLUMN batch_number INTEGER DEFAULT 1").run(); } catch(e) {}
  try { db.prepare("ALTER TABLE videos ADD COLUMN batch_name TEXT DEFAULT 'Batch 1'").run(); } catch(e) {}

  // Payment/invoice columns
  try { db.prepare("ALTER TABLE courses ADD COLUMN course_fee REAL DEFAULT 0").run(); } catch(e) {}
  try { db.prepare("ALTER TABLE enrollments ADD COLUMN payment_amount REAL DEFAULT 0").run(); } catch(e) {}
  try { db.prepare("ALTER TABLE enrollments ADD COLUMN payment_method TEXT DEFAULT 'cash'").run(); } catch(e) {}
  try { db.prepare("ALTER TABLE enrollments ADD COLUMN payment_status TEXT DEFAULT 'pending'").run(); } catch(e) {}
  try { db.prepare("ALTER TABLE enrollments ADD COLUMN invoice_number TEXT").run(); } catch(e) {}
  try { db.prepare("ALTER TABLE enrollments ADD COLUMN invoice_date TEXT").run(); } catch(e) {}
  try { db.prepare("ALTER TABLE enrollments ADD COLUMN invoice_pdf TEXT").run(); } catch(e) {}
  try { db.prepare("ALTER TABLE users ADD COLUMN onboarding_watched INTEGER DEFAULT 0").run(); } catch(e) {}
  try { db.prepare("ALTER TABLE users ADD COLUMN onboarding_video_url TEXT").run(); } catch(e) {}
  try { db.prepare("ALTER TABLE users ADD COLUMN page_access TEXT DEFAULT '*'").run(); } catch(e) {}
  try { db.prepare("ALTER TABLE batch_links ADD COLUMN description TEXT").run(); } catch(e) {}
  // Onboarding settings table
  db.prepare(`CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT
  )`).run();
  // Seed admin if not exists
  const admin = db.prepare("SELECT id FROM users WHERE role='admin' LIMIT 1").get();
  if (!admin) {
    db.prepare("INSERT INTO users (user_id, email, password, first_name, last_name, role) VALUES (?,?,?,?,?,?)").run(uid(), 'admin@lms.com', 'admin123', 'System', 'Administrator', 'admin');
    db.prepare("INSERT INTO users (user_id, email, password, first_name, last_name, role) VALUES (?,?,?,?,?,?)").run(uid(), 'trainer@lms.com', 'trainer123', 'John', 'Trainer', 'instructor');
    // Seed categories
    db.prepare("INSERT INTO categories (name, description, color) VALUES (?,?,?)").run('Programming', 'Software development courses', '#1a237e');
    db.prepare("INSERT INTO categories (name, description, color) VALUES (?,?,?)").run('Data Science', 'Data analytics and ML', '#2e7d32');
    db.prepare("INSERT INTO categories (name, description, color) VALUES (?,?,?)").run('Business', 'Business and management', '#e65100');
    db.prepare("INSERT INTO categories (name, description, color) VALUES (?,?,?)").run('Design', 'UI/UX and graphic design', '#7b1fa2');
    // Seed students
    db.prepare("INSERT INTO users (user_id, email, password, first_name, last_name, role) VALUES (?,?,?,?,?,?)").run(uid(), 'alice@student.com', 'student123', 'Alice', 'Johnson', 'student');
    db.prepare("INSERT INTO users (user_id, email, password, first_name, last_name, role) VALUES (?,?,?,?,?,?)").run(uid(), 'bob@student.com', 'student123', 'Bob', 'Smith', 'student');
    db.prepare("INSERT INTO users (user_id, email, password, first_name, last_name, role) VALUES (?,?,?,?,?,?)").run(uid(), 'carol@student.com', 'student123', 'Carol', 'Williams', 'student');
    saveDB();
    console.log('Seeded admin, instructor, students, categories');
  }
  ['uploads', 'uploads/videos', 'uploads/invoices'].forEach(dir => {
    const p = path.join(__dirname, dir);
    if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
  });
  app.listen(PORT, '0.0.0.0', () => console.log(`LMS running on http://localhost:${PORT}`));
}
start().catch(console.error);
