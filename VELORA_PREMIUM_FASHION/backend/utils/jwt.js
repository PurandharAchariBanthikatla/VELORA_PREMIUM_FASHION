import jwt from 'jsonwebtoken';
import crypto from 'node:crypto';
const isProduction=process.env.NODE_ENV==='production';
const ACCESS_SECRET=process.env.JWT_SECRET;
const REFRESH_SECRET=process.env.JWT_REFRESH_SECRET;
if(isProduction){
  if(!ACCESS_SECRET||!REFRESH_SECRET||ACCESS_SECRET.length<32||REFRESH_SECRET.length<32) throw new Error('JWT_SECRET and JWT_REFRESH_SECRET must be randomly generated secrets of at least 32 characters in production.');
  if(ACCESS_SECRET===REFRESH_SECRET) throw new Error('JWT_SECRET and JWT_REFRESH_SECRET must be different.');
}
const ACCESS=ACCESS_SECRET||'local-only-'+crypto.randomBytes(32).toString('hex');
const REFRESH=REFRESH_SECRET||'local-refresh-only-'+crypto.randomBytes(32).toString('hex');
const ACCESS_EXPIRES_IN=process.env.JWT_ACCESS_EXPIRES_IN||'15m'; const REFRESH_EXPIRES_IN=process.env.JWT_REFRESH_EXPIRES_IN||'7d';
export function signAccessToken(user){return jwt.sign({sub:user.id,email:user.email,role:user.role,name:user.name,type:'access',jti:crypto.randomUUID()},ACCESS,{expiresIn:ACCESS_EXPIRES_IN,algorithm:'HS256'});}
export function signRefreshToken(user){return jwt.sign({sub:user.id,type:'refresh',jti:crypto.randomUUID()},REFRESH,{expiresIn:REFRESH_EXPIRES_IN,algorithm:'HS256'});}
// Pinning `algorithms: ['HS256']` here is defense-in-depth against algorithm
// confusion attacks: without it, jsonwebtoken will accept ANY algorithm the
// token header claims, and while an `alg:none` forgery is already rejected
// (confirmed in testing), explicitly restricting to the one algorithm this
// app ever signs with closes off that entire class of attack rather than
// relying on the library's default behavior.
export function verifyAccessToken(token){const p=jwt.verify(token,ACCESS,{algorithms:['HS256']});if(p.type!=='access')throw new Error('Invalid token type');return p;}
export function verifyRefreshToken(token){const p=jwt.verify(token,REFRESH,{algorithms:['HS256']});if(p.type!=='refresh')throw new Error('Invalid token type');return p;}
export function hashToken(token){return crypto.createHash('sha256').update(token).digest('hex');}
export function tokensMatch(token,storedHash){if(!storedHash)return false;const a=Buffer.from(hashToken(token),'hex'),b=Buffer.from(storedHash,'hex');return a.length===b.length&&crypto.timingSafeEqual(a,b);}
