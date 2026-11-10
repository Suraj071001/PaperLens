import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { db } from '@paperlens/db';
import { createApp } from '../apps/api/src/app.js';
import { analysisQueue, cleanupQueue, config, retrieve } from '@paperlens/ai';
import { createWorkflow, makeCheckpointer, executeRun, configKey } from '@paperlens/ai/workflow';
import { ensureBucket, deletePdf } from '@paperlens/ai/storage';
import { FakeProvider } from './fake-provider.js';
import { makePdf } from './fixtures.js';
import { cleanupProject } from '../packages/ai/src/cleanup.js';
import { readPdf } from '@paperlens/ai/storage';
const provider = new FakeProvider();
const app = createApp(provider);
const a = request.agent(app),
  b = request.agent(app);
let csrfA = '',
  csrfB = '',
  projectId = '',
  otherProject = '',
  runId = '',
  paperId = '';
const emails = [`test-a-${randomUUID()}@example.test`, `test-b-${randomUUID()}@example.test`];
let cp: Awaited<ReturnType<typeof makeCheckpointer>>;
let graph: Awaited<ReturnType<typeof createWorkflow>>;
beforeAll(async () => {
  await db.$queryRaw`SELECT 1`;
  await ensureBucket();
  cp = await makeCheckpointer();
  graph = await createWorkflow(cp, provider);
  for (const [i, agent] of [a, b].entries()) {
    const r = await agent
      .post('/api/v1/auth/signup')
      .set('Origin', config.WEB_ORIGIN)
      .send({ email: emails[i], password: 'test-password-at-least-12' });
    expect(r.status).toBe(201);
    if (i === 0) csrfA = r.body.csrf;
    else csrfB = r.body.csrf;
  }
});
afterAll(async () => {
  for (const user of await db.user.findMany({
    where: { email: { in: emails } },
    include: { projects: { include: { papers: true, runs: true } } },
  })) {
    for (const p of user.projects) {
      for (const paper of p.papers) await deletePdf(paper.storageKey);
      for (const run of p.runs) {
        const job = await analysisQueue.getJob(run.id);
        if (job) await job.remove();
        await cp?.deleteThread(run.id);
      }
    }
    await db.user.delete({ where: { id: user.id } });
  }
  await cp?.end();
  await analysisQueue.close();
  await cleanupQueue.close();
  await db.$disconnect();
});
describe('real storage/database pipeline with test-only AI', () => {
  it('protects unauthenticated and cross-origin requests', async () => {
    expect((await request(app).get('/api/v1/projects')).status).toBe(401);
    expect((await a.post('/api/v1/projects').send({ name: 'CSRF' })).status).toBe(403);
    expect(
      (await a.post('/api/v1/projects').set('Origin', config.WEB_ORIGIN).send({ name: 'No token' }))
        .status,
    ).toBe(403);
  });
  it('creates isolated projects', async () => {
    const r = await a
      .post('/api/v1/projects')
      .set('Origin', config.WEB_ORIGIN)
      .set('x-csrf-token', csrfA)
      .send({ name: 'Integration research' });
    expect(r.status).toBe(201);
    projectId = r.body.id;
    const s = await b
      .post('/api/v1/projects')
      .set('Origin', config.WEB_ORIGIN)
      .set('x-csrf-token', csrfB)
      .send({ name: 'Other user' });
    otherProject = s.body.id;
    expect((await b.get(`/api/v1/projects/${projectId}`)).status).toBe(404);
  });
  it('rejects disguised uploads and accepts two real PDFs', async () => {
    const bad = await a
      .post(`/api/v1/projects/${projectId}/uploads`)
      .set('Origin', config.WEB_ORIGIN)
      .set('x-csrf-token', csrfA)
      .attach('files', Buffer.from('not a PDF content, definitely'), { filename: 'fake.pdf' });
    expect(bad.status).toBe(400);
    const p1 = await makePdf('Study Alpha'),
      p2 = await makePdf('Study Beta');
    const r = await a
      .post(`/api/v1/projects/${projectId}/uploads`)
      .set('Origin', config.WEB_ORIGIN)
      .set('x-csrf-token', csrfA)
      .attach('files', p1, { filename: 'alpha.pdf' })
      .attach('files', p2, { filename: 'beta.pdf' });
    expect(r.status).toBe(201);
    expect(r.body.papers).toHaveLength(2);
    paperId = r.body.papers[0].id;
    const dup = await a
      .post(`/api/v1/projects/${projectId}/uploads`)
      .set('Origin', config.WEB_ORIGIN)
      .set('x-csrf-token', csrfA)
      .attach('files', p1, { filename: 'renamed.pdf' });
    expect(dup.body.duplicates).toBe(1);
    expect((await b.get(`/api/v1/papers/${paperId}/file`)).status).toBe(404);
    expect((await a.get(`/api/v1/papers/${paperId}/file`)).headers['content-type']).toContain(
      'application/pdf',
    );
  });
  it('deduplicates jobs and resumes checkpoints without repeating completed evidence', async () => {
    const start = () =>
      a
        .post(`/api/v1/projects/${projectId}/runs`)
        .set('Origin', config.WEB_ORIGIN)
        .set('x-csrf-token', csrfA)
        .send({});
    const [r1, r2] = await Promise.all([start(), start()]);
    expect(r1.status).toBe(202);
    expect(r1.body.id).toBe(r2.body.id);
    runId = r1.body.id;
    provider.failOnce = true;
    await expect(executeRun(graph, runId)).rejects.toThrow('Simulated');
    expect(await db.paperSummary.count({ where: { paper: { projectId } } })).toBe(2);
    const before = provider.calls;
    await executeRun(graph, runId);
    expect(provider.calls - before).toBe(2);
    const calls = provider.calls;
    await executeRun(graph, runId);
    expect(provider.calls).toBe(calls);
    expect((await db.analysisRun.findUniqueOrThrow({ where: { id: runId } })).status).toBe(
      'completed',
    );
    expect((await a.get(`/api/v1/projects/${projectId}`)).body.runs[0].status).toBe('completed');
  });
  it('persists results with full page coverage and protects their endpoints', async () => {
    const r = await a.get(`/api/v1/projects/${projectId}/results`);
    expect(r.status).toBe(200);
    expect(r.body.summaries).toHaveLength(2);
    expect(r.body.result.output.rows).toHaveLength(13);
    const chunks = await db.documentChunk.findMany({ where: { paperId } });
    expect(new Set(chunks.map((c) => c.page))).toEqual(new Set([1, 2]));
    expect((await b.get(`/api/v1/projects/${projectId}/results`)).status).toBe(404);
    expect((await b.get(`/api/v1/runs/${runId}`)).status).toBe(404);
  });
  it('scopes retrieval to ownership and saves cited chat', async () => {
    const userB = await db.user.findUniqueOrThrow({ where: { email: emails[1] } });
    expect(
      await retrieve(userB.id, projectId, [paperId], 'retrieval', configKey),
    ).toEqual([]);
    const foreign = await a
      .post(`/api/v1/projects/${projectId}/chat`)
      .set('Origin', config.WEB_ORIGIN)
      .set('x-csrf-token', csrfA)
      .send({ question: 'What methods?', paperIds: [randomUUID()] });
    expect(foreign.status).toBe(400);
    const answer = await a
      .post(`/api/v1/projects/${projectId}/chat`)
      .set('Origin', config.WEB_ORIGIN)
      .set('x-csrf-token', csrfA)
      .send({ question: 'What methods?', paperIds: [paperId] });
    expect(answer.status).toBe(200);
    expect(answer.body.answer.citations[0].paperId).toBe(paperId);
    expect(
      (await a.get(`/api/v1/projects/${projectId}/conversations`)).body[0].messages,
    ).toHaveLength(2);
    const cross = await b
      .post(`/api/v1/projects/${otherProject}/chat`)
      .set('Origin', config.WEB_ORIGIN)
      .set('x-csrf-token', csrfB)
      .send({
        question: 'What methods?',
        paperIds: [paperId],
        conversationId: answer.body.conversationId,
      });
    expect(cross.status).toBe(400);
  });
  it('exports Markdown and PDF including citations', async () => {
    const md = await a.get(`/api/v1/projects/${projectId}/exports?format=md`);
    expect(md.status).toBe(200);
    expect(md.text).toContain('PDF p. 1');
    expect(md.text).toContain('Retrieval study');
    const pdf = await a.get(`/api/v1/projects/${projectId}/exports?format=pdf`);
    expect(pdf.status).toBe(200);
    expect(pdf.headers['content-type']).toContain('application/pdf');
    expect((await b.get(`/api/v1/projects/${projectId}/exports?format=md`)).status).toBe(404);
  });
  it('deletes project objects, checkpoints and related records idempotently', async () => {
    const paper = await db.paper.findUniqueOrThrow({ where: { id: paperId } });
    const response = await a
      .delete(`/api/v1/projects/${projectId}`)
      .set('Origin', config.WEB_ORIGIN)
      .set('x-csrf-token', csrfA);
    expect(response.status).toBe(202);
    expect((await a.get(`/api/v1/papers/${paperId}/file`)).status).toBe(404);
    await cleanupProject(projectId, cp);
    await cleanupProject(projectId, cp);
    expect(await db.documentChunk.count({ where: { paperId } })).toBe(0);
    expect(await db.comparisonResult.count({ where: { runId } })).toBe(0);
    expect(await cp.getTuple({ configurable: { thread_id: runId } })).toBeUndefined();
    await expect(readPdf(paper.storageKey)).rejects.toThrow();
    const job = await cleanupQueue.getJob(projectId);
    await job?.remove();
  });
});
