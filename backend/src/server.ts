import express from 'express';
import cors from 'cors';
import { healthRouter } from './routes/health.js';
import { requireAuth } from './middleware/auth.js';
import { resolveRouter } from './routes/resolve.js';
import { abbreviationsRouter } from './routes/abbreviations.js';
import { sessionsRouter } from './routes/sessions.js';
import { goalsRouter } from './routes/goals.js';
import { errorHandler } from './middleware/errorHandler.js';

export function createApp() {
  const app = express();
  app.use(cors());
  app.use(express.json());
  app.use(healthRouter);
  app.use(requireAuth);
  // authenticated routers are added by later tasks below this line
  app.use(resolveRouter);
  app.use(abbreviationsRouter);
  app.use(sessionsRouter);
  app.use(goalsRouter);
  // must be mounted after all routers: catches errors forwarded via next(err)
  // from asyncHandler-wrapped routes so they become clean JSON 500s instead
  // of crashing the process.
  app.use(errorHandler);
  return app;
}

// Defense-in-depth: routes should always go through asyncHandler + errorHandler
// above, but this guards against any future async work started outside a
// request's promise chain (e.g. a fire-and-forget promise) so it can never
// bring the whole process down.
process.on('unhandledRejection', (reason) => {
  console.error('Unhandled promise rejection:', reason);
});

if (process.env.NODE_ENV !== 'test' && import.meta.url === `file://${process.argv[1]}`) {
  const app = createApp();
  const port = process.env.PORT ?? 3000;
  app.listen(port, () => console.log(`strong-notes-api listening on ${port}`));
}
