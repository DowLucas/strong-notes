import type { NextFunction, Request, RequestHandler, Response } from 'express';

/**
 * Wraps an async Express route handler so that a rejected promise (or thrown
 * error) is forwarded to `next(err)` instead of escaping as an unhandled
 * rejection. On Node 22 + Express 4, an unhandled rejection inside an async
 * handler crashes the whole process rather than just failing the request.
 */
export function asyncHandler(
  handler: (req: Request, res: Response, next: NextFunction) => Promise<unknown>,
): RequestHandler {
  return (req, res, next) => {
    Promise.resolve(handler(req, res, next)).catch(next);
  };
}
