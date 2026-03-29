import { Hono } from 'npm:hono@3';
import { supabase } from '../utils/db.ts';
import * as bcrypt from 'https://deno.land/x/bcrypt@v0.4.1/mod.ts';
import jwt from 'npm:jsonwebtoken';

const authRoutes = new Hono();

authRoutes.post('/register', async (c) => {
  const { username, email, password } = await c.req.json();
  if (!username || !email || !password) return c.json({ error: 'All fields required' }, 400);

  try {
    const salt = await bcrypt.genSalt(10);
    const hash = await bcrypt.hash(password, salt);

    const { data: user, error } = await supabase
      .from('users')
      .insert([{ username, email, password: hash }])
      .select('id, username, email')
      .single();

    if (error) {
       if (error.code === '23505') return c.json({ error: 'User already exists' }, 400);
       throw error;
    }

    const token = jwt.sign({ id: user.id }, Deno.env.get('JWT_SECRET') || 'swasthya_bandhu_secret_key_12345_secure_key', { expiresIn: '7d' });
    return c.json({ token, user });
  } catch (err) {
    console.error(err);
    return c.json({ error: 'Database error' }, 500);
  }
});

authRoutes.post('/login', async (c) => {
  const { email, password } = await c.req.json();
  if (!email || !password) return c.json({ error: 'All fields required' }, 400);

  const { data: user, error } = await supabase
    .from('users')
    .select('*')
    .eq('email', email)
    .single();

  if (error || !user) return c.json({ error: 'User not found' }, 404);

  const isValid = await bcrypt.compare(password, user.password);
  if (!isValid) return c.json({ error: 'Invalid credentials' }, 401);

  const token = jwt.sign({ id: user.id }, Deno.env.get('JWT_SECRET') || 'swasthya_bandhu_secret_key_12345_secure_key', { expiresIn: '7d' });
  return c.json({ token, user: { id: user.id, username: user.username, email: user.email } });
});

export default authRoutes;
