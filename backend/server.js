// ============================================================
// SWASTHYA BANDHU - Backend Server
// Voice: Bhashini API (ASR + TTS) | DB: Supabase + SQLite
// ============================================================

const express = require('express');
const cors = require('cors');
const Database = require('better-sqlite3');
const bcryptjs = require('bcryptjs');
const jwt = require('jsonwebtoken');
const path = require('path');
require('dotenv').config();

const crypto = require('crypto');
const TRANSLATIONS = require('./translations');
const { generateRecoveryPlan, handleVoiceInteraction, extractVoiceIntentToFHIR, convertPlanToFHIR } = require('./aiService');
const { makeAutomatedCall, CALL_TEMPLATES } = require('./twilioService');
const { bhashiniTTS, bhashiniASR, bhashiniTranslate, LANGUAGE_CODE_MAP } = require('./bhashiniService');
const googleTTS = require('google-tts-api');

// Audio cache for Twilio Webhooks
const twilioAudioCache = new Map();

// ── Supabase Client ─────────────────────────────────────────────────────────
let supabase = null;
try {
  const { createClient } = require('@supabase/supabase-js');
  if (process.env.SUPABASE_URL && process.env.SUPABASE_ANON_KEY &&
      !process.env.SUPABASE_URL.includes('your-project')) {
    supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);
    console.log('✅ Supabase client initialized');
  } else {
    console.log('⚠️ Supabase env not set – using SQLite fallback');
  }
} catch (e) {
  console.warn('⚠️ Supabase package not installed. Run: npm install @supabase/supabase-js');
}

const app = express();
const db = new Database(path.join(__dirname, 'database.db'));


// Enable foreign keys
db.pragma('foreign_keys = ON');

// ===== MIDDLEWARE =====
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true })); // Required for Twilio Webhooks

// ===== DATABASE INITIALIZATION =====
const initDatabase = () => {
  try {
    // Users table
    db.exec(`
      CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT UNIQUE NOT NULL,
        email TEXT UNIQUE NOT NULL,
        password TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Daily check-ins
    db.exec(`
      CREATE TABLE IF NOT EXISTS checkins (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        date TEXT NOT NULL,
        water_intake INTEGER DEFAULT 0,
        medicine_taken BOOLEAN DEFAULT 0,
        sleep_hours REAL DEFAULT 0,
        symptoms TEXT,
        mood TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(user_id) REFERENCES users(id),
        UNIQUE(user_id, date)
      )
    `);

    // AI suggestions
    db.exec(`
      CREATE TABLE IF NOT EXISTS suggestions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        suggestion TEXT NOT NULL,
        type TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(user_id) REFERENCES users(id)
      )
    `);

    // Voice Reminders
    db.exec(`
      CREATE TABLE IF NOT EXISTS reminders (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        time TEXT NOT NULL,
        text TEXT NOT NULL,
        type TEXT DEFAULT 'medicine',
        completed BOOLEAN DEFAULT 0,
        completed_at DATETIME,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(user_id) REFERENCES users(id)
      )
    `);

    // Voice Logs
    db.exec(`
      CREATE TABLE IF NOT EXISTS voice_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        reminder_id INTEGER,
        response TEXT,
        message TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(user_id) REFERENCES users(id),
        FOREIGN KEY(reminder_id) REFERENCES reminders(id)
      )
    `);

    // Recovery Plans 
    db.exec(`
      CREATE TABLE IF NOT EXISTS recovery_plans (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER UNIQUE NOT NULL,
        plan_json TEXT NOT NULL,
        food_preference TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(user_id) REFERENCES users(id)
      )
    `);

    // Patient New Symptoms (Mapped to Supabase patient_id)
    db.exec(`
      CREATE TABLE IF NOT EXISTS patient_symptoms_summary (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        patient_id INTEGER NOT NULL UNIQUE,
        summary TEXT NOT NULL,
        feels_better BOOLEAN DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    console.log('✅ Database tables initialized!');
  } catch (err) {
    console.error('❌ Database init error:', err);
  }
};

initDatabase();

// ===== HEALTH CHECK ENDPOINT =====
app.get('/api/health', (req, res) => {
  res.json({
    status: 'Server is running',
    timestamp: new Date().toISOString(),
    version: '1.0.0'
  });
});

app.get('/', (req, res) => {
  res.json({
    message: 'Swasthya Bandhu API is running',
    endpoints: [
      'POST /api/auth/register',
      'POST /api/auth/login',
      'POST /api/checkin',
      'GET /api/dashboard/stats',
      'POST /api/reminders',
      'GET /api/reminders'
    ]
  });
});

// ===== AUTHENTICATION ROUTES =====

// Register
app.post('/api/auth/register', (req, res) => {
  const { username, email, password } = req.body;

  if (!username || !email || !password) {
    return res.status(400).json({ error: 'All fields required' });
  }

  try {
    const hashedPassword = bcryptjs.hashSync(password, 8);
    
    const stmt = db.prepare(
      `INSERT INTO users (username, email, password) VALUES (?, ?, ?)`
    );
    stmt.run(username, email, hashedPassword);
    
    res.status(201).json({ message: 'User registered successfully' });
  } catch (err) {
    res.status(400).json({ error: 'User already exists' });
  }
});

// Login
app.post('/api/auth/login', (req, res) => {
  const { email, password } = req.body;

  try {
    const stmt = db.prepare(`SELECT * FROM users WHERE email = ?`);
    const user = stmt.get(email);

    if (!user) {
      return res.status(400).json({ error: 'User not found' });
    }

    const passwordMatch = bcryptjs.compareSync(password, user.password);
    if (!passwordMatch) {
      return res.status(400).json({ error: 'Wrong password' });
    }

    const token = jwt.sign(
      { id: user.id, email: user.email },
      process.env.JWT_SECRET || 'secret_key_123',
      { expiresIn: '24h' }
    );

    res.json({
      message: 'Login successful',
      token,
      userId: user.id,
      username: user.username,
      email: user.email
    });
  } catch (err) {
    res.status(500).json({ error: 'Login error' });
  }
});

// ===== MIDDLEWARE: VERIFY TOKEN =====
const verifyToken = (req, res, next) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) {
    return res.status(401).json({ error: 'No token provided' });
  }

  // ALLOW DEMO BYPASS TOKEN
  if (token.includes('token_demo')) {
    req.userId = 1; // Map to the seeded demo user ID
    return next();
  }

  jwt.verify(token, process.env.JWT_SECRET || 'secret_key_123', (err, decoded) => {
    if (err) {
      return res.status(401).json({ error: 'Invalid token' });
    }
    req.userId = decoded.id;
    next();
  });
};

// ===== CHECK-IN ROUTES =====

