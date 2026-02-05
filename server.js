const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
const http = require('http');
const socketIO = require('socket.io');
const nodemailer = require('nodemailer'); 
require('dotenv').config();

const app = express();
const server = http.createServer(app);
const io = socketIO(server, {
  cors: { origin: '*', methods: ['GET', 'POST'] }
});

app.use(cors());
app.use(express.json());

// 1. DATABASE CONNECTION
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

// 2. EMAIL SETUP (GMAIL) - FULLY OPTIMIZED FOR RENDER
// Port 465 (SSL) use kar rahe hain jo timeout issues kam karta hai
const transporter = nodemailer.createTransport({
  host: 'smtp.gmail.com',
  port: 465, 
  secure: true, // Port 465 ke liye ye TRUE hona zaroori hai
  auth: {
    user: process.env.EMAIL_USER, 
    pass: process.env.EMAIL_PASS // Tera App Password
  },
  tls: {
    // Ye zaroori hai taaki server certificate reject na kare
    rejectUnauthorized: false 
  },
  // Timeout settings badha di hain taaki connection jaldi close na ho
  connectionTimeout: 20000, // 20 seconds
  greetingTimeout: 20000,
  socketTimeout: 20000,
  debug: true, // Logs mein details dikhegi
  logger: true // Logs mein details dikhegi
});

// Check DB Connection
pool.connect((err, client, release) => {
  if (err) {
    console.error('❌ Database Error:', err.stack);
  } else {
    console.log('✅ Database Connected Successfully');
    release();
  }
});

// ==========================================
// 🚀 AUTHENTICATION & PROFILE
// ==========================================

// SEND OTP (Email Wala)
app.post('/api/auth/send-otp', async (req, res) => {
  try {
    const { email } = req.body;
    
    // College Email Check
    if (!email || !email.endsWith('@LJKU.edu.in')) {
      return res.status(400).json({ error: 'Only @LJKU.edu.in emails allowed' });
    }
    
    const existingUser = await pool.query('SELECT id FROM users WHERE email = $1', [email]);
    
    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000);
    
    await pool.query('DELETE FROM otps WHERE email = $1', [email]);
    await pool.query('INSERT INTO otps (email, otp, expires_at) VALUES ($1, $2, $3)', [email, otp, expiresAt]);
    
    const mailOptions = {
      from: `"AfterClasses Security" <${process.env.EMAIL_USER}>`, 
      to: email,
      subject: 'Login OTP - AfterClasses',
      text: `Your OTP is: ${otp}. Valid for 5 minutes.`
    };

    console.log(`⏳ Attempting to send OTP to ${email} via Port 465...`);
    
    // Email send karte waqt wait karega
    await transporter.sendMail(mailOptions);
    console.log(`✅ OTP sent successfully to ${email}`);
    
    res.json({ 
      success: true, 
      message: 'OTP sent to email',
      isNewUser: existingUser.rows.length === 0,
      otp: otp // Debugging ke liye (Demo mein agar mail fail ho toh console mein dikh jayega)
    });

  } catch (error) {
    console.error('❌ Send OTP FAILED:', error);
    res.status(500).json({ 
        error: 'Failed to send OTP. Network Error.',
        details: error.message 
    });
  }
});

// VERIFY OTP
app.post('/api/auth/verify-otp', async (req, res) => {
  try {
    const { email, otp } = req.body;
    const otpRecord = await pool.query('SELECT * FROM otps WHERE email = $1 ORDER BY created_at DESC LIMIT 1', [email]);
    
    if (otpRecord.rows.length === 0) return res.status(400).json({ error: 'No OTP found' });
    
    const record = otpRecord.rows[0];
    if (new Date() > new Date(record.expires_at)) return res.status(400).json({ error: 'OTP expired' });
    if (record.otp !== otp) return res.status(400).json({ error: 'Wrong OTP' });
    
    const user = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
    await pool.query('DELETE FROM otps WHERE id = $1', [record.id]);
    
    if (user.rows.length === 0) {
      res.json({ success: true, isNewUser: true });
    } else {
      res.json({ success: true, isNewUser: false, user: user.rows[0] });
    }
  } catch (error) {
    res.status(500).json({ error: 'Verification failed' });
  }
});

// CREATE PROFILE
app.post('/api/users/create-profile', async (req, res) => {
  try {
    const { email, name, gender, pitchLine, personality, toxicTraits, interests, avatar } = req.body;
    
    const result = await pool.query(
      `INSERT INTO users (email, name, gender, pitch_line, personality, toxic_traits, interests, avatar, coins) 
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 400) RETURNING *`,
      [email, name, gender, pitchLine, personality || [], toxicTraits || [], interests || [], avatar]
    );
    res.json({ success: true, user: result.rows[0] });
  } catch (error) {
    console.error('Create Profile Error:', error);
    res.status(500).json({ error: 'Database error' });
  }
});

// ==========================================
// 💘 MATCHING & APPROACH
// ==========================================

app.get('/api/match/suggestions', async (req, res) => {
  try {
    const { userId, gender } = req.query;
    const result = await pool.query(
      `SELECT * FROM users WHERE gender != $1 AND id != $2 ORDER BY created_at DESC LIMIT 20`,
      [gender, userId]
    );
    res.json({ users: result.rows });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch matches' });
  }
});

app.post('/api/match/approach', async (req, res) => {
  try {
    const { fromUserId, toUserId, requestLine } = req.body;
    
    const userRes = await pool.query('SELECT coins FROM users WHERE id = $1', [fromUserId]);
    if (userRes.rows[0].coins < 10) return res.status(400).json({ error: 'Not enough coins' });

    await pool.query('UPDATE users SET coins = coins - 10 WHERE id = $1', [fromUserId]);
    await pool.query('INSERT INTO approaches (from_user_id, to_user_id, request_line) VALUES ($1, $2, $3)', [fromUserId, toUserId, requestLine]);
    
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Approach failed' });
  }
});

// ==========================================
// 🌍 EXTRA FEATURES
// ==========================================

app.get('/api/showups/active', async (req, res) => {
  try {
    const result = await pool.query(`SELECT s.*, u.name as creator_name, u.avatar as creator_avatar FROM showups s JOIN users u ON s.creator_id = u.id WHERE s.is_active = true`);
    res.json({ showups: result.rows });
  } catch (error) {
    res.json({ showups: [] }); 
  }
});

app.get('/api/buildroom/posts', async (req, res) => {
  try {
    const result = await pool.query(`SELECT p.*, u.name as creator_name FROM buildroom_posts p JOIN users u ON p.creator_id = u.id`);
    res.json({ posts: result.rows });
  } catch (error) {
    res.json({ posts: [] });
  }
});

app.get('/api/vent/posts', async (req, res) => {
  try {
    const { category } = req.query;
    const result = await pool.query(`SELECT * FROM vent_posts WHERE category = $1`, [category]);
    res.json({ posts: result.rows });
  } catch (error) {
    res.json({ posts: [] });
  }
});

app.get('/api/skillmates', async (req, res) => {
  try {
    const result = await pool.query(`SELECT s.*, u.name, u.avatar FROM skillmates s JOIN users u ON s.user_id = u.id`);
    res.json({ skillmates: result.rows });
  } catch (error) {
    res.json({ skillmates: [] });
  }
});

// ==========================================
// 🏁 START SERVER
// ==========================================

app.get('/', (req, res) => {
  res.json({ status: 'AfterClasses API is Live & Running!' });
});

const PORT = process.env.PORT || 10000;
server.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
