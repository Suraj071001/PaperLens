import express from 'express';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import multer from 'multer';
import { randomUUID } from 'node:crypto';
import PDFDocument from 'pdfkit';
import { z } from 'zod';
import { db, json, Prisma } from '@paperlens/db';
import {
  credentialsSchema,
  projectSchema,
  validatePdf,
  chatSchema,
  validateCitations,
  type Summary,
  type Comparison,
  type Claim,
} from '@paperlens/shared';
import {
  config,
  analysisConfig,
  analysisQueue,
  cleanupQueue,
  enqueueRun,
  retrieve,
  GroqProvider,
  type AIProvider,
} from '@paperlens/ai';
import { configKey, hash } from '@paperlens/ai/workflow';
import { storePdf, readPdf, deletePdf, s3, bucket } from '@paperlens/ai/storage';
import { HeadBucketCommand } from '@aws-sdk/client-s3';
import {
  authenticate,
  hashPassword,
  verifyPassword,
  startSession,
  tokenHash,
  cookieOptions,
} from './auth.js';
import { markdownExport } from './exports.js';
export const fail = (status: number, message: string) =>
  Object.assign(new Error(message), { status });
export function createApp(provider: AIProvider = new GroqProvider()) {
  const app = express();
  app.disable('x-powered-by');
  app.use(helmet({ crossOriginResourcePolicy: { policy: 'same-site' } }));
  app.use(cors({ origin: config.WEB_ORIGIN, credentials: true }));
  app.use(express.json({ limit: '32kb' }));
  app.use(cookieParser());
  app.use(
    '/api',
    rateLimit({
      windowMs: 60000,
      limit: 300,
      standardHeaders: 'draft-8',
      legacyHeaders: false,
      message: { error: { code: 'RATE_LIMIT', message: 'Too many requests. Try again shortly.' } },
    }),
  );
  app.use((req, _res, next) => {
    if (
      !['GET', 'HEAD', 'OPTIONS'].includes(req.method) &&
      req.header('origin') !== config.WEB_ORIGIN
    )
      return next(fail(403, 'Request origin not allowed'));
    next();
  });
  const authLimiter = rateLimit({
    windowMs: 15 * 60000,
    limit: 30,
    message: {
      error: { code: 'RATE_LIMIT', message: 'Too many sign-in attempts. Try again later.' },
    },
  });
  const aiLimiter = rateLimit({
    windowMs: 60000,
    limit: 10,
    message: {
      error: { code: 'RATE_LIMIT', message: 'AI request limit reached. Try again in a minute.' },
    },
  });
  app.get('/api/v1/health', async (_req, res) => {
    try {
      await db.$queryRaw`SELECT 1`;
      await s3.send(new HeadBucketCommand({ Bucket: bucket }));
      const heartbeat = await (await analysisQueue.client).get('paperlens:worker:heartbeat');
      res
        .status(heartbeat ? 200 : 503)
        .json({
          status: heartbeat ? 'ok' : 'degraded',
          worker: !!heartbeat,
          aiConfigured: !!config.GROQ_API_KEY,
        });
    } catch {
      res.status(503).json({ status: 'unavailable' });
    }
  });
  app.post('/api/v1/auth/signup', authLimiter, async (req, res) => {
    const input = credentialsSchema.parse(req.body);
    const user = await db.user.create({
      data: { email: input.email, passwordHash: await hashPassword(input.password) },
    });
    const csrf = await startSession(user.id, res);
    res.status(201).json({ id: user.id, email: user.email, csrf });
  });
  app.post('/api/v1/auth/login', authLimiter, async (req, res) => {
    const input = credentialsSchema.parse(req.body);
    const user = await db.user.findUnique({ where: { email: input.email } });
    const valid = await verifyPassword(
      input.password,
      user?.passwordHash || '00000000000000000000000000000000:' + '0'.repeat(128),
    );
    if (!user || !valid) throw fail(401, 'Email or password is incorrect');
    const csrf = await startSession(user.id, res);
    res.json({ id: user.id, email: user.email, csrf });
  });
  app.use('/api/v1', authenticate);
  app.get('/api/v1/auth/me', async (_req, res) => {
    const user = await db.user.findUniqueOrThrow({
      where: { id: res.locals.userId },
      select: { id: true, email: true, createdAt: true },
    });
    res.json({ ...user, csrf: res.locals.session.csrf });
  });
  app.post('/api/v1/auth/logout', async (req, res) => {
    await db.session.deleteMany({ where: { id: tokenHash(req.cookies.paperlens_session) } });
    res.clearCookie('paperlens_session', cookieOptions).json({ ok: true });
  });
  app.patch('/api/v1/account', async (req, res) => {
    const data = z
      .object({ currentPassword: z.string().max(128), password: z.string().min(12).max(128) })
      .parse(req.body);
    const user = await db.user.findUniqueOrThrow({ where: { id: res.locals.userId } });
    if (!(await verifyPassword(data.currentPassword, user.passwordHash)))
      throw fail(400, 'Current password is incorrect');
    await db.$transaction([
      db.user.update({
        where: { id: user.id },
        data: { passwordHash: await hashPassword(data.password) },
      }),
      db.session.deleteMany({ where: { userId: user.id } }),
    ]);
    res.json({ csrf: await startSession(user.id, res) });
  });
  const owned = async (id: string, userId: string) => {
    const p = await db.project.findFirst({ where: { id, userId, deleting: false } });
    if (!p) throw fail(404, 'Project not found');
    return p;
  };
  const paperOwned = async (id: string, userId: string) => {
    const p = await db.paper.findFirst({ where: { id, project: { userId, deleting: false } } });
    if (!p) throw fail(404, 'Paper not found');
    return p;
  };
  const id = (v: unknown) => z.string().uuid().parse(v);
  app.get('/api/v1/projects', async (req, res) => {
    const page = z.coerce.number().int().min(1).max(10000).default(1).parse(req.query.page);
    const where = { userId: res.locals.userId as string, deleting: false };
    const [items, total] = await Promise.all([
      db.project.findMany({
        where,
        skip: (page - 1) * 20,
        take: 20,
        orderBy: { createdAt: 'desc' },
        include: {
          _count: { select: { papers: true } },
          runs: { take: 1, orderBy: { createdAt: 'desc' }, select: { status: true } },
        },
      }),
      db.project.count({ where }),
    ]);
    res.json({ items, total, page, pageSize: 20 });
  });
  app.post('/api/v1/projects', async (req, res) => {
    res
      .status(201)
      .json(
        await db.project.create({
          data: { ...projectSchema.parse(req.body), userId: res.locals.userId },
        }),
      );
  });
  app.get('/api/v1/projects/:id', async (req, res) => {
    const p = await owned(id(req.params.id), res.locals.userId);
    const papers = await db.paper.findMany({
      where: { projectId: p.id },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        title: true,
        status: true,
        error: true,
        pageCount: true,
        size: true,
        createdAt: true,
      },
    });
    const runs = await db.analysisRun.findMany({
      where: { projectId: p.id },
      take: 10,
      orderBy: { createdAt: 'desc' },
    });
    res.json({
      ...p,
      papers,
      runs,
      limits: { maxPapers: config.MAX_PAPERS, maxFileMB: config.MAX_FILE_MB },
    });
  });
  app.delete('/api/v1/projects/:id', async (req, res) => {
    const p = await owned(id(req.params.id), res.locals.userId);
    await db.project.update({ where: { id: p.id }, data: { deleting: true } });
    await cleanupQueue.add('project', { projectId: p.id }, { jobId: p.id });
    res.status(202).json({ ok: true });
  });
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: config.MAX_FILE_MB * 1024 * 1024, files: config.MAX_PAPERS, fields: 0 },
  });
  app.post(
    '/api/v1/projects/:id/uploads',
    aiLimiter,
    async (req, res, next) => {
      await owned(id(req.params.id), res.locals.userId);
      next();
    },
    upload.array('files', config.MAX_PAPERS),
    async (req, res) => {
      const projectId = id(req.params.id);
      const files = req.files as Express.Multer.File[];
      if (!files?.length) throw fail(400, 'Choose PDF files to upload');
      for (const f of files) {
        try {
          validatePdf(f.originalname, f.buffer, config.MAX_FILE_MB * 1024 * 1024);
        } catch (e) {
          throw fail(400, (e as Error).message);
        }
      }
      const stored: string[] = [];
      try {
        const papers = await db.$transaction(
          async (tx) => {
            await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${projectId}))`;
            const project = await tx.project.findFirst({
              where: { id: projectId, userId: res.locals.userId, deleting: false },
            });
            if (!project) throw fail(404, 'Project not found');
            if (
              await tx.analysisRun.count({
                where: { projectId, status: { in: ['queued', 'running'] } },
              })
            )
              throw fail(409, 'Wait for the current analysis before changing papers');
            const existing = await tx.paper.findMany({
              where: { projectId },
              select: { hash: true },
            });
            const seen = new Set(existing.map((p) => p.hash));
            const fresh = files.filter((f) => {
              const h = hash(f.buffer);
              if (seen.has(h)) return false;
              seen.add(h);
              return true;
            });
            if (existing.length + fresh.length > config.MAX_PAPERS)
              throw fail(400, `A project supports up to ${config.MAX_PAPERS} papers`);
            const added = [];
            for (const f of fresh) {
              const paperId = randomUUID();
              const storageKey = `${res.locals.userId}/${projectId}/${paperId}.pdf`;
              await storePdf(storageKey, f.buffer);
              stored.push(storageKey);
              added.push(
                await tx.paper.create({
                  data: {
                    id: paperId,
                    projectId,
                    title: f.originalname,
                    hash: hash(f.buffer),
                    storageKey,
                    size: f.size,
                  },
                  select: { id: true, title: true, status: true },
                }),
              );
            }
            return added;
          },
          { timeout: 120000 },
        );
        res.status(201).json({ papers, duplicates: files.length - papers.length });
      } catch (e) {
        await Promise.allSettled(stored.map(deletePdf));
        throw e;
      }
    },
  );
  app.get('/api/v1/papers/:id/file', async (req, res) => {
    const p = await paperOwned(id(req.params.id), res.locals.userId);
    const bytes = await readPdf(p.storageKey);
    res
      .set({
        'Content-Type': 'application/pdf',
        'Content-Disposition': `inline; filename*=UTF-8''${encodeURIComponent(p.title)}`,
        'Cache-Control': 'private, no-store',
        'Content-Security-Policy': "default-src 'none'; frame-ancestors 'self'",
      })
      .send(Buffer.from(bytes));
  });
  app.get('/api/v1/papers/:id', async (req, res) => {
    const p = await paperOwned(id(req.params.id), res.locals.userId);
    res.json({
      id: p.id,
      title: p.title,
      pageCount: p.pageCount,
      status: p.status,
      error: p.error,
    });
  });
  app.post('/api/v1/projects/:id/runs', aiLimiter, async (req, res) => {
    const projectId = id(req.params.id);
    await owned(projectId, res.locals.userId);
    let run = await db.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${projectId}))`;
      const active = await tx.analysisRun.findFirst({
        where: { projectId, status: { in: ['queued', 'running'] } },
      });
      if (active) return active;
      const papers = await tx.paper.findMany({ where: { projectId }, orderBy: { id: 'asc' } });
      if (papers.length < 2) throw fail(400, 'Upload at least two papers first');
      const cacheKey = hash(
        papers
          .map((p) => p.hash)
          .sort()
          .join(':') + configKey,
      );
      return tx.analysisRun.upsert({
        where: { projectId_cacheKey: { projectId, cacheKey } },
        create: {
          projectId,
          cacheKey,
          config: json(analysisConfig),
          paperIds: papers.map((p) => p.id),
        },
        update: {},
      });
    });
    if (run.status === 'failed')
      run = await db.analysisRun.update({
        where: { id: run.id },
        data: { status: 'queued', error: null },
      });
    if (run.status !== 'completed') await enqueueRun(run.id);
    res.status(202).json(run);
  });
  const ownedRun = async (runId: string, userId: string) => {
    const r = await db.analysisRun.findFirst({
      where: { id: runId, project: { userId, deleting: false } },
    });
    if (!r) throw fail(404, 'Analysis not found');
    return r;
  };
  app.get('/api/v1/runs/:id', async (req, res) =>
    res.json(await ownedRun(id(req.params.id), res.locals.userId)),
  );
  app.post('/api/v1/runs/:id/retry', aiLimiter, async (req, res) => {
    const r = await ownedRun(id(req.params.id), res.locals.userId);
    if (r.status !== 'failed') throw fail(409, 'Only failed analyses can be retried');
    await db.analysisRun.update({ where: { id: r.id }, data: { status: 'queued', error: null } });
    await enqueueRun(r.id);
    res.status(202).json({ ok: true });
  });
  app.get('/api/v1/projects/:id/events', async (req, res) => {
    const projectId = id(req.params.id);
    await owned(projectId, res.locals.userId);
    res.set({
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.flushHeaders();
    let busy = false;
    const tick = async () => {
      if (busy) return;
      busy = true;
      try {
        const session = await db.session.findUnique({ where: { id: res.locals.session.id } });
        if (!session || session.expiresAt < new Date()) {
          res.end();
          return;
        }
        await owned(projectId, res.locals.userId);
        const [papers, runs] = await Promise.all([
          db.paper.findMany({
            where: { projectId },
            select: { id: true, status: true, error: true, pageCount: true },
          }),
          db.analysisRun.findMany({
            where: { projectId },
            orderBy: { createdAt: 'desc' },
            take: 1,
          }),
        ]);
        res.write(`data: ${JSON.stringify({ papers, runs })}\n\n`);
      } catch {
        res.end();
      } finally {
        busy = false;
      }
    };
    const timer = setInterval(() => void tick(), 2000);
    res.on('close', () => clearInterval(timer));
    await tick();
  });
  async function results(projectId: string, userId: string) {
    await owned(projectId, userId);
    const run = await db.analysisRun.findFirst({
      where: { projectId, status: 'completed' },
      orderBy: { createdAt: 'desc' },
      include: { result: true },
    });
    if (!run?.result) throw fail(404, 'No completed results yet');
    const savedConfig = run.config as Record<string, unknown>;
    const key = hash(
      JSON.stringify(
        Object.fromEntries(Object.keys(analysisConfig).map((k) => [k, savedConfig[k]])),
      ),
    );
    const summaries = await db.paperSummary.findMany({
      where: { paperId: { in: run.paperIds }, configKey: key },
      include: { paper: { select: { title: true } } },
    });
    return { run, summaries, result: run.result };
  }
  app.get('/api/v1/projects/:id/results', async (req, res) =>
    res.json(await results(id(req.params.id), res.locals.userId)),
  );
  app.get('/api/v1/projects/:id/conversations', async (req, res) => {
    const projectId = id(req.params.id);
    await owned(projectId, res.locals.userId);
    res.json(
      await db.conversation.findMany({
        where: { projectId },
        take: 30,
        orderBy: { createdAt: 'desc' },
        include: { messages: { orderBy: { createdAt: 'desc' }, take: 100 } },
      }),
    );
  });
  app.post('/api/v1/projects/:id/chat', aiLimiter, async (req, res) => {
    const projectId = id(req.params.id);
    await owned(projectId, res.locals.userId);
    const input = z
      .object({
        question: z.string().trim().min(1).max(4000),
        paperIds: z.array(z.string().uuid()).max(10).optional(),
        conversationId: z.string().uuid().optional(),
      })
      .parse(req.body);
    const available = await db.paper.findMany({ where: { projectId, status: 'ready' } });
    const selected = input.paperIds?.length ? input.paperIds : available.map((p) => p.id);
    if (selected.some((p) => !available.some((a) => a.id === p)))
      throw fail(400, 'Selected papers must belong to this project and be ready');
    if (!selected.length) throw fail(409, 'Analyze papers before asking questions');
    let conversation = input.conversationId
      ? await db.conversation.findFirst({ where: { id: input.conversationId, projectId } })
      : null;
    if (input.conversationId && !conversation) throw fail(404, 'Conversation not found');
    if (!conversation) conversation = await db.conversation.create({ data: { projectId } });
    const history = await db.message.findMany({
      where: { conversationId: conversation.id },
      orderBy: { createdAt: 'desc' },
      take: 6,
    });
    const evidence = await retrieve(
      res.locals.userId,
      projectId,
      selected,
      input.question,
      configKey,
    );
    const output = evidence.length
      ? await provider.structured(
          chatSchema,
          'Answer using the supplied retrieved evidence only. History is for resolving the question, never a source of facts. If evidence does not answer, use kind missing and explicitly say the uploaded papers do not contain enough information. Cite only supplied source pages.',
          {
            question: input.question,
            history: history.reverse().map((m) => ({ role: m.role, content: m.content })),
            evidence,
          },
        )
      : {
          answer: {
            text: 'The uploaded papers do not contain enough information to answer this question.',
            kind: 'missing' as const,
            citations: [],
          },
        };
    validateCitations(
      output,
      Object.fromEntries(
        available.filter((p) => selected.includes(p.id)).map((p) => [p.id, p.pageCount]),
      ),
      new Set(evidence.map((e) => `${e.paperId}:${e.page}`)),
    );
    await db.$transaction([
      db.message.create({
        data: {
          conversationId: conversation.id,
          role: 'user',
          content: json({ text: input.question, paperIds: selected }),
        },
      }),
      db.message.create({
        data: { conversationId: conversation.id, role: 'assistant', content: json(output.answer) },
      }),
    ]);
    // Only validated answers are emitted; do not stream unverified citation fragments.
    if (req.accepts(['application/json', 'text/event-stream']) === 'text/event-stream') {
      res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' });
      res.write(
        `event: answer\ndata: ${JSON.stringify({ conversationId: conversation.id, ...output })}\n\n`,
      );
      res.end();
    } else res.json({ conversationId: conversation.id, ...output });
  });
  app.get('/api/v1/projects/:id/exports', async (req, res) => {
    const projectId = id(req.params.id);
    const p = await owned(projectId, res.locals.userId);
    const data = await results(projectId, res.locals.userId);
    const md = markdownExport(
      p.name,
      data.summaries.map((s) => ({ paperId: s.paperId, output: s.output as Summary })),
      data.result.output as Comparison,
      data.result.gaps as { suggestions: Claim[] },
      config.WEB_ORIGIN,
    );
    const format = z.enum(['md', 'pdf']).default('md').parse(req.query.format);
    res.attachment(`paperlens-${projectId}.${format}`);
    if (format === 'md') {
      res.type('text/markdown').send(md);
      return;
    }
    res.type('application/pdf');
    const pdf = new PDFDocument({ margin: 48, info: { Title: p.name, Author: 'PaperLens' } });
    pdf.pipe(res);
    for (const paragraph of md.split('\n\n')) {
      pdf
        .font(paragraph.startsWith('#') ? 'Helvetica-Bold' : 'Helvetica')
        .fontSize(paragraph.startsWith('# ') ? 20 : paragraph.startsWith('## ') ? 15 : 10)
        .text(paragraph.replace(/^#+ /, ''), { lineGap: 3 })
        .moveDown(0.8);
    }
    pdf.end();
  });
  app.use((_req, _res, next) => next(fail(404, 'Endpoint not found')));
  app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    const status =
      err instanceof z.ZodError
        ? 400
        : err instanceof multer.MulterError
          ? 400
          : err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002'
            ? 409
            : err.status || 500;
    res
      .status(status)
      .json({
        error: {
          code: status === 500 ? 'INTERNAL_ERROR' : String(status),
          message:
            status === 500
              ? 'An unexpected error occurred. Please retry.'
              : status === 409 && !err.status
                ? 'This record already exists'
                : err instanceof z.ZodError
                  ? 'Invalid request. Check the fields and try again.'
                  : err.message,
        },
      });
  });
  return app;
}
