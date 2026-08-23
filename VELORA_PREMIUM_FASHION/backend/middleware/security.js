import crypto from 'node:crypto';

const SAFE_METHODS = new Set(['GET','HEAD','OPTIONS']);
const isProduction = process.env.NODE_ENV === 'production';

export function csrfTokenMiddleware(req, res, next) {
  if (req.path === '/payments/webhook') return next();
  let token = req.headers['x-csrf-token'] || req.cookies?.['velora_csrf'];
  if (!token) token = crypto.randomBytes(32).toString('base64url');
  res.setHeader('Set-Cookie', `velora_csrf=${encodeURIComponent(token)}; Path=/; SameSite=Lax${isProduction ? '; Secure' : ''}`);
  res.locals.csrfToken = token;
  if (!SAFE_METHODS.has(req.method)) {
    const supplied = req.get('x-csrf-token');
    const cookie = parseCookie(req.get('cookie') || '').velora_csrf;
    if (!supplied || !cookie) return res.status(403).json({ message: 'CSRF validation failed.' });
    const a = Buffer.from(String(supplied)); const b = Buffer.from(String(cookie));
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
      return res.status(403).json({ message: 'CSRF validation failed.' });
    }
  }
  next();
}

function parseCookie(header) {
  return Object.fromEntries(header.split(';').map(v => v.trim().split('=').map(decodeURIComponent)).filter(v => v.length === 2));
}

export function csrfEndpoint(_req, res) {
  const token = crypto.randomBytes(32).toString('base64url');
  res.setHeader('Set-Cookie', `velora_csrf=${encodeURIComponent(token)}; Path=/; SameSite=Lax${isProduction ? '; Secure' : ''}`);
  res.json({ csrfToken: token });
}

export function originGuard(req, res, next) {
  if (SAFE_METHODS.has(req.method)) return next();
  const origin = req.get('origin');
  const allowed = (process.env.CORS_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean);
  if (origin && allowed.length && !allowed.includes(origin)) return res.status(403).json({ message: 'Origin not allowed.' });
  next();
}