app.post('/api/checkin', verifyToken, async (req, res) => {
  const { water_intake, medicine_taken, sleep_hours, symptoms, mood } = req.body;
  const today = new Date().toISOString().split('T')[0];

  try {
    // Use INSERT OR REPLACE to handle the UNIQUE(user_id, date) constraint gracefully
    // This allows patients to update their check-in for today without a crash
    const stmt = db.prepare(
      `INSERT OR REPLACE INTO checkins (user_id, date, water_intake, medicine_taken, sleep_hours, symptoms, mood)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    );
    
    const result = stmt.run(
      req.userId,
      today,
      water_intake || 0,
      medicine_taken ? 1 : 0,
      sleep_hours || 0,
      symptoms || '',
      mood || 'good'
    );

    // Call Gemini to get personalized AI recovery advice
    const apiKey = process.env.GEMINI_API_KEY;
    console.log(`[Checkin] Calling Gemini AI. API Key present: ${!!apiKey}, Key prefix: ${apiKey ? apiKey.substring(0, 8) + '...' : 'MISSING'}`);

    const prompt = `
      A patient recovering post-discharge just submitted their daily check-in:
      - Water Intake: ${water_intake} Liters
      - Medicine Taken: ${medicine_taken ? 'Yes' : 'No'}
      - Sleep: ${sleep_hours} hours
      - Pain Level / Symptoms: ${symptoms || 'None recorded'}
      
      Provide exactly 3 short, personalized, empathetic, and actionable medical recovery tips in plain text based on these metrics. Separate each tip by a newline character. Do not use bullet points or numbering.
    `;
    
    let adviceList = [];
    try {
      const { GoogleGenerativeAI } = require('@google/generative-ai');
      const genAI = new GoogleGenerativeAI(apiKey);
      const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });
      const aiRes = await model.generateContent(prompt);
      const text = aiRes.response.text();
      console.log('[Checkin] Gemini AI response received, length:', text.length);
      adviceList = text
        .split('\n')
        .filter(line => line.trim().length > 0)
        .map(line => line.replace(/^[-*•] /, '').replace(/^\d+\.\s*/, '').trim())
        .filter(line => line.length > 0)
        .slice(0, 3);
    } catch (err) {
      console.error('[Checkin] Gemini AI error — using fallback advice. Error details:', err.message || err);
      if (err.status) console.error('[Checkin] HTTP Status:', err.status);
      // Human-readable fallback advice
      adviceList = [
        water_intake < 2 ? "Try to drink at least 2 liters of water today to support your recovery." : "Great effort on hydration! Keep maintaining your water intake throughout the day.",
        medicine_taken ? "Excellent! Taking your prescribed medicine on time is the most important step in your recovery." : "\u26a0\ufe0f Please take your prescribed medicine as soon as possible — it is critical for your recovery.",
        sleep_hours < 6 ? "You need more rest. Aim for at least 7-8 hours of sleep to help your body heal faster." : "Good sleep habits are helping your body recover. Keep maintaining a consistent sleep schedule."
      ];
    }

    // Save suggestions to DB
    const suggStmt = db.prepare(`INSERT INTO suggestions (user_id, suggestion, type) VALUES (?, ?, ?)`);
    adviceList.forEach(sugg => {
      suggStmt.run(req.userId, sugg, 'ai-insight');
    });

    res.json({
      message: 'Check-in saved successfully',
      checkinId: result.lastInsertRowid,
      date: today,
      advice: adviceList 
    });
  } catch (err) {
    console.error('[Checkin] Fatal check-in error:', err);
    res.status(500).json({ error: 'Failed to save check-in: ' + err.message });
  }
});

app.post('/api/checkin/new-symptoms', verifyToken, async (req, res) => {
  const { patientId, rawSymptoms, feelsBetter } = req.body;
  if (!patientId || !rawSymptoms) {
    return res.status(400).json({ error: 'patientId and rawSymptoms are required' });
  }
  
  try {
    // ── Step 1: Generate AI summary via Gemini ──────────────────────────────
    let summary = rawSymptoms.trim(); // fallback: use raw text if Gemini fails
    try {
      const { GoogleGenerativeAI } = require('@google/generative-ai');
      const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
      const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });
      const prompt = `Summarize the following patient-reported symptoms into a concise medical phrase (5-10 words max) suitable for a hospital dashboard. Be specific. Only reply with the summary phrase itself, no quotes.\n\nSymptoms: "${rawSymptoms}"`;
      const aiRes = await model.generateContent(prompt);
      let aiSummary = aiRes.response.text().trim();
      if (aiSummary.startsWith('"') && aiSummary.endsWith('"')) aiSummary = aiSummary.slice(1, -1);
      if (aiSummary) summary = aiSummary;
      console.log(`[Symptoms] Gemini AI summary for patient ${patientId}: "${summary}"`);
    } catch (geminiErr) {
      console.warn('[Symptoms] Gemini failed, using raw text as fallback:', geminiErr.message);
    }

    // ── Step 2: Save to local SQLite (upsert) ──────────────────────────────
    const stmt = db.prepare(`
      INSERT INTO patient_symptoms_summary (patient_id, summary, feels_better, created_at)
      VALUES (?, ?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(patient_id) DO UPDATE SET summary=excluded.summary, feels_better=excluded.feels_better, created_at=CURRENT_TIMESTAMP
    `);
    stmt.run(parseInt(patientId), summary, feelsBetter ? 1 : 0);

    // ── Step 3: UPSERT AI summary into Supabase patient_data.symptoms ──────
    // Overwrites previous symptoms so hospital dashboard always shows latest.
    if (supabase) {
      try {
        const { error: supaErr } = await supabase
          .from('patient_data')
          .update({ symptoms: summary })
          .eq('id', parseInt(patientId));
        if (supaErr) {
          console.warn('[Symptoms] Supabase update warning (column may not exist yet):', supaErr.message);
        } else {
          console.log(`[Symptoms] ✅ Supabase patient_data.symptoms updated for patient ${patientId}`);
        }
      } catch (supaEx) {
        console.warn('[Symptoms] Could not write to Supabase:', supaEx.message);
      }
    }
    
    res.json({ success: true, summary });
  } catch (error) {
    console.error('Symptom Summarization Error:', error);
    res.status(500).json({ error: 'Failed to summarize symptoms' });
  }
});

app.get('/api/checkin/today', verifyToken, (req, res) => {
  const today = new Date().toISOString().split('T')[0];

  try {
    const stmt = db.prepare(
      `SELECT * FROM checkins WHERE user_id = ? AND date = ?`
    );
    const row = stmt.get(req.userId, today);
    res.json(row || null);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch check-in' });
  }
});

app.get('/api/checkin/week', verifyToken, (req, res) => {
  const sevenDaysAgo = new Date();
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
  const startDate = sevenDaysAgo.toISOString().split('T')[0];

  try {
    const stmt = db.prepare(
      `SELECT * FROM checkins WHERE user_id = ? AND date >= ? ORDER BY date DESC`
    );
    const rows = stmt.all(req.userId, startDate);
    res.json(rows || []);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch check-ins' });
  }
});

// ===== AI SUGGESTION ROUTES =====

app.get('/api/ai/suggestions', verifyToken, (req, res) => {
  try {
    const stmt = db.prepare(
      `SELECT * FROM suggestions WHERE user_id = ? ORDER BY created_at DESC LIMIT 10`
    );
    const rows = stmt.all(req.userId);
    res.json(rows || []);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch suggestions' });
  }
});

app.post('/api/ai/analyze', verifyToken, (req, res) => {
  const { water_intake, medicine_taken, sleep_hours, symptoms } = req.body;

  const suggestions = [];

  if (water_intake < 6) {
    suggestions.push({
      type: 'hydration',
      message: `⚠️ Critical: You've had only ${water_intake} glasses of water. Aim for 8-10!`,
      severity: 'high'
    });
  } else if (water_intake < 8) {
    suggestions.push({
      type: 'hydration',
      message: `💧 Good effort! You've had ${water_intake} glasses. Try for 8-10.`,
      severity: 'medium'
    });
  } else {
    suggestions.push({
      type: 'hydration',
      message: `✅ Excellent! ${water_intake} glasses. Keep it up!`,
      severity: 'low'
    });
  }

  if (!medicine_taken) {
    suggestions.push({
      type: 'medicine',
      message: '🚨 IMPORTANT: Did you forget your medicine? Critical for recovery!',
      severity: 'high'
    });
  } else {
    suggestions.push({
      type: 'medicine',
      message: '✅ Great! Medicine taken on time.',
      severity: 'low'
    });
  }

  if (sleep_hours < 5) {
    suggestions.push({
      type: 'sleep',
      message: `😴 Critical: ${sleep_hours}h sleep. Need 7-8 hours!`,
      severity: 'high'
    });
  } else if (sleep_hours < 7) {
    suggestions.push({
      type: 'sleep',
      message: `😴 ${sleep_hours}h sleep. Aim for 7-8 hours.`,
      severity: 'medium'
    });
  } else {
    suggestions.push({
      type: 'sleep',
      message: `✅ Perfect! ${sleep_hours}h sleep is ideal.`,
      severity: 'low'
    });
  }

  try {
    const stmt = db.prepare(
      `INSERT INTO suggestions (user_id, suggestion, type) VALUES (?, ?, ?)`
    );

    suggestions.forEach(sugg => {
      stmt.run(req.userId, sugg.message, sugg.type);
    });
  } catch (err) {
    console.error('Error saving suggestions:', err);
  }

  res.json({
    suggestions,
    timestamp: new Date().toISOString(),
    message: 'AI analysis complete'
  });
});

