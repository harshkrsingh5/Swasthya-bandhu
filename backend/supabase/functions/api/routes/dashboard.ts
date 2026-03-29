import { Hono } from 'npm:hono@3';
import { supabase } from '../utils/db.ts';
import { verifyToken } from '../utils/auth.ts';

const dashboardRoutes = new Hono();

dashboardRoutes.get('/stats', verifyToken, async (c) => {
  const user = c.get('user');
  const today = new Date().toISOString().split('T')[0];

  const [checkinData, remindersData, logsData] = await Promise.all([
    supabase.from('checkins').select('*').eq('user_id', user.id).eq('date', today).single(),
    supabase.from('reminders').select('*').eq('user_id', user.id),
    supabase.from('voice_logs').select('*').eq('user_id', user.id).order('created_at', { ascending: false }).limit(5)
  ]);

  const reminders = remindersData.data || [];
  const pendingTasks = reminders.filter(r => !r.completed).length;
  const completedTasks = reminders.filter(r => r.completed).length;
  const healthScore = checkinData.data ? 85 : 70;

  return c.json({
    healthScore,
    pendingTasks,
    completedTasks,
    recentLogs: logsData.data || []
  });
});

export default dashboardRoutes;
