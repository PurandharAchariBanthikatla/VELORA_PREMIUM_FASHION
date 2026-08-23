import { verifyAccessToken } from "../utils/jwt.js";
import { isAccessTokenRevoked } from "../services/redis.service.js";

function extractToken(req) {
  const header = req.headers.authorization || "";
  return header.startsWith("Bearer ") ? header.slice(7) : null;
}

export async function requireAuth(req, res, next) {
  const token = extractToken(req);

  if (!token) {
    res.status(401).json({ message: "Please sign in to continue." });
    return;
  }

  try {
    const payload = verifyAccessToken(token);
    // Redis-backed revocation lets logout/password-change invalidate an
    // access token immediately instead of waiting out its ~15-minute
    // lifetime. If Redis is unavailable, isAccessTokenRevoked fails open
    // (treats the token as not revoked) rather than locking everyone out.
    if (await isAccessTokenRevoked(payload.jti)) {
      res.status(401).json({ message: "Your session has expired. Please sign in again." });
      return;
    }
    req.user = payload;
    next();
  } catch {
    res.status(401).json({ message: "Your session has expired. Please sign in again." });
  }
}

export async function optionalAuth(req, _res, next) {
  const token = extractToken(req);
  if (token) {
    try {
      const payload = verifyAccessToken(token);
      req.user = (await isAccessTokenRevoked(payload.jti)) ? null : payload;
    } catch {
      req.user = null;
    }
  }
  next();
}

export function requireAdmin(req, res, next) {
  if (!req.user || req.user.role !== "admin") {
    res.status(403).json({ message: "Admin access required." });
    return;
  }
  next();
}