// ===== DASHBOARD ROUTES =====

const calculateRecoveryScore = (checkins) => {
  if (checkins.length === 0) return 0;

  let score = 0;
  
  const medicineRate = (checkins.filter(c => c.medicine_taken).length / checkins.length) * 100;
  score += (medicineRate / 100) * 40;

  const avgWater = checkins.reduce((sum, c) => sum + (c.water_intake || 0), 0) / checkins.length;
  score += Math.min((avgWater / 8) * 30, 30);

  const avgSleep = checkins.reduce((sum, c) => sum + (c.sleep_hours || 0), 0) / checkins.length;
  const sleepScore = Math.abs(7 - avgSleep) < 2 ? 30 : Math.max(0, 30 - Math.abs(7 - avgSleep) * 10);
  score += sleepScore;

  return Math.round(score);
};

app.get('/api/dashboard/stats', verifyToken, (req, res) => {
  try {
    const stmt = db.prepare(
      `SELECT * FROM checkins WHERE user_id = ? ORDER BY date DESC LIMIT 7`
    );
    const rows = stmt.all(req.userId);

    const stats = {
      totalCheckins: rows.length,
      avgWater: rows.length > 0 
        ? Math.round(rows.reduce((sum, r) => sum + (r.water_intake || 0), 0) / rows.length)
        : 0,
      medicineAdherence: rows.length > 0
        ? Math.round((rows.filter(r => r.medicine_taken).length / rows.length) * 100)
        : 0,
      avgSleep: rows.length > 0
        ? (rows.reduce((sum, r) => sum + (r.sleep_hours || 0), 0) / rows.length).toFixed(1)
        : 0,
      recentCheckins: rows.reverse(),
      recoveryScore: calculateRecoveryScore(rows)
    };

    res.json(stats);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch stats' });
  }
});

// ===== HOSPITAL ROUTE =====

