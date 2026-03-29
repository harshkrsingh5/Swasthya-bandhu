const Database = require('better-sqlite3');
const db = new Database('database.db');

const userId = 1; // demo user
const plan = {
  mealPlan: [{ time: '08:00 AM', meal: 'Oatmeal', details: 'Light' }],
  medicineTiming: [{ time: '09:00 AM', medicine: 'Antibiotic', purpose: 'Infection', dosage: '1 Tab' }],
  hydrationSchedule: { dailyTarget: '2 Liters', reminders: ['10:00 AM'] },
  sleepRecommendations: { bedtime: '10:30 PM', wakeupTime: '06:30 AM' },
  dailyRoutine: []
};
const foodPreference = 'Any';

try {
  // Step 1: Clear reminders
  console.log('Step 1: Clearing reminders...');
  const clearStmt = db.prepare(`DELETE FROM reminders WHERE user_id = ? AND completed = 0`);
  clearStmt.run(userId);
  console.log('✅ Cleared reminders');

  // Step 2: Insert medicine reminders
  console.log('Step 2: Inserting medicine reminders...');
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
    return t;
  };

  if (plan.medicineTiming && Array.isArray(plan.medicineTiming)) {
    plan.medicineTiming.forEach(med => {
      const timeStr = parseToTimeStr(med.time);
      console.log(`  Inserting medicine reminder at ${timeStr}`);
      insertReminder.run(userId, timeStr, `Time for your medicine: ${med.medicine}. ${med.purpose}`, 'medicine');
    });
  }

  if (plan.mealPlan && Array.isArray(plan.mealPlan)) {
    plan.mealPlan.forEach(meal => {
      const timeStr = parseToTimeStr(meal.time);
      console.log(`  Inserting meal reminder at ${timeStr}`);
      insertReminder.run(userId, timeStr, `Time for your meal: ${meal.meal}`, 'diet');
    });
  }
  console.log('✅ Inserted reminders');

  // Step 3: Upsert recovery plan
  console.log('Step 3: Upserting recovery plan...');
  const savePlanStmt = db.prepare(`
    INSERT INTO recovery_plans (user_id, plan_json, food_preference)
    VALUES (?, ?, ?)
    ON CONFLICT(user_id) DO UPDATE SET
      plan_json = excluded.plan_json,
      food_preference = excluded.food_preference,
      created_at = CURRENT_TIMESTAMP
  `);
  savePlanStmt.run(userId, JSON.stringify(plan), foodPreference || 'Veg');
  console.log('✅ Recovery plan saved!');

} catch (e) {
  console.error('❌ ERROR:', e.message);
  console.error('Full error:', e);
}
