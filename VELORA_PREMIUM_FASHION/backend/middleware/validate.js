import { z } from 'zod';

export const idParam = z.object({ id: z.string().min(1).max(200) });
export const money = z.number().finite().min(0).max(1_000_000_000);
export const quantity = z.number().int().min(1).max(1000);
export const email = z.string().trim().email().max(320).transform(v => v.toLowerCase());
export const strongPassword = z.string().min(12).max(128).regex(/[A-Z]/).regex(/[a-z]/).regex(/[0-9]/).regex(/[^A-Za-z0-9]/);

export function validateBody(schema) {
  return (req, res, next) => {
    const parsed = schema.safeParse(req.body ?? {});
    if (!parsed.success) return res.status(400).json({ message: 'Invalid request data.', issues: parsed.error.issues.map(i => ({ path: i.path, message: i.message })) });
    req.body = parsed.data;
    next();
  };
}
export function validateQuery(schema) {
  return (req, res, next) => {
    const parsed = schema.safeParse(req.query ?? {});
    if (!parsed.success) return res.status(400).json({ message: 'Invalid query parameters.', issues: parsed.error.issues });
    req.query = parsed.data;
    next();
  };
}
export function validateParams(schema) {
  return (req, res, next) => {
    const parsed = schema.safeParse(req.params ?? {});
    if (!parsed.success) return res.status(400).json({ message: 'Invalid path parameters.' });
    req.params = parsed.data;
    next();
  };
}
