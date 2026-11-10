import { Queue } from 'bullmq';
import { config } from './config.js';
export const redisOptions = () => {
  const u = new URL(config.REDIS_URL);
  return {
    host: u.hostname,
    port: Number(u.port || 6379),
    username: u.username || undefined,
    password: u.password || undefined,
    db: Number(u.pathname.slice(1) || 0),
    ...(u.protocol === 'rediss:' ? { tls: {} } : {}),
  };
};
export const analysisQueue = new Queue('paperlens-analysis', {
  connection: redisOptions(),
  defaultJobOptions: {
    attempts: 5,
    backoff: { type: 'exponential', delay: 15000 },
    removeOnComplete: true,
    removeOnFail: 100,
  },
});
export const cleanupQueue = new Queue('paperlens-cleanup', {
  connection: redisOptions(),
  defaultJobOptions: {
    attempts: 10,
    backoff: { type: 'exponential', delay: 2000 },
    removeOnComplete: true,
  },
});
export async function enqueueRun(id: string) {
  const old = await analysisQueue.getJob(id);
  if (old && (await old.getState()) === 'failed') await old.remove();
  await analysisQueue.add('analyze', { runId: id }, { jobId: id });
}
