const Database = require('better-sqlite3');
const db = new Database('database.db');

try {
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all();
  console.log('Tables:', tables.map(t => t.name).join(', '));

  const hasRecoveryPlans = tables.some(t => t.name === 'recovery_plans');
  if (hasRecoveryPlans) {
    const info = db.prepare('PRAGMA table_info(recovery_plans)').all();
    console.log('recovery_plans columns:', info.map(c => c.name).join(', '));
    const rows = db.prepare('SELECT count(*) as cnt FROM recovery_plans').get();
    console.log('recovery_plans row count:', rows.cnt);
  } else {
    console.log('ERROR: recovery_plans table NOT FOUND in database.db');
  }

  // Test insert
  const hasUsers = tables.some(t => t.name === 'users');
  if (hasUsers) {
    const users = db.prepare('SELECT id, username FROM users LIMIT 5').all();
    console.log('Users:', JSON.stringify(users));
  }
} catch(e) {
  console.error('DB Error:', e.message);
}
