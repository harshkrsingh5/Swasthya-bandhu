import { createMiddleware } from 'npm:hono@3/factory';
import jwt from 'npm:jsonwebtoken';

export const verifyToken = createMiddleware(async (c, next) => {
  const authHeader = c.req.header('authorization');
  const token = authHeader && authHeader.split(' ')[1];
  if (!token) return c.json({ error: 'Access denied. Token missing.' }, 401);

  // ── DEMO BYPASS: token_demo or token_<uuid> (same as original server.js) ──
  if (token === 'token_demo') {
    c.set('user', { id: 'demo-test-user-uuid', email: 'demo@swasthyabandhu.in' });
    return await next();
  }
  
  // ABHA / Fake token from ABHA login: token_<supabase-user-id>
  if (token.startsWith('token_')) {
    const userId = token.replace('token_', '');
    c.set('user', { id: userId, email: 'abha@swasthyabandhu.in' });
    return await next();
  }

  // ── REAL JWT (email/password login via Supabase Auth) ────────────────────
  try {
    const user = jwt.verify(token, Deno.env.get('JWT_SECRET') || 'swasthya_bandhu_secret_key_12345_secure_key');
    c.set('user', user);
    await next();
  } catch (err) {
    // Also try treating it as a Supabase Auth JWT (they're JWTs too)
    try {
      const decoded = JSON.parse(atob(token.split('.')[1]));
      if (decoded && decoded.sub) {
        c.set('user', { id: decoded.sub, email: decoded.email || '' });
        return await next();
      }
    } catch {}
    return c.json({ error: 'Invalid token.' }, 403);
  }
});

