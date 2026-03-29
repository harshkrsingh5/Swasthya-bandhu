import { Hono } from 'npm:hono@3';
import { supabase } from '../utils/db.ts';
import { verifyToken } from '../utils/auth.ts';

const hospitalRoutes = new Hono();

hospitalRoutes.get('/', verifyToken, async (c) => {
  try {
    const { data: users, error: userError } = await supabase.from('users').select('id, username');
    if (userError || !users) return c.json({ error: 'Failed to fetch users' }, 500);

    const patients = await Promise.all(users.map(async (user: any) => {
      const { data: checkins } = await supabase.from('checkins').select('*').eq('user_id', user.id).order('date', { ascending: false }).limit(7);
      const { data: logs } = await supabase.from('voice_logs').select('*').eq('user_id', user.id).order('created_at', { ascending: false }).limit(5);

      const checkinsList = checkins || [];
      const logsList = logs || [];

      const latestCheckin = checkinsList.length > 0 ? checkinsList[0] : null;
      let condition = "Stable";
      
      if (latestCheckin) {
        if (!latestCheckin.medicine_taken || latestCheckin.water_intake < 5 || latestCheckin.sleep_hours < 5) {
          condition = "Critical";
        }
      }

      let avgWater = 0;
      let medAdherence = 0;
      let avgSleep = 0;
      if (checkinsList.length > 0) {
         avgWater = Math.round(checkinsList.reduce((s: any, req: any) => s + (req.water_intake || 0), 0) / checkinsList.length);
         medAdherence = Math.round((checkinsList.filter((r: any) => r.medicine_taken).length / checkinsList.length) * 100);
         avgSleep = parseFloat((checkinsList.reduce((s: any, req: any) => s + (req.sleep_hours || 0), 0) / checkinsList.length).toFixed(1));
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
        checkins: checkinsList.slice(0, 3).map((r: any) => ({
          date: r.date,
          water: r.water_intake,
          sleep: r.sleep_hours,
          painLevel: (r.symptoms && r.symptoms.length > 5) ? 7 : 2,
          medicineTaken: r.medicine_taken
        })),
        logs: logsList.map((l: any) => ({
          date: new Date(l.created_at).toLocaleTimeString(),
          message: l.message
        }))
      };
    }));
    
    return c.json(patients);
  } catch (err) {
    console.error("Hospital API Error:", err);
    return c.json({ error: 'Server error' }, 500);
  }
});

hospitalRoutes.get('/critical', verifyToken, async (c) => {
  const { data, error } = await supabase
    .from('patient_data')
    .select('id, overall_risk_category, overall_risk_score, systolic_bp, heart_rate')
    .eq('overall_risk_category', 'High')
    .order('overall_risk_score', { ascending: false })
    .limit(20);

  if (error) return c.json({ error: error.message }, 500);
  return c.json({ patients: data || [] });
});

hospitalRoutes.get('/search/:id', verifyToken, async (c) => {
  const { id } = c.req.param();
  
  const { data, error } = await supabase
    .from('patient_data')
    .select('*')
    .eq('id', id)
    .single();

  if (error || !data) {
    return c.json({ error: 'Patient not found in dataset' }, 404);
  }

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

  return c.json(patientObj);
});

hospitalRoutes.get('/symptoms', verifyToken, async (c) => {
  try {
    const { data, error } = await supabase.from('patient_symptoms_summary').select('*');
    if (error) return c.json({ error: error.message }, 500);

    const mapped: Record<string, any> = {};
    if (data) {
      data.forEach((r: any) => {
        mapped[r.patient_id] = { summary: r.summary, feelsBetter: !!r.feels_better, updatedAt: r.created_at };
      });
    }
    return c.json(mapped);
  } catch (error) {
    return c.json({ error: 'Failed to fetch symptoms' }, 500);
  }
});

export default hospitalRoutes;
