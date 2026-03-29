import { createClient } from 'npm:@supabase/supabase-js@2';

// Initialize Supabase Client for Edge Runtime
export const supabase = createClient(
  Deno.env.get('SUPABASE_URL') || '',
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || Deno.env.get('SUPABASE_ANON_KEY') || ''
);
