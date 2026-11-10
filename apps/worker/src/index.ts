import { Worker } from 'bullmq';
import { db } from '@paperlens/db';
import { config, redisOptions, analysisQueue, cleanupQueue, enqueueRun } from '@paperlens/ai';
import {
  makeCheckpointer,
  createWorkflow,
  executeRun,
  publicFailure,
} from '@paperlens/ai/workflow';
import { ensureBucket } from '@paperlens/ai/storage';
import { cleanupProject } from '../../../packages/ai/src/cleanup.js';
import pino from 'pino';
const log = pino();
await ensureBucket();
const checkpointer = await makeCheckpointer();
const graph = await createWorkflow(checkpointer);
const worker = new Worker(
  'paperlens-analysis',
  async (job) => {
    try {
      await executeRun(graph, job.data.runId);
    } catch (e) {
      await db.analysisRun.updateMany({
        where: { id: job.data.runId },
        data: {
          status: job.attemptsMade + 1 >= Number(job.opts.attempts || 1) ? 'failed' : 'queued',
          error: publicFailure(e),
        },
      });
      log.warn({ runId: job.data.runId, attempt: job.attemptsMade + 1 }, 'Analysis attempt failed');
      throw new Error(publicFailure(e));
    }
  },
  { connection: redisOptions(), concurrency: config.WORKER_CONCURRENCY },
);
const cleanup = new Worker(
  'paperlens-cleanup',
  async (job) => cleanupProject(job.data.projectId, checkpointer),
  { connection: redisOptions(), concurrency: 1 },
);
let reconciling = false;
async function reconcile() {
  if (reconciling) return;
  reconciling = true;
  try {
    await (
      await analysisQueue.client
    ).set('paperlens:worker:heartbeat', Date.now().toString(), { EX: 30 });
    for (const r of await db.analysisRun.findMany({
      where: { status: { in: ['queued', 'running'] }, project: { deleting: false } },
      take: 100,
    }))
      await enqueueRun(r.id);
    for (const p of await db.project.findMany({ where: { deleting: true }, take: 100 }))
      await cleanupQueue.add('project', { projectId: p.id }, { jobId: p.id });
  } catch {
    log.warn('Queue reconciliation failed');
  } finally {
    reconciling = false;
  }
}
await reconcile();
const timer = setInterval(() => void reconcile(), 10000);
worker.on('error', () => log.error('Worker connection error'));
cleanup.on('error', () => log.error('Cleanup connection error'));
log.info('PaperLens worker ready');
async function stop() {
  clearInterval(timer);
  await worker.close();
  await cleanup.close();
  await checkpointer.end();
  await analysisQueue.close();
  await cleanupQueue.close();
  await db.$disconnect();
  process.exit(0);
}
process.on('SIGTERM', stop);
process.on('SIGINT', stop);
