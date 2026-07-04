import express from 'express';
import cors from 'cors';
import { healthRouter } from './routes/health.js';
import { requireAuth } from './middleware/auth.js';

export function createApp() {
  const app = express();
  app.use(cors());
  app.use(express.json());
  app.use(healthRouter);
  app.use(requireAuth);
  // authenticated routers are added by later tasks below this line
  app.get('/abbreviations', (_req, res) => res.status(200).json([]));
  return app;
}

if (process.env.NODE_ENV !== 'test' && import.meta.url === `file://${process.argv[1]}`) {
  const app = createApp();
  const port = process.env.PORT ?? 3000;
  app.listen(port, () => console.log(`strong-notes-api listening on ${port}`));
}
