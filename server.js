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

// ==========================================
// 1. DATABASE CONNECTION (Supabase)
// ==========================================
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

pool.connect((err, client, release) => {
  if (err) {
    console.error('❌ Database Connection Failed:', err.stack);
  } else {
    console.log('✅ Database Connected Successfully');
    release();
  }
});

// ==========================================
// 2. EMAIL SETUP (BREVO SMTP - PROFESSIONAL)
// ==========================================
const transporter = nodemailer.createTransport({
  host: "smtp-relay.brevo.com",
  port: 587,
  secure: false, // STARTTLS
  auth: {
    user: process.env.EMAIL_USER, // a1ab02001@smtp-brevo.com
    pass: process.env.EMAIL_PASS  // Teri Brevo API Key
  }
});

transporter.verify((error, success) => {
  if (error) {
    console.log('❌ Brevo Email Error:', error);
  } else {
    console.log('✅ Brevo System Ready - Emails will be sent securely');
  }
});

// ==========================================
// 3. AUTHENTICATION (SECURE SEND OTP)
// ==========================================
app.post('/api/auth/send-otp', async (req, res) => {
  try {
    const { email } = req.body;
    
    // Validate Domain
    if (!email || !email.endsWith('@LJKU.edu.in')) {
      return res.status(400).json({ error: 'Only @LJKU.edu.in emails allowed' });
    }
    
    const existingUser = await pool.query('SELECT id FROM users WHERE email = $1', [email]);
    
    // Generate OTP
    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000);
    
    // Save OTP to DB
    await pool.query('DELETE FROM otps WHERE email = $1', [email]);
    await pool.query('INSERT INTO otps (email, otp, expires_at) VALUES ($1, $2, $3)', [email, otp, expiresAt]);
    
    console.log(`⏳ Sending OTP to ${email} via Brevo...`);

    // Send Email
    const mailOptions = {
      from: '"AfterClasses Team" <mayankgupta244231@gmail.com>',
      to: email,
      subject: 'Your Login OTP - AfterClasses',
      text: `Your OTP is: ${otp}. Valid for 5 minutes.`
    };

    transporter.sendMail(mailOptions)
      .then(info => console.log(`✅ Email Sent: ${info.messageId}`))
      .catch(err => console.error("❌ Email Failed:", err));
    
    // RESPONSE (SECURE: NO OTP IN RESPONSE)
    // Maine yahan se 'otp' variable hata diya hai. Ab hack karke bhi koi OTP nahi dekh payega.
    res.json({ 
      success: true, 
      message: 'OTP sent to your email! Please check your inbox.',
      isNewUser: existingUser.rows.length === 0
    });

  } catch (error) {
    console.error('❌ SEND OTP SERVER ERROR:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// ==========================================
// 4. VERIFY OTP
// ==========================================
app.post('/api/auth/verify-otp', async (req, res) => {
  try {
    const { email, otp } = req.body;
    const otpRecord = await pool.query('SELECT * FROM otps WHERE email = $1 ORDER BY created_at DESC LIMIT 1', [email]);
    
    if (otpRecord.rows.length === 0) return res.status(400).json({ error: 'No OTP found' });
    
    const record = otpRecord.rows[0];
    if (new Date() > new Date(record.expires_at)) return res.status(400).json({ error: 'OTP expired' });
    if (record.otp !== otp) return res.status(400).json({ error: 'Wrong OTP' });
    
    const user = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
    
    // Delete used OTP
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

// ==========================================
// 5. CREATE PROFILE
// ==========================================
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
// 6. MATCHING & OTHER ROUTES
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

// Placeholders to prevent frontend crashes
app.get('/api/showups/active', async (req, res) => res.json({ showups: [] }));
app.get('/api/buildroom/posts', async (req, res) => res.json({ posts: [] }));
app.get('/api/vent/posts', async (req, res) => res.json({ posts: [] }));
app.get('/api/skillmates', async (req, res) => res.json({ skillmates: [] }));

// ==========================================
// SERVER START
// ==========================================
const PORT = process.env.PORT || 10000;
server.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
