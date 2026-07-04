import type { Request, Response, NextFunction } from 'express';
import { timingSafeEqual } from 'node:crypto';

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  const apiToken = process.env.API_TOKEN;
  if (!apiToken) {
    return res.status(500).json({ error: 'server misconfigured: API_TOKEN not set' });
  }

  const header = req.headers.authorization;
  const expected = `Bearer ${apiToken}`;
  const headerBuf = Buffer.from(header ?? '');
  const expectedBuf = Buffer.from(expected);
  const matches =
    headerBuf.length === expectedBuf.length && timingSafeEqual(headerBuf, expectedBuf);

  if (!matches) {
    return res.status(401).json({ error: 'unauthorized' });
  }
  next();
}
