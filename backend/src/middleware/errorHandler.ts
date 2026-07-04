import type { NextFunction, Request, Response } from 'express';

/**
 * Global Express error-handling middleware (must be mounted last, after all
 * routers). Catches errors forwarded via `next(err)` from asyncHandler-wrapped
 * routes (or thrown synchronously) and responds with a clean JSON 500 instead
 * of letting the error crash the process.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction) {
  console.error('Unhandled error in request handler:', err);
  if (res.headersSent) {
    return;
  }
  res.status(500).json({ error: 'internal error' });
}
