import { Hono } from 'npm:hono@3';
import { supabase } from '../utils/db.ts';
import { verifyToken } from '../utils/auth.ts';

const reminderRoutes = new Hono();

reminderRoutes.get('/', verifyToken, async (c) => {
  const user = c.get('user');
  const { data, error } = await supabase
    .from('reminders')
    .select('*')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false });

  if (error) return c.json({ error: error.message }, 500);
  return c.json(data || []);
});

reminderRoutes.post('/', verifyToken, async (c) => {
  const user = c.get('user');
  const { time, text, type } = await c.req.json();
  if (!time || !text) return c.json({ error: 'time and text are required' }, 400);

  const { data, error } = await supabase
    .from('reminders')
    .insert([{ user_id: user.id, time, text, type: type || 'medicine' }])
    .select('*')
    .single();

  if (error) return c.json({ error: error.message }, 500);
  return c.json(data, 201);
});

reminderRoutes.put('/:id', verifyToken, async (c) => {
  const user = c.get('user');
  const id = c.req.param('id');
  const body = await c.req.json();

  const { data, error } = await supabase
    .from('reminders')
    .update(body)
    .eq('id', id)
    .eq('user_id', user.id)
    .select('*')
    .single();

  if (error) return c.json({ error: error.message }, 500);
  return c.json(data);
});

reminderRoutes.delete('/:id', verifyToken, async (c) => {
  const user = c.get('user');
  const id = c.req.param('id');

  const { error } = await supabase
    .from('reminders')
    .delete()
    .eq('id', id)
    .eq('user_id', user.id);

  if (error) return c.json({ error: error.message }, 500);
  return c.json({ message: 'Reminder deleted' });
});

reminderRoutes.post('/:id/complete', verifyToken, async (c) => {
  const user = c.get('user');
  const id = c.req.param('id');

  const { data, error } = await supabase
    .from('reminders')
    .update({ completed: true, completed_at: new Date().toISOString() })
    .eq('id', id)
    .eq('user_id', user.id)
    .select('*')
    .single();

  if (error) return c.json({ error: error.message }, 500);
  return c.json(data);
});

export default reminderRoutes;
