import { createApp } from './app.js';
import { ensureBucket } from '@paperlens/ai/storage';
import pino from 'pino';
const log = pino();
await ensureBucket();
const server = createApp().listen(Number(process.env.API_PORT || 4000), () =>
  log.info({ port: Number(process.env.API_PORT || 4000) }, 'API ready'),
);
process.on('SIGTERM', () => server.close(() => process.exit(0)));
