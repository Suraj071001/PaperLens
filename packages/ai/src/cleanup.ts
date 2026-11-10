import { db } from '@paperlens/db';
import type { PostgresSaver } from '@langchain/langgraph-checkpoint-postgres';
import { analysisQueue } from './queue.js';
import { deletePdf } from './storage.js';
export async function cleanupProject(projectId: string, checkpointer: PostgresSaver) {
  const p = await db.project.findUnique({
    where: { id: projectId },
    include: { papers: true, runs: true },
  });
  if (!p) return;
  if (!p.deleting) throw new Error('Project must be marked for deletion');
  for (const r of p.runs) {
    const job = await analysisQueue.getJob(r.id);
    if (job && (await job.getState()) === 'active')
      throw new Error('Waiting for active analysis to stop');
    if (job) await job.remove();
  }
  for (const paper of p.papers) await deletePdf(paper.storageKey);
  for (const run of p.runs) await checkpointer.deleteThread(run.id);
  await db.project.delete({ where: { id: p.id } });
}
