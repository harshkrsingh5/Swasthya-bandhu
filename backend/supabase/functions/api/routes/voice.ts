import { Hono } from 'npm:hono@3';
import { supabase } from '../utils/db.ts';
import { verifyToken } from '../utils/auth.ts';

const voiceRoutes = new Hono();

// ── POST /voice — AI Voice Interaction (Gemini) ──────────────────────────
voiceRoutes.post('/', verifyToken, async (c) => {
  const { speechText, language } = await c.req.json();
  if (!speechText) return c.json({ error: 'speechText required' }, 400);

  try {
    const { GoogleGenerativeAI } = await import('npm:@google/generative-ai');
    const genAI = new GoogleGenerativeAI(Deno.env.get('GEMINI_API_KEY') || '');
    const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });
    const prompt = `
      You are **Swasthya Bandhu AI**, a highly reliable, calm, and empathetic healthcare voice assistant designed for Indian users.

      ## Core Behavior
      * Speak naturally like a human doctor assistant, not like a robot.
      * Be polite, respectful, and reassuring.
      * Keep responses short, clear, and conversational (suitable for voice calls).
      * Never give overly long explanations.

      ## Language Handling (VERY IMPORTANT)
      * Automatically detect the user's language based on what they say.
      * If the user speaks in Hindi → respond in Hindi.
      * If the user speaks in English → respond in English.
      * If the user mixes both → respond in simple Hinglish.
      * Use easy, rural-friendly language (avoid complex medical jargon).
      * CRITICAL INSTRUCTION: Ensure your final output respects this primary backend fallback language if the patient's language is ambiguous: ${language || 'English'}.
      
      ## Medical Safety Rules
      * You are NOT a doctor.
      * Do NOT give final diagnoses.
      * Only provide general guidance and possible causes.
      * Always suggest consulting a real doctor for serious issues.
      * If symptoms are dangerous (chest pain, breathing issue, unconsciousness, heavy bleeding):
        → Immediately say it may be an emergency and advise calling ambulance or visiting nearest hospital.

      ## Conversation Style
      * Ask follow-up questions like a real assistant (e.g. "Aapko ye problem kab se ho rahi hai?").
      * Keep one question at a time.
      * Acknowledge user feelings ("Samajh gaya", "Chinta mat kariye", "Main madad karta hoon").

      ## Voice Interaction Rules
      * Responses must be short (1–3 sentences max).
      * Avoid lists unless necessary.
      * Use natural spoken tone (not written paragraphs).
      * Add slight pauses naturally using commas.

      ## Health Guidance Scope
      * Help with common symptoms (fever, cough, headache, stomach pain) and basic first aid/wellness.
      * Avoid prescribing medicines with exact dosage, legal advice, or complex medical procedures.

      ## Personalization
      * If user shares name, remember and use it.
      * Be friendly but professional.

      ## Fail-safe
      * If unsure, explicitly state "Mujhe poori tarah confirm nahi hai, lekin aap doctor se consult karein." (or the localized equivalent).

      ---
      Patient's Speech / Request: "${speechText}"
      
      Respond ONLY with the exact words you will speak back to the patient. Do NOT include any markdown formatting, headers, or English translations.
    `;
    const result = await model.generateContent(prompt);
    return c.json({ text: result.response.text() });
  } catch (err: any) {
    console.error('Voice AI Error:', err.message);
    return c.json({ error: 'AI interaction failed' }, 500);
  }
});

// ── POST /voice-logs — Save Voice Interaction Log ────────────────────────
voiceRoutes.post('/logs', verifyToken, async (c) => {
  const user = c.get('user');
  const { reminderId, response, message } = await c.req.json();

  const { error } = await supabase.from('voice_logs').insert([{
    user_id: user.id,
    reminder_id: reminderId || null,
    response: response || 'no',
    message: message || ''
  }]);

  if (error) return c.json({ error: error.message }, 500);
  return c.json({ message: 'Voice interaction logged' });
});

// ── GET /voice-logs — Fetch Voice Logs ───────────────────────────────────
voiceRoutes.get('/logs', verifyToken, async (c) => {
  const user = c.get('user');
  const { data, error } = await supabase
    .from('voice_logs')
    .select('*')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })
    .limit(20);

  if (error) return c.json({ error: error.message }, 500);
  return c.json(data || []);
});

// ── POST /tts/speak — Text-to-Speech via Google TTS ─────────────────────
voiceRoutes.post('/tts', async (c) => {
  const { text, language } = await c.req.json();
  if (!text) return c.json({ error: 'text required' }, 400);

  const LANG_CODE_MAP: Record<string, string> = {
    'Hindi': 'hi', 'Tamil': 'ta', 'Telugu': 'te', 'Malayalam': 'ml',
    'Kannada': 'kn', 'Marathi': 'mr', 'Gujarati': 'gu', 'Odia': 'or', 'English': 'en'
  };

  const langCode = LANG_CODE_MAP[language] || 'en';
  const url = `https://translate.google.com/translate_tts?ie=UTF-8&q=${encodeURIComponent(text)}&tl=${langCode}&client=tw-ob`;

  try {
    const audioRes = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
    const buffer = await audioRes.arrayBuffer();
    const base64 = btoa(String.fromCharCode(...new Uint8Array(buffer)));
    return c.json({ audioBase64: base64, mimeType: 'audio/mpeg', engine: 'google' });
  } catch (err: any) {
    return c.json({ error: 'TTS failed', details: err.message }, 500);
  }
});

export default voiceRoutes;
