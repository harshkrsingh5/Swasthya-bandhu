// ── API Base URL ──────────────────────────────────────────────────────────────
// Currently pointing to local Node.js backend.
// Once Edge Function is deployed, change LOCAL_BACKEND to false.
//
// Edge Function URL (after deployment):
// https://abdblukbngbapatrqvkr.supabase.co/functions/v1/api

const LOCAL_BACKEND = true; // ← Using local backend for auth/checkins/reminders, Supabase directly for patient_data

const LOCAL_URL = 'http://localhost:5000/api';
const SUPABASE_URL = 'https://abdblukbngbapatrqvkr.supabase.co/functions/v1/api';

export const API_URL = LOCAL_BACKEND ? LOCAL_URL : SUPABASE_URL;

export default API_URL;
