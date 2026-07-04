import type { Request, Response, NextFunction } from 'express';

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  const expected = `Bearer ${process.env.API_TOKEN}`;
  if (!header || header !== expected) {
    return res.status(401).json({ error: 'unauthorized' });
  }
  next();
}
