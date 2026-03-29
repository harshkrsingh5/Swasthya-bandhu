import { Hono } from 'npm:hono@3';
import { cors } from 'npm:hono@3/cors';
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';

const app = new Hono();

// Global CORS Middleware (Essential for Edge Functions)
app.use('*', cors({
  origin: '*', // Adjust to specific frontend domain in production
  allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowHeaders: ['Content-Type', 'Authorization'],
}));

// Route imports
import authRoutes from './routes/auth.ts';
import checkinRoutes from './routes/checkin.ts';
import dashboardRoutes from './routes/dashboard.ts';
import hospitalRoutes from './routes/hospital.ts';
import twilioRoutes from './routes/twilio.ts';
import voiceRoutes from './routes/voice.ts';
import reminderRoutes from './routes/reminders.ts';
import aiRoutes from './routes/ai.ts';

// Register Routers
app.route('/api/auth', authRoutes);
app.route('/api/checkin', checkinRoutes);
app.route('/api/dashboard', dashboardRoutes);
app.route('/api/hospital', hospitalRoutes);
app.route('/api/twilio', twilioRoutes);
app.route('/api/voice', voiceRoutes);
app.route('/api/reminders', reminderRoutes);
app.route('/api/ai', aiRoutes);

app.get('/api/health', (c) => c.json({ status: 'Supabase Edge Serverless is running', version: '2.0.0' }));

serve(app.fetch);
