import { Hono } from 'npm:hono@3';
import { supabase } from '../utils/db.ts';
import { verifyToken } from '../utils/auth.ts';

const checkinRoutes = new Hono();

checkinRoutes.post('/', verifyToken, async (c) => {
  const user = c.get('user');
  const { date, waterIntake, medicineTaken, sleepHours, symptoms, mood } = await c.req.json();

  const { data, error } = await supabase
    .from('checkins')
    .upsert(
      { user_id: user.id, date, water_intake: waterIntake, medicine_taken: medicineTaken, sleep_hours: sleepHours, symptoms, mood },
      { onConflict: 'user_id, date' }
    )
    .select('id')
    .single();

  if (error) return c.json({ error: error.message }, 500);
  return c.json({ message: 'Check-in saved', id: data.id });
});

checkinRoutes.get('/today', verifyToken, async (c) => {
  const user = c.get('user');
  const date = new Date().toISOString().split('T')[0];
  const { data, error } = await supabase.from('checkins').select('*').eq('user_id', user.id).eq('date', date).single();
  if (error || !data) return c.json({ date, water_intake: 0, medicine_taken: false, sleep_hours: 0, symptoms: '', mood: '' });
  return c.json(data);
});

checkinRoutes.get('/week', verifyToken, async (c) => {
  const user = c.get('user');
  const { data, error } = await supabase.from('checkins').select('*').eq('user_id', user.id).order('date', { ascending: true }).limit(7);
  if (error) return c.json({ error: error.message }, 500);
  return c.json(data);
});

export default checkinRoutes;
