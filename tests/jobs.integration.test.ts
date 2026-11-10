import { it, expect, afterAll } from 'vitest';
import { Queue, QueueEvents, Worker } from 'bullmq';
import { randomUUID } from 'node:crypto';
import { redisOptions, analysisQueue, cleanupQueue } from '@paperlens/ai';
const connection = redisOptions();
const name = `paperlens-test-${randomUUID()}`;
const queue = new Queue(name, { connection });
const events = new QueueEvents(name, { connection });
let attempts = 0;
const worker = new Worker(
  name,
  async () => {
    attempts++;
    if (attempts === 1) throw new Error('Test-only transient failure');
    return 'persisted';
  },
  { connection },
);
afterAll(async () => {
  await worker.close();
  await events.close();
  await queue.obliterate({ force: true });
  await queue.close();
  await analysisQueue.close();
  await cleanupQueue.close();
});
it('BullMQ retries with backoff and deduplicates an idempotent job', async () => {
  await events.waitUntilReady();
  const job = await queue.add(
    'test',
    {},
    { jobId: 'same-work', attempts: 3, backoff: { type: 'exponential', delay: 100 } },
  );
  const duplicate = await queue.add('test', {}, { jobId: 'same-work' });
  expect(duplicate.id).toBe(job.id);
  expect(await job.waitUntilFinished(events, 15000)).toBe('persisted');
  expect(attempts).toBe(2);
});
