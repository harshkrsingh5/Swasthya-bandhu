import { Hono } from 'npm:hono@3';
import { supabase } from '../utils/db.ts';
import { verifyToken } from '../utils/auth.ts';

const aiRoutes = new Hono();

// ── POST /ai/generate-plan ────────────────────────────────────────────────
aiRoutes.post('/generate-plan', verifyToken, async (c) => {
  const user = c.get('user');
  const { illness, age, weight, foodPreference, getHospitalVitalInfo } = await c.req.json();
  if (!illness || !age || !weight) return c.json({ error: 'illness, age and weight are required' }, 400);

  let hospitalVitals = null;
  if (getHospitalVitalInfo) {
    const { data } = await supabase.from('patient_data').select('*').eq('id', user.id).single();
    hospitalVitals = data || null;
  }

  try {
    const { GoogleGenerativeAI } = await import('npm:@google/generative-ai');
    const genAI = new GoogleGenerativeAI(Deno.env.get('GEMINI_API_KEY') || '');
    const model = genAI.getGenerativeModel({
      model: 'gemini-1.5-flash',
      generationConfig: { responseMimeType: 'application/json' }
    });

    const vitalsText = hospitalVitals
      ? `IMPORTANT: This patient has hospital vitals: ${JSON.stringify(hospitalVitals)}`
      : '';

    const prompt = `Generate a personalized recovery plan for a patient with illness: ${illness}, age: ${age}, weight: ${weight}kg.
Dietary Preference: ${foodPreference || 'Any'}. ${vitalsText}
Return ONLY a JSON object with: mealPlan, hydrationSchedule, medicineTiming, sleepRecommendations, dailyRoutine.`;

    const result = await model.generateContent(prompt);
    const plan = JSON.parse(result.response.text());
    return c.json(plan);
  } catch (err: any) {
    console.error('AI Plan Error:', err.message);
    // Static fallback plan
    return c.json({
      mealPlan: [
        { time: '08:00 AM', meal: 'Oatmeal with Almonds', details: 'Fibrous and light on stomach' },
        { time: '01:00 PM', meal: 'Lentil Dal & Brown Rice', details: 'High protein, easy to digest' },
        { time: '07:30 PM', meal: 'Vegetable Soup', details: 'Hydrating and warm before bed' }
      ],
      hydrationSchedule: { dailyTarget: '2 Liters', reminders: ['10:00 AM', '02:00 PM'] },
      medicineTiming: [
        { time: '09:00 AM', medicine: 'Antibiotic', purpose: 'Infection Control', dosage: '1 Tablet' },
        { time: '08:00 PM', medicine: 'Painkiller', purpose: 'Relief', dosage: '1 Tablet' }
      ],
      sleepRecommendations: { duration: '8 Hours', bedtime: '10:30 PM', wakeupTime: '06:30 AM' },
      dailyRoutine: [{ time: '05:00 PM', activity: '15 min light walking' }]
    });
  }
});

// ── POST /ai/save-plan ────────────────────────────────────────────────────
aiRoutes.post('/save-plan', verifyToken, async (c) => {
  const user = c.get('user');
  const { plan, foodPreference } = await c.req.json();

  const { error } = await supabase.from('recovery_plans').upsert(
    { user_id: user.id, plan_json: JSON.stringify(plan), food_preference: foodPreference },
    { onConflict: 'user_id' }
  );

  if (error) return c.json({ error: error.message }, 500);
  return c.json({ message: 'Plan saved successfully' });
});

// ── GET /ai/today-plan ────────────────────────────────────────────────────
aiRoutes.get('/today-plan', verifyToken, async (c) => {
  const user = c.get('user');
  const { data, error } = await supabase.from('recovery_plans').select('*').eq('user_id', user.id).single();
  if (error || !data) return c.json({ plan: null, message: 'No plan found' });

  return c.json({ plan: JSON.parse(data.plan_json), foodPreference: data.food_preference, createdAt: data.created_at });
});

// ── POST /ai/analyze — AI symptom analysis + new checkin ──────────────────
aiRoutes.post('/analyze', verifyToken, async (c) => {
  const user = c.get('user');
  const { symptoms, language } = await c.req.json();
  if (!symptoms) return c.json({ error: 'symptoms required' }, 400);

  try {
    const { GoogleGenerativeAI } = await import('npm:@google/generative-ai');
    const genAI = new GoogleGenerativeAI(Deno.env.get('GEMINI_API_KEY') || '');
    const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });

    const prompt = `You are a medical AI assistant. A patient reports: "${symptoms}".
Provide brief, compassionate health guidance. Keep it to 2-3 sentences. If symptoms are severe, strongly advise seeing a doctor.
Respond in ${language || 'English'}.`;

    const result = await model.generateContent(prompt);
    const aiResponse = result.response.text();

    // Save to Supabase
    await supabase.from('patient_symptoms_summary').upsert(
      { patient_id: user.id, summary: aiResponse, feels_better: false },
      { onConflict: 'patient_id' }
    );

    return c.json({ analysis: aiResponse });
  } catch (err: any) {
    return c.json({ analysis: 'Please consult a doctor for your symptoms.' });
  }
});

// ── POST /ai/checkin/new-symptoms ─────────────────────────────────────────
aiRoutes.post('/checkin/symptoms', verifyToken, async (c) => {
  const user = c.get('user');
  const { symptoms } = await c.req.json();
  if (!symptoms) return c.json({ error: 'symptoms required' }, 400);

  try {
    const { GoogleGenerativeAI } = await import('npm:@google/generative-ai');
    const genAI = new GoogleGenerativeAI(Deno.env.get('GEMINI_API_KEY') || '');
    const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });

    const prompt = `Patient reports: "${symptoms}". Summarize in 1 sentence for a doctor's dashboard.`;
    const result = await model.generateContent(prompt);
    const summary = result.response.text().trim();

    await supabase.from('patient_symptoms_summary').upsert(
      { patient_id: user.id, summary, feels_better: false },
      { onConflict: 'patient_id' }
    );

    return c.json({ message: 'Symptoms logged', summary });
  } catch {
    return c.json({ message: 'Symptoms logged', summary: symptoms });
  }
});

export default aiRoutes;
