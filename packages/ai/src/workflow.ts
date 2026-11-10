import { createHash } from 'node:crypto';
import { Annotation, StateGraph, START, END } from '@langchain/langgraph';
import { PostgresSaver } from '@langchain/langgraph-checkpoint-postgres';
import pLimit from 'p-limit';
import { db, json } from '@paperlens/db';
import {
  summarySchema,
  evidenceSchema,
  comparisonSchema,
  gapsSchema,
  validateCitations,
  validateComparison,
  validatePdf,
  type Page,
  type Comparison,
} from '@paperlens/shared';
import { config, analysisConfig } from './config.js';
import { extractPages, chunkPages } from './documents.js';
import { readPdf } from './storage.js';
import { GroqProvider, type AIProvider, type Usage } from './provider.js';
import { retrieve } from './retrieval.js';
import { publicFailure } from './failures.js';
export { publicFailure } from './failures.js';
export const hash = (value: string | Uint8Array) =>
  createHash('sha256').update(value).digest('hex');
export const configKey = hash(JSON.stringify(analysisConfig));
const State = Annotation.Root({
  runId: Annotation<string>(),
  comparison: Annotation<Comparison>(),
  gaps: Annotation<{ suggestions: import('@paperlens/shared').Claim[] }>(),
});
export async function createWorkflow(
  checkpointer: PostgresSaver,
  provider: AIProvider = new GroqProvider(),
) {
  async function runRecord(id: string) {
    const run = await db.analysisRun.findUniqueOrThrow({
      where: { id },
      include: { project: { include: { papers: { orderBy: { createdAt: 'asc' } } } } },
    });
    if (run.project.deleting) throw new Error('Project is being deleted');
    if (
      JSON.stringify(run.config) !== JSON.stringify(analysisConfig) &&
      hash(JSON.stringify(run.config)) !== configKey
    ) {
      // JSONB key order is not stable; compare canonical field values.
      const old = run.config as Record<string, unknown>;
      if (Object.entries(analysisConfig).some(([k, v]) => old[k] !== v))
        throw new Error('Analysis configuration changed. Start a new analysis.');
    }
    return run;
  }
  async function progress(id: string, stage: string) {
    await runRecord(id);
    await db.analysisRun.update({ where: { id }, data: { status: 'running', stage, error: null } });
  }
  const usage = (id: string) => async (u: Usage) => {
    await db.$executeRaw`UPDATE "AnalysisRun" SET usage=usage || ${JSON.stringify([u])}::jsonb WHERE id=${id}`;
  };
  async function call<T>(
    id: string,
    schema: import('zod').z.ZodType<T>,
    instruction: string,
    context: unknown,
  ) {
    const count =
      await db.$executeRaw`UPDATE "AnalysisRun" SET "aiCalls"="aiCalls"+1 WHERE id=${id} AND "aiCalls"<${config.MAX_AI_CALLS_PER_RUN}`;
    if (!count) throw new Error('AI call budget exceeded');
    return provider.structured(schema, instruction, context, usage(id));
  }
  async function papers(
    id: string,
    stage: string,
    fn: (p: Awaited<ReturnType<typeof runRecord>>['project']['papers'][number]) => Promise<void>,
  ) {
    await progress(id, stage);
    const run = await runRecord(id);
    const limit = pLimit(config.PAPER_CONCURRENCY);
    const results = await Promise.allSettled(
      run.project.papers
        .filter((p) => run.paperIds.includes(p.id))
        .map((p) =>
          limit(async () => {
            try {
              await fn(p);
            } catch (e) {
              await db.paper.update({
                where: { id: p.id },
                data: { status: 'failed', error: publicFailure(e) },
              });
              throw e;
            }
          }),
        ),
    );
    const failed = results.find((r) => r.status === 'rejected');
    if (failed?.status === 'rejected') throw failed.reason;
  }
  const graph = new StateGraph(State)
    .addNode('validation', async (s) => {
      await progress(s.runId, 'validation');
      const r = await runRecord(s.runId);
      if (r.paperIds.length < 2 || r.paperIds.length > config.MAX_PAPERS)
        throw new Error('Choose 2–10 papers');
      for (const p of r.project.papers.filter((p) => r.paperIds.includes(p.id))) {
        if (p.size > config.MAX_FILE_MB * 1024 * 1024)
          throw new Error('PDF exceeds upload size limit');
      }
      return {};
    })
    .addNode('extraction', async (s) => {
      await papers(s.runId, 'extraction', async (p) => {
        if (p.pages) return;
        await db.paper.update({ where: { id: p.id }, data: { status: 'extracting', error: null } });
        const bytes = await readPdf(p.storageKey);
        validatePdf(p.title, bytes, config.MAX_FILE_MB * 1024 * 1024);
        const pages = await extractPages(bytes);
        await db.paper.update({
          where: { id: p.id },
          data: { pages: json(pages), pageCount: pages.length, status: 'extracted' },
        });
      });
      return {};
    })
    .addNode('indexing', async (s) => {
      await papers(s.runId, 'indexing', async (p) => {
        const chunks = await chunkPages(p.pages as Page[]);
        await db.paper.update({ where: { id: p.id }, data: { status: 'indexing', error: null } });
        for (let ordinal = 0; ordinal < chunks.length; ordinal++) {
          const id = hash(`${p.id}:${configKey}:${ordinal}`);
          const exists = await db.documentChunk.findUnique({ where: { id } });
          if (exists) continue;
          const c = chunks[ordinal];
          await db.$executeRaw`INSERT INTO "DocumentChunk" (id,"paperId",ordinal,page,section,text,embedding,"configKey","createdAt") VALUES (${id},${p.id},${ordinal},${c.page},${c.section},${c.text},NULL,${configKey},NOW()) ON CONFLICT (id) DO NOTHING`;
        }
      });
      return {};
    })
    .addNode('summarization', async (s) => {
      await papers(s.runId, 'summarization', async (p) => {
        if (
          await db.paperSummary.findUnique({
            where: { paperId_configKey: { paperId: p.id, configKey } },
          })
        ) {
          await db.paper.update({ where: { id: p.id }, data: { status: 'ready', error: null } });
          return;
        }
        await db.paper.update({
          where: { id: p.id },
          data: { status: 'summarizing', error: null },
        });
        const chunks = await db.documentChunk.findMany({
          where: { paperId: p.id, configKey },
          orderBy: { ordinal: 'asc' },
        });
        const evidence: unknown[] = [];
        for (const c of chunks) {
          let output: unknown = c.evidence;
          if (!output) {
            const result = await call(
              s.runId,
              evidenceSchema,
              'Extract concise evidence covering bibliography, objectives, hypotheses, contributions, methods, experimental setup, datasets, sample sizes, metrics, results, limitations and future work from this chunk. At most 12 claims; preserve exact reported values.',
              { paperId: p.id, title: p.title, page: c.page, section: c.section, text: c.text },
            );
            validateCitations(result, { [p.id]: p.pageCount }, new Set([`${p.id}:${c.page}`]));
            output = result;
            await db.documentChunk.update({
              where: { id: c.id },
              data: { evidence: json(result) },
            });
          }
          evidence.push(output);
        }
        // Hierarchical reduction includes every chunk. Never truncate a paper to top-k retrieval.
        let reduced = evidence;
        while (JSON.stringify(reduced).length > config.MAX_CONTEXT_CHARS - 5000) {
          const next: unknown[] = [];
          let batch: unknown[] = [];
          let size = 0;
          for (const e of reduced) {
            const n = JSON.stringify(e).length;
            if (size + n > config.MAX_CONTEXT_CHARS - 5000 && batch.length) {
              const r = await call(
                s.runId,
                evidenceSchema,
                'Consolidate all supplied evidence into at most 20 concise claims. Preserve citations and exact important metrics, missing evidence, and contradictory findings.',
                batch,
              );
              validateCitations(r, { [p.id]: p.pageCount });
              next.push(r);
              batch = [];
              size = 0;
            }
            batch.push(e);
            size += n;
          }
          if (batch.length) {
            const r = await call(
              s.runId,
              evidenceSchema,
              'Consolidate all supplied evidence into at most 20 concise claims preserving citations and important metrics.',
              batch,
            );
            validateCitations(r, { [p.id]: p.pageCount });
            next.push(r);
          }
          if (JSON.stringify(next).length >= JSON.stringify(reduced).length)
            throw new Error('Evidence reduction exceeded context budget');
          reduced = next;
        }
        const output = await call(
          s.runId,
          summarySchema,
          'Produce a complete paper summary using all supplied evidence. Bibliography must be grounded with bibliographyCitations; unknown title/authors/year/venue must be Not reported. Each summary field is a concise cited claim.',
          { paperId: p.id, evidence: reduced },
        );
        validateCitations(output, { [p.id]: p.pageCount });
        if (
          [output.title, output.authors, output.year, output.venue].some(
            (v) => v !== 'Not reported',
          ) &&
          !output.bibliographyCitations.length
        )
          throw new Error('Bibliographic evidence missing');
        await db.paperSummary.upsert({
          where: { paperId_configKey: { paperId: p.id, configKey } },
          create: { paperId: p.id, configKey, output: json(output) },
          update: { output: json(output) },
        });
        await db.paper.update({ where: { id: p.id }, data: { status: 'ready', error: null } });
      });
      return {};
    })
    .addNode('compare_papers', async (s) => {
      await progress(s.runId, 'comparison');
      const r = await runRecord(s.runId);
      const summaries = await db.paperSummary.findMany({
        where: { paperId: { in: r.paperIds }, configKey },
      });
      const evidence = await retrieve(
        r.project.userId,
        r.projectId,
        r.paperIds,
        'methods datasets sample sizes evaluation metrics limitations contradictory findings',
        configKey,
      );
      const comparison = await call(
        s.runId,
        comparisonSchema,
        'Compare all papers across every requested dimension with one cell per paper per dimension. Explain compatible and incompatible experiments and goal-specific suitability. Do not declare a universal winner. Discuss relationships and contradictory evidence. Keep each cell concise.',
        { papers: summaries.map((x) => ({ paperId: x.paperId, summary: x.output })), evidence },
      );
      validateCitations(
        comparison,
        Object.fromEntries(
          r.project.papers.filter((p) => r.paperIds.includes(p.id)).map((p) => [p.id, p.pageCount]),
        ),
      );
      validateComparison(comparison, r.paperIds);
      return { comparison };
    })
    .addNode('research_gaps', async (s) => {
      await progress(s.runId, 'research_gaps');
      const r = await runRecord(s.runId);
      const gaps = await call(
        s.runId,
        gapsSchema,
        'Propose 3–6 potential research directions from the comparison. Every entry must have kind suggestion, clearly labeled AI-generated suggestion, and cite motivating evidence. These are proposals, not established research gaps.',
        s.comparison,
      );
      validateCitations(
        gaps,
        Object.fromEntries(
          r.project.papers.filter((p) => r.paperIds.includes(p.id)).map((p) => [p.id, p.pageCount]),
        ),
      );
      if (gaps.suggestions.some((g) => g.kind !== 'suggestion'))
        throw new Error('Research directions must be labeled suggestions');
      return { gaps };
    })
    .addNode('citation_validation', async (s) => {
      await progress(s.runId, 'citation_validation');
      const r = await runRecord(s.runId);
      const pages = Object.fromEntries(
        r.project.papers.filter((p) => r.paperIds.includes(p.id)).map((p) => [p.id, p.pageCount]),
      );
      validateCitations(s.comparison, pages);
      validateCitations(s.gaps, pages);
      validateComparison(s.comparison, r.paperIds);
      if (s.gaps.suggestions.some((g) => g.kind !== 'suggestion'))
        throw new Error('Research directions must be labeled suggestions');
      return {};
    })
    .addNode('persistence', async (s) => {
      await progress(s.runId, 'persistence');
      await db.$transaction([
        db.comparisonResult.upsert({
          where: { runId: s.runId },
          create: { runId: s.runId, output: json(s.comparison), gaps: json(s.gaps) },
          update: { output: json(s.comparison), gaps: json(s.gaps) },
        }),
        db.analysisRun.update({
          where: { id: s.runId },
          data: { status: 'completed', stage: 'completed', error: null },
        }),
      ]);
      return {};
    })
    .addEdge(START, 'validation')
    .addEdge('validation', 'extraction')
    .addEdge('extraction', 'indexing')
    .addEdge('indexing', 'summarization')
    .addEdge('summarization', 'compare_papers')
    .addEdge('compare_papers', 'research_gaps')
    .addEdge('research_gaps', 'citation_validation')
    .addEdge('citation_validation', 'persistence')
    .addEdge('persistence', END);
  return graph.compile({ checkpointer });
}
export async function makeCheckpointer() {
  const cp = PostgresSaver.fromConnString(config.DATABASE_URL);
  await cp.setup();
  return cp;
}
export type Workflow = Awaited<ReturnType<typeof createWorkflow>>;
export async function executeRun(graph: Workflow, id: string) {
  const r = await db.analysisRun.findUniqueOrThrow({ where: { id } });
  if (r.status === 'completed') return;
  const options = { configurable: { thread_id: id }, recursionLimit: 30 };
  const snapshot = await graph.getState(options);
  await graph.invoke(snapshot.next?.length ? null : { runId: id }, options);
}