app.get('/api/hospital', verifyToken, (req, res) => {
  try {
    // Get all users
    const users = db.prepare(`SELECT id, username FROM users`).all();
    const patients = users.map(user => {
      const checkins = db.prepare(`SELECT * FROM checkins WHERE user_id = ? ORDER BY date DESC LIMIT 7`).all(user.id);
      const logs = db.prepare(`SELECT * FROM voice_logs WHERE user_id = ? ORDER BY created_at DESC LIMIT 5`).all(user.id);
      
      const latestCheckin = checkins.length > 0 ? checkins[0] : null;
      let condition = "Stable";
      
      if (latestCheckin) {
        if (!latestCheckin.medicine_taken || latestCheckin.water_intake < 5 || latestCheckin.sleep_hours < 5) {
          condition = "Critical";
        }
      }

      let avgWater = 0;
      let medAdherence = 0;
      let avgSleep = 0;
      if (checkins.length > 0) {
         avgWater = Math.round(checkins.reduce((s, c) => s + (c.water_intake || 0), 0) / checkins.length);
         medAdherence = Math.round((checkins.filter(c => c.medicine_taken).length / checkins.length) * 100);
         avgSleep = parseFloat((checkins.reduce((s, c) => s + (c.sleep_hours || 0), 0) / checkins.length).toFixed(1));
      }
      
      return {
        id: user.id,
        name: user.username,
        daysPostDischarge: Math.floor(Math.random() * 10) + 1,
        condition: condition,
        sevenDaySummary: {
          avgWater,
          medAdherence,
          avgSleep
        },
        checkins: checkins.slice(0, 3).map(c => ({
          date: c.date,
          water: c.water_intake,
          sleep: c.sleep_hours,
          painLevel: c.symptoms.length > 5 ? 7 : 2,
          medicineTaken: c.medicine_taken
        })),
        logs: logs.map(l => ({
          date: new Date(l.created_at).toLocaleTimeString(),
          message: l.message
        }))
      };
    });
    
    res.json(patients);
  } catch (err) {
    console.error("Hospital API Error:", err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ── POST /api/call-patient — Trigger a real Twilio outbound call ───────────
app.post('/api/call-patient', verifyToken, async (req, res) => {
  const { toPhoneNumber, patientName, callType = 'follow-up' } = req.body;
  if (!toPhoneNumber) return res.status(400).json({ error: 'Phone number required' });

  try {
    const result = await makeAutomatedCall(toPhoneNumber, patientName, callType);
    if (result.success) {
      res.json({ success: true, message: `Call initiated to ${patientName}`, callSid: result.callSid });
    } else {
      res.status(500).json({ success: false, error: result.error || 'Call failed' });
    }
  } catch (err) {
    console.error('Call Patient Error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/twilio/audio/:id — Serve Bhashini TTS Audio to Twilio ─────────
app.get('/api/twilio/audio/:id', (req, res) => {
  const audioBase64 = twilioAudioCache.get(req.params.id);
  if (!audioBase64) {
    return res.status(404).send('Audio not found');
  }
  const audioBuffer = Buffer.from(audioBase64, 'base64');
  res.set('Content-Type', 'audio/wav');
  res.send(audioBuffer);
});

// ── POST /api/twilio/gather — Handle IVR Keypress ──────────────────────────
app.post('/api/twilio/gather', async (req, res) => {
  // Twilio sends data as URL-encoded form data
  const { Digits } = req.body;
  const { patientName, callType } = req.query;

  // Language mapping (1-9) with Twilio compatible BCP-47 codes
  const langMap = {
    '1': { name: 'English', code: 'en-IN' },
    '2': { name: 'Hindi', code: 'hi-IN' },
    '3': { name: 'Telugu', code: 'te-IN' },
    '4': { name: 'Tamil', code: 'ta-IN' },
    '5': { name: 'Malayalam', code: 'ml-IN' },
    '6': { name: 'Marathi', code: 'mr-IN' },
    '7': { name: 'Kannada', code: 'kn-IN' },
    '8': { name: 'Gujarati', code: 'gu-IN' },
    '9': { name: 'Odia', code: 'hi-IN' } // Fallback to basic TTS routing if Odia not fully supported
  };

  const selectedEntry = langMap[Digits] || langMap['1'];
  console.log(`[Twilio Webhook] User pressed ${Digits}. Target Language: ${selectedEntry.name}`);

  const VoiceResponse = require('twilio').twiml.VoiceResponse;
  const twiml = new VoiceResponse();
  const EnglishText = CALL_TEMPLATES[callType] ? CALL_TEMPLATES[callType](patientName) : CALL_TEMPLATES['follow-up'](patientName);

  try {
    if (selectedEntry.name === 'English') {
      twiml.say({ voice: 'Polly.Aditi', language: 'en-IN' }, EnglishText);
    } else {
      console.log(`[Twilio Webhook] Generating ${selectedEntry.name} translation via Local File...`);
      
      // Pull static exact translations mapped to callType and language name
      let translatedText;
      if (TRANSLATIONS[callType] && TRANSLATIONS[callType][selectedEntry.name]) {
        translatedText = TRANSLATIONS[callType][selectedEntry.name](patientName);
      } else {
        // Fallback safely to English if for any reason the route doesn't match
        translatedText = EnglishText;
      }

      console.log(`[Twilio Webhook] Translated output: ${translatedText}`);
      twiml.say({ language: selectedEntry.code }, translatedText);
    }
  } catch (err) {
    console.error('[Twilio Webhook] Error during language translation fallback:', err.message);
    twiml.say(
      { voice: 'Polly.Aditi', language: 'en-IN' }, 
      "We encountered an issue pulling your message. " + EnglishText
    );
  }

  res.type('text/xml');
  res.send(twiml.toString());
});

// ── GET /api/hospital/critical — Fetch high-risk patients from Supabase ─────
app.get('/api/hospital/critical', verifyToken, async (req, res) => {
  if (!supabase) return res.json({ patients: [], warning: 'Supabase not configured' });
  try {
    const { data, error } = await supabase
      .from('patient_data')
      .select('id, overall_risk_category, overall_risk_score, systolic_bp, heart_rate')
      .eq('overall_risk_category', 'High')
      .order('overall_risk_score', { ascending: false })
      .limit(20);
    if (error) throw error;
    res.json({ patients: data || [] });
  } catch (err) {
    console.error('Critical patients fetch error:', err);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/hospital/search/:id', verifyToken, async (req, res) => {
  const { id } = req.params;
  
  if (!supabase) {
    return res.status(503).json({ error: 'Supabase client not initialized' });
  }

  try {
    const { data, error } = await supabase
      .from('patient_data')
      .select('*')
      .eq('id', id)
      .single();
      
    if (error || !data) {
      return res.status(404).json({ error: 'Patient not found in dataset' });
    }
    
    // Map Supabase 'patient_data' into Dashboard UI format
    const patientObj = {
      id: data.id,
      name: `patient${data.id}`,
      daysPostDischarge: 4,
      condition: data.overall_risk_category === "High" ? "Critical" : data.overall_risk_category === "Moderate" ? "Moderate Risk" : "Stable",
      sevenDaySummary: {
        avgWater: 6,
        medAdherence: 57,
        avgSleep: 5
      },
      checkins: [],
      logs: [],
      clinicalData: data
    };
    
    // Fetch logs from local DB if applicable (e.g. for ID=1 interaction)
    try {
        const logs = db.prepare(`SELECT * FROM voice_logs WHERE user_id = ? ORDER BY created_at DESC LIMIT 5`).all(data.id);
        patientObj.logs = logs.map(l => ({
          date: new Date(l.created_at).toLocaleTimeString(),
          message: l.message
        }));
    } catch (e) {
        console.error("Could not fetch local logs for patient", data.id);
    }
    
    res.json(patientObj);
  } catch (err) {
    console.error("Hospital Search API Error:", err);
    res.status(500).json({ error: 'Server error during search' });
  }
});

app.get('/api/hospital/symptoms', verifyToken, (req, res) => {
  try {
    const stmt = db.prepare(`SELECT * FROM patient_symptoms_summary`);
    const rows = stmt.all();
    const mapped = {};
    rows.forEach(r => {
      mapped[r.patient_id] = { summary: r.summary, feelsBetter: !!r.feels_better, updatedAt: r.created_at };
    });
    res.json(mapped);
  } catch (error) {
    console.error('Failed to fetch patient symptoms summary:', error);
    res.status(500).json({ error: 'Failed' });
  }
});

// ===== VOICE REMINDER ROUTES =====

app.get('/api/reminders', verifyToken, (req, res) => {
  try {
    const stmt = db.prepare(
      `SELECT * FROM reminders WHERE user_id = ? ORDER BY time ASC`
    );
    const rows = stmt.all(req.userId);
    res.json(rows || []);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch reminders' });
  }
});

app.post('/api/reminders', verifyToken, (req, res) => {
  const { time, text, type } = req.body;
  
  if (!time || !text) {
    return res.status(400).json({ error: 'Time and text required' });
  }

  try {
    const stmt = db.prepare(
      `INSERT INTO reminders (user_id, time, text, type, completed) VALUES (?, ?, ?, ?, 0)`
    );
    const result = stmt.run(req.userId, time, text, type || 'medicine');
    
    res.json({ id: result.lastInsertRowid, message: 'Reminder created' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to create reminder' });
  }
});

app.put('/api/reminders/:id', verifyToken, (req, res) => {
  const { time, text } = req.body;
  
  if (!time || !text) {
    return res.status(400).json({ error: 'Time and text required' });
  }

  try {
    const stmt = db.prepare(
      `UPDATE reminders SET time = ?, text = ? WHERE id = ? AND user_id = ?`
    );
    stmt.run(time, text, req.params.id, req.userId);
    
    res.json({ message: 'Reminder updated successfully' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to update reminder' });
  }
});

// ===== VOICE COMPANION ROUTES =====

app.post('/api/tts/speak', verifyToken, async (req, res) => {
  const { text, language, gender } = req.body;
  if (!text) return res.status(400).json({ error: 'Text required' });

  try {
    // 1. Attempt Bhashini TTS if env keys exist
    if (process.env.BHASHINI_USER_ID && process.env.BHASHINI_API_KEY) {
      try {
        const audioBase64 = await bhashiniTTS(text, language, gender);
        return res.json({ audioBase64, mimeType: 'audio/wav', engine: 'bhashini' });
      } catch (err) {
        console.warn('Bhashini TTS failed, falling back to Google TTS:', err.message);
      }
    }

    // 2. Fallback: Google TTS (Free, no keys needed, supports all 22 Indian languages)
    const langCode = LANGUAGE_CODE_MAP[language] || 'hi';
    const audioBase64 = await googleTTS.getAudioBase64(text, { lang: langCode, slow: false });
    res.json({ audioBase64, mimeType: 'audio/mpeg', engine: 'google' });
  } catch (err) {
    console.error('TTS Error:', err);
    res.status(500).json({ error: 'Failed to generate speech' });
  }
});

app.post('/api/bhashini/asr', verifyToken, async (req, res) => {
  const { audioBase64, language } = req.body;
  if (!audioBase64) return res.status(400).json({ error: 'Audio required' });

  try {
    // Bhashini ASR parsing (requires env keys, otherwise throws error handled gracefully)
    const transcript = await bhashiniASR(audioBase64, language);
    res.json({ transcript });
  } catch (err) {
    console.error('ASR Error:', err.message);
    res.status(500).json({ error: 'ASR failed' });
  }
});

app.post('/api/voice', verifyToken, async (req, res) => {
  const { speechText, language } = req.body;
  try {
    const reply = await handleVoiceInteraction(speechText, language);
    res.json({ text: reply });
  } catch (err) {
    console.error('Voice AI Error:', err.message);
    res.status(500).json({ error: 'AI failed' });
  }
});

app.post('/api/voice-logs', verifyToken, (req, res) => {
  const { reminderId, response, message } = req.body;
  try {
    const stmt = db.prepare(
      `INSERT INTO voice_logs (user_id, reminder_id, response, message) VALUES (?, ?, ?, ?)`
    );
    stmt.run(req.userId, reminderId, response, message || '');
    res.json({ success: true });
  } catch (err) {
    console.error('Voice Log save error:', err.message);
    res.status(500).json({ error: 'Failed to save log' });
  }
});

// ===== DEMO: Seed time-relevant reminders for the current user =====
app.post('/api/demo/seed-reminders', verifyToken, (req, res) => {
  try {
    // First, clear any existing incomplete reminders for this user
    db.prepare(`DELETE FROM reminders WHERE user_id = ? AND completed = 0`).run(req.userId);

    const now = new Date();
    const pad = (n) => String(n).padStart(2, '0');

    // Create reminders: 1 due ~1 min from now, others spread through the day
    const addMins = (mins) => {
      const d = new Date(now.getTime() + mins * 60000);
      return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
    };

    const demoReminders = [
      { time: addMins(1),  text: 'Take morning blood pressure medicine',     type: 'medicine' },
      { time: addMins(3),  text: 'Drink a full glass of water',              type: 'hydration' },
      { time: addMins(5),  text: 'Do 5 minutes of light breathing exercises', type: 'exercise' },
      { time: addMins(8),  text: 'Eat a light healthy breakfast',            type: 'diet' },
      { time: addMins(12), text: 'Take evening vitamins and supplements',    type: 'medicine' },
    ];

    const stmt = db.prepare(
      `INSERT INTO reminders (user_id, time, text, type, completed) VALUES (?, ?, ?, ?, 0)`
    );
    demoReminders.forEach(r => stmt.run(req.userId, r.time, r.text, r.type));

    res.json({ success: true, seeded: demoReminders.length, reminders: demoReminders });
  } catch (err) {
    console.error('Demo seed error:', err.message);
    res.status(500).json({ error: 'Failed to seed demo reminders' });
  }
});

app.delete('/api/reminders/:id', verifyToken, (req, res) => {
  try {
    const stmt = db.prepare(
      `DELETE FROM reminders WHERE id = ? AND user_id = ?`
    );
    stmt.run(req.params.id, req.userId);
    
    res.json({ message: 'Reminder deleted successfully' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete reminder' });
  }
});

app.post('/api/reminders/:id/complete', verifyToken, (req, res) => {
  try {
    const stmt = db.prepare(
      `UPDATE reminders SET completed = 1, completed_at = CURRENT_TIMESTAMP WHERE id = ? AND user_id = ?`
    );
    stmt.run(req.params.id, req.userId);
    
    res.json({ message: 'Reminder marked complete' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to complete reminder' });
  }
});

app.post('/api/voice-logs', verifyToken, async (req, res) => {
  const { reminderId, response, message } = req.body;
  
  try {
    // ==== ARCHITECTURE STEP 4 & 5 ====
    // Extract Intent & Assemble FHIR QuestionnaireResponse
    const fhirResponse = await extractVoiceIntentToFHIR(message || response);
    console.log("[ARCHITECTURE] FHIR Assembly Output:", JSON.stringify(fhirResponse, null, 2));
    
    // Check intent truthiness
    const intentResult = fhirResponse?.item?.[0]?.answer?.[0]?.valueBoolean || (response === 'yes');

    // Architecture Step 6: Downstream Update (Log to Dashboard)
    const stmt = db.prepare(
      `INSERT INTO voice_logs (user_id, reminder_id, response, message, created_at) 
       VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)`
    );
    stmt.run(req.userId, reminderId || null, intentResult ? 'yes' : 'no', message || '');
    
    res.json({ message: 'Voice interaction logged & FHIR processed' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to log voice interaction' });
  }
});

app.get('/api/voice-logs', verifyToken, (req, res) => {
  try {
    const stmt = db.prepare(
      `SELECT * FROM voice_logs WHERE user_id = ? ORDER BY created_at DESC LIMIT 20`
    );
    const rows = stmt.all(req.userId);
    res.json(rows || []);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch logs' });
  }
});

app.post('/api/generate-plan', verifyToken, async (req, res) => {
  const { illness, age, weight, foodPreference, getHospitalVitalInfo, patientDataId } = req.body;
  
  if (!illness || !age || !weight) {
    return res.status(400).json({ error: 'Illness, age, and weight are required' });
  }

  try {
    let hospitalVitals = null;
    
    // Fetch data from Supabase if requested
    if (getHospitalVitalInfo && patientDataId && supabase) {
      try {
        console.log(`[Supabase] Fetching precise hospital vitals for Patient Data ID: ${patientDataId}`);
        const { data, error } = await supabase
          .from('patient_data')
          .select('systolic_bp, diastolic_bp, heart_rate, respiratory_rate, oxygen_saturation, temperature, blood_glucose, bmi, waist_circumference, perfusion_index, bmi_category, heart_risk_level, diabetic_risk_total_score, diabetic_risk_level, hypertension_risk_total_score, hypertension_risk_level, overall_risk_category, overall_risk_score, chest_discomfort, breathlessness, palpitations, fatigue_weakness, dizziness_blackouts, sleep_duration, stress_anxiety, physical_inactivity, diet_quality')
          .eq('id', patientDataId)
          .single();
          
        if (error) {
          console.warn('[Supabase] Could not fetch hospital vitals:', error.message);
        } else {
          console.log('[Supabase] Vitals fetched successfully for AI interpolation.');
          hospitalVitals = data;
        }
      } catch (dbErr) {
        console.error('[Supabase] Fetch error:', dbErr);
      }
    }

    const plan = await generateRecoveryPlan({ 
      illness, 
      age, 
      weight, 
      foodPreference, 
      hospitalVitals 
    });
    
    if (!plan) return res.status(500).json({ error: 'Failed to generate plan' });

    // ==== ARCHITECTURE: FHIR Assembly ====
    // Map proprietary UI format into strict clinical FHIR CarePlan resource
    const fhirCarePlan = convertPlanToFHIR(req.userId || 'anonymous_patient', plan, { illness, age, weight });
    console.log("\n[ARCHITECTURE] FHIR CarePlan Assembly Output:\n", JSON.stringify(fhirCarePlan, null, 2));

    // Attach fetched vitals natively to the json response to be rendered by DailyPlan.jsx UI 
    if (hospitalVitals) {
        plan.hospitalVitals = hospitalVitals;
    }
    
    res.json(plan);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Error generating recovery plan' });
  }
});

app.post('/api/save-plan', verifyToken, (req, res) => {
  const { plan, foodPreference } = req.body;
  if (!plan) return res.status(400).json({ error: 'Plan data required' });

  try {
    // 1. Save to Reminders
    // First, nullify voice_logs.reminder_id references to avoid FOREIGN KEY constraint failure
    const getReminderIds = db.prepare(`SELECT id FROM reminders WHERE user_id = ? AND completed = 0`);
    const reminderIds = getReminderIds.all(req.userId).map(r => r.id);
    if (reminderIds.length > 0) {
      const placeholders = reminderIds.map(() => '?').join(',');
      db.prepare(`UPDATE voice_logs SET reminder_id = NULL WHERE reminder_id IN (${placeholders})`).run(...reminderIds);
    }
    const clearStmt = db.prepare(`DELETE FROM reminders WHERE user_id = ? AND completed = 0`);
    clearStmt.run(req.userId);

    const insertReminder = db.prepare(`INSERT INTO reminders (user_id, time, text, type) VALUES (?, ?, ?, ?)`);

    const parseToTimeStr = (t) => {
      if (!t) return '09:00';
      const timeMatch = t.match(/(\d{1,2}):(\d{2})\s*([APMpwam]*)/i);
      if (timeMatch) {
         let hours = parseInt(timeMatch[1], 10);
         const minutes = timeMatch[2];
         const modifier = timeMatch[3];
         if (modifier && modifier.toUpperCase().includes('PM') && hours < 12) hours += 12;
         if (modifier && modifier.toUpperCase().includes('AM') && hours === 12) hours = 0;
         return `${hours.toString().padStart(2, '0')}:${minutes}`;
      }
      return t; // fallback
    };

    if (plan.medicineTiming && Array.isArray(plan.medicineTiming)) {
      plan.medicineTiming.forEach(med => {
         const timeStr = parseToTimeStr(med.time);
         insertReminder.run(req.userId, timeStr, `Time for your medicine: ${med.medicine || 'unknown'}. ${med.purpose || ''}`, 'medicine');
      });
    }

    if (plan.mealPlan && Array.isArray(plan.mealPlan)) {
      plan.mealPlan.forEach(meal => {
         const timeStr = parseToTimeStr(meal.time);
         insertReminder.run(req.userId, timeStr, `Time for your meal: ${meal.meal || 'unknown'}`, 'diet');
      });
    }

    // 2. Save active plan to recovery_plans
    const savePlanStmt = db.prepare(`
      INSERT INTO recovery_plans (user_id, plan_json, food_preference)
      VALUES (?, ?, ?)
      ON CONFLICT(user_id) DO UPDATE SET
        plan_json = excluded.plan_json,
        food_preference = excluded.food_preference,
        created_at = CURRENT_TIMESTAMP
    `);
    savePlanStmt.run(req.userId, JSON.stringify(plan), foodPreference || 'Veg');

    res.json({ message: 'Plan saved to reminders and dashboard successfully' });
  } catch (error) {
    console.error('Save plan error:', error);
    res.status(500).json({ error: 'Error saving plan to DB' });
  }
});

app.get('/api/dashboard/today-plan', verifyToken, (req, res) => {
  try {
    const stmt = db.prepare(`SELECT * FROM recovery_plans WHERE user_id = ?`);
    const row = stmt.get(req.userId);
    if (!row) return res.json(null);
    
    res.json({
      plan: JSON.parse(row.plan_json),
      foodPreference: row.food_preference,
      updatedAt: row.created_at
    });
  } catch (error) {
    console.error('Fetch today plan err:', error);
    res.status(500).json({ error: 'Failed to fetch today plan' });
  }
});

app.post('/api/voice', verifyToken, async (req, res) => {
  const { speechText, language } = req.body;
  if (!speechText) return res.status(400).json({ error: 'speechText required' });

  try {
    console.log(`[AI] Generating for: "${speechText.slice(0, 40)}..." in ${language}`);
    const response = await handleVoiceInteraction(speechText, language);
    console.log(`[AI] Response: "${response?.slice(0, 40)}..."`);
    res.json({ text: response });
  } catch (error) {
    console.error('[AI] Voice route error:', error.message);
    res.status(500).json({ error: 'Error processing voice interaction' });
  }
});

app.post('/api/call-patient', verifyToken, async (req, res) => {
  const { toPhoneNumber, patientName } = req.body;
  if (!toPhoneNumber) {
    return res.status(400).json({ error: 'toPhoneNumber required' });
  }

  try {
    const result = await makeAutomatedCall(toPhoneNumber, patientName || 'Patient');
    if (!result.success) return res.status(500).json({ error: result.error });
    res.json({ message: 'Call initiated successfully', callSid: result.callSid });
  } catch (error) {
    res.status(500).json({ error: 'Failed to initiate automated call' });
  }
});

// ===== DUMMY DATA FOR DEMO =====

app.post('/api/dummy/seed', (req, res) => {
  try {
    const hashedPassword = bcryptjs.hashSync('password123', 8);

    // Insert or ignore demo user
    const userStmt = db.prepare(
      `INSERT OR IGNORE INTO users (id, username, email, password) VALUES (?, ?, ?, ?)`
    );
    userStmt.run(1, 'patient1', 'patient@example.com', hashedPassword);
    userStmt.run(2, 'hospital_admin', 'hospital@example.com', hashedPassword);

    // Insert 7 days of dummy check-ins
    const checkinStmt = db.prepare(
      `INSERT OR IGNORE INTO checkins (user_id, date, water_intake, medicine_taken, sleep_hours, symptoms, mood)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    );

    for (let i = 0; i < 7; i++) {
      const date = new Date();
      date.setDate(date.getDate() - i);
      const dateStr = date.toISOString().split('T')[0];

      checkinStmt.run(
        1,
        dateStr,
        Math.floor(Math.random() * 3) + 7,
        Math.random() > 0.2 ? 1 : 0,
        Math.floor(Math.random() * 3) + 6,
        ['none', 'mild headache', 'slight cough'][Math.floor(Math.random() * 3)],
        ['good', 'okay', 'great'][Math.floor(Math.random() * 3)]
      );
    }

    // Insert sample reminders
    const reminderStmt = db.prepare(
      `INSERT OR IGNORE INTO reminders (user_id, time, text, type, completed)
       VALUES (?, ?, ?, ?, 0)`
    );

    const sampleReminders = [
      { time: '09:00', text: 'Take blood pressure medicine' },
      { time: '12:30', text: 'Drink 1 glass of water' },
      { time: '14:00', text: 'Take antibiotic tablet' },
      { time: '18:00', text: 'Wound care - apply bandage' }
    ];

    sampleReminders.forEach(reminder => {
      reminderStmt.run(1, reminder.time, reminder.text, 'medicine');
    });

    res.json({
      message: 'Demo user and data created successfully!',
      credentials: {
        email: 'patient@example.com',
        password: 'password123'
      }
    });
  } catch (err) {
    console.error('Seed error:', err);
    res.status(500).json({ error: 'Failed to seed data' });
  }
});

// ===== VOICE TTS ROUTES (Bhashini + Google TTS Fallback) =====

// Language code map for Google TTS / Bhashini (BCP-47 codes)
const GTTS_LANG_MAP = {
  // ── Tier 1: Google TTS + Bhashini ─────────────────────────────────────
  'English':   'en',
  'Hindi':     'hi',
  'Bengali':   'bn',
  'Tamil':     'ta',
  'Telugu':    'te',
  'Gujarati':  'gu',
  'Marathi':   'mr',
  'Kannada':   'kn',
  'Malayalam': 'ml',
  'Punjabi':   'pa',
  'Urdu':      'ur',
  'Nepali':    'ne',
};

// For languages where Google TTS has no direct code, map to closest supported or Hindi
const GTTS_FALLBACK_MAP = {
  'Odia':      'hi',    // Odia not in translate_tts, using Hindi/Bengali as fallback
  'Assamese':  'bn',
  'Maithili':  'hi',
  'Konkani':   'mr',
  'Dogri':     'hi',
  'Kashmiri':  'ur',
  'Santali':   'bn',
  'Sanskrit':  'hi',
  'Manipuri':  'bn',
  'Bodo':      'hi',
  'Sindhi':    'hi',
};

/**
 * GET /api/tts/google?text=...&language=Hindi
 * Calls Google Translate TTS (no API key needed) → returns MP3 base64
 * Works for ALL Indian languages! Great fallback when Bhashini isn't configured.
 */
app.get('/api/tts/google', async (req, res) => {
  const { text, language = 'Hindi' } = req.query;
  if (!text) return res.status(400).json({ error: 'text query param required' });

  const langCode = GTTS_LANG_MAP[language] || GTTS_FALLBACK_MAP[language] || 'hi';
  const url = `https://translate.google.com/translate_tts?ie=UTF-8&q=${encodeURIComponent(text)}&tl=${langCode}&client=tw-ob&ttsspeed=0.85`;

  try {
    const response = await axios.get(url, {
      responseType: 'arraybuffer',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36',
        'Referer': 'https://translate.google.com/',
        'Accept': 'audio/mpeg, audio/*'
      },
      timeout: 10000
    });

    const audioBase64 = Buffer.from(response.data).toString('base64');
    res.json({ audioBase64, mimeType: 'audio/mpeg', language, engine: 'google-translate' });
  } catch (err) {
    console.error('[Google TTS] Error:', err.message);
    res.status(500).json({ error: 'Google TTS failed', detail: err.message });
  }
});

/**
 * POST /api/tts/speak  ← UNIFIED SMART TTS ENDPOINT
 * Body: { text, language, gender? }
 * Tries: 1) Bhashini  2) Google TTS  3) error (frontend uses browser)
 * This is the main endpoint the frontend should call.
 */
app.post('/api/tts/speak', verifyToken, async (req, res) => {
  const { text, language = 'Hindi', gender = 'female' } = req.body;
  if (!text) return res.status(400).json({ error: 'text is required' });

  // 1️⃣ Try Bhashini if keys are configured
  const bhashiniConfigured = process.env.BHASHINI_USER_ID &&
    !process.env.BHASHINI_USER_ID.includes('your-bhashini');

  if (bhashiniConfigured) {
    try {
      const audioBase64 = await bhashiniTTS(text, language, gender);
      return res.json({ audioBase64, mimeType: 'audio/wav', engine: 'bhashini', language });
    } catch (err) {
      console.warn('[/api/tts/speak] Bhashini failed, trying Google TTS:', err.message);
    }
  }

  // 2️⃣ Google Translate TTS (always available, all Indian languages)
  const langCode = GTTS_LANG_MAP[language] || GTTS_FALLBACK_MAP[language] || 'hi';
  console.log(`[/api/tts/speak] Engine: Google, Lang: ${language} -> ${langCode}, Text: "${text.slice(0, 30)}..."`);
  
  const url = `https://translate.google.com/translate_tts?ie=UTF-8&q=${encodeURIComponent(text)}&tl=${langCode}&client=tw-ob&ttsspeed=0.85`;
  
  try {
    const response = await axios.get(url, {
      responseType: 'arraybuffer',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
        'Referer': 'https://translate.google.com/',
        'Accept': 'audio/mpeg, audio/*'
      },
      timeout: 12000
    });
    
    const audioSize = response.data.byteLength;
    if (audioSize < 100) throw new Error(`Audio too small (${audioSize} bytes)`);
    
    const audioBase64 = Buffer.from(response.data).toString('base64');
    console.log(`[/api/tts/speak] Google success: ${audioSize} bytes`);
    return res.json({ audioBase64, mimeType: 'audio/mpeg', engine: 'google-translate', language });
  } catch (err) {
    console.error('[/api/tts/speak] Google TTS failed:', err.message);
    return res.status(500).json({
      error: 'All TTS engines failed',
      detail: err.message,
      fallback: 'Use browser SpeechSynthesis'
    });
  }
});

/**
 * POST /api/bhashini/tts  ← kept for backward compat, now also auto-falls back
 * Body: { text: string, language: string, gender?: 'male'|'female' }
 */
app.post('/api/bhashini/tts', verifyToken, async (req, res) => {
  const { text, language = 'Hindi', gender = 'female' } = req.body;
  if (!text) return res.status(400).json({ error: 'text is required' });

  // Try Bhashini first
  const bhashiniConfigured = process.env.BHASHINI_USER_ID &&
    !process.env.BHASHINI_USER_ID.includes('your-bhashini');

  if (bhashiniConfigured) {
    try {
      const audioBase64 = await bhashiniTTS(text, language, gender);
      return res.json({ audioBase64, mimeType: 'audio/wav', language, engine: 'bhashini' });
    } catch (err) {
      console.warn('[/api/bhashini/tts] Bhashini failed, falling back to Google TTS:', err.message);
    }
  }

  // Auto-fallback: Google Translate TTS
  const langCode = GTTS_LANG_MAP[language] || GTTS_FALLBACK_MAP[language] || 'hi';
  const url = `https://translate.google.com/translate_tts?ie=UTF-8&q=${encodeURIComponent(text)}&tl=${langCode}&client=tw-ob&ttsspeed=0.85`;
  try {
    const response = await axios.get(url, {
      responseType: 'arraybuffer',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36',
        'Referer': 'https://translate.google.com/'
      },
      timeout: 10000
    });
    const audioBase64 = Buffer.from(response.data).toString('base64');
    return res.json({ audioBase64, mimeType: 'audio/mpeg', language, engine: 'google-translate' });
  } catch (err) {
    console.error('[/api/bhashini/tts] All TTS failed:', err.message);
    res.status(500).json({ error: 'TTS failed', detail: err.message });
  }
});

/**
 * POST /api/bhashini/asr
 * Body: { audioBase64: string, language: string }
 * Returns: { transcript: string }
 */
app.post('/api/bhashini/asr', verifyToken, async (req, res) => {
  const { audioBase64, language = 'Hindi' } = req.body;
  if (!audioBase64) return res.status(400).json({ error: 'audioBase64 is required' });

  try {
    const transcript = await bhashiniASR(audioBase64, language);
    res.json({ transcript, language });
  } catch (err) {
    console.error('[/api/bhashini/asr] Error:', err.message);
    res.status(500).json({ error: 'Bhashini ASR failed', detail: err.message });
  }
});

/**
 * POST /api/bhashini/translate
 * Body: { text: string, sourceLanguage: string, targetLanguage: string }
 * Returns: { translated: string }
 */
app.post('/api/bhashini/translate', verifyToken, async (req, res) => {
  const { text, sourceLanguage = 'English', targetLanguage = 'Hindi' } = req.body;
  if (!text) return res.status(400).json({ error: 'text is required' });

  try {
    const translated = await bhashiniTranslate(text, sourceLanguage, targetLanguage);
    res.json({ translated, sourceLanguage, targetLanguage });
  } catch (err) {
    console.error('[/api/bhashini/translate] Error:', err.message);
    res.status(500).json({ error: 'Bhashini translate failed', detail: err.message });
  }
});

/**
 * GET /api/bhashini/languages
 * Returns list of all supported languages
 */
app.get('/api/bhashini/languages', (req, res) => {
  res.json({
    languages: Object.keys(LANGUAGE_CODE_MAP),
    codes: LANGUAGE_CODE_MAP
  });
});

// ===== SUPABASE PATIENT DATA ROUTES (Hackathon Dataset) =====

/**
 * GET /api/supabase/patients
 * Fetches all patient profiles from Supabase hackathon dataset
 */
app.get('/api/supabase/patients', verifyToken, async (req, res) => {
  if (!supabase) {
    return res.status(503).json({ error: 'Supabase not configured. Add SUPABASE_URL and SUPABASE_ANON_KEY to .env' });
  }
  try {
    const { data, error } = await supabase
      .from('patient_profiles')
      .select('*, users(name, email, abha_id)')
      .order('created_at', { ascending: false });
    if (error) throw error;
    res.json(data || []);
  } catch (err) {
    console.error('[Supabase patients] Error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/supabase/daily-logs/:userId
 * Fetches daily logs for a patient from Supabase
 */
app.get('/api/supabase/daily-logs/:userId', verifyToken, async (req, res) => {
  if (!supabase) return res.status(503).json({ error: 'Supabase not configured' });
  try {
    const { data, error } = await supabase
      .from('daily_logs')
      .select('*')
      .eq('user_id', req.params.userId)
      .order('date', { ascending: false })
      .limit(30);
    if (error) throw error;
    res.json(data || []);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/supabase/daily-logs
 * Saves a daily log entry to Supabase
 */
app.post('/api/supabase/daily-logs', verifyToken, async (req, res) => {
  if (!supabase) return res.status(503).json({ error: 'Supabase not configured' });
  const { user_id, water, medicine_taken, sleep_hours, symptoms } = req.body;
  try {
    const { data, error } = await supabase
      .from('daily_logs')
      .insert([{ user_id, water, medicine_taken, sleep_hours, symptoms }])
      .select();
    if (error) throw error;
    res.json({ message: 'Daily log saved to Supabase', data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/supabase/status
 * Check if Supabase connection is working
 */
app.get('/api/supabase/status', async (req, res) => {
  if (!supabase) return res.json({ connected: false, reason: 'Supabase env vars not set' });
  try {
    const { error } = await supabase.from('users').select('id').limit(1);
    if (error) throw error;
    res.json({ connected: true, url: process.env.SUPABASE_URL });
  } catch (err) {
    res.json({ connected: false, reason: err.message });
  }
});



// ===== ERROR HANDLING =====
app.use((err, req, res, next) => {
  console.error('Error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

// ===== START SERVER =====
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`
╔════════════════════════════════════════╗
║   🏥 SWASTHYA BANDHU - Backend         ║
║   ✅ Server running on port ${PORT}      ║
║   📍 http://localhost:${PORT}         ║
║   🔌 API endpoints ready               ║
╚════════════════════════════════════════╝
  `);
});

module.exports = app;