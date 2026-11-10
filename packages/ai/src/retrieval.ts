import { db, Prisma } from '@paperlens/db';
export type Retrieved = {
  paperId: string;
  title: string;
  page: number;
  section: string;
  text: string;
  distance: number;
};
export async function retrieve(
  userId: string,
  projectId: string,
  paperIds: string[],
  query: string,
  configKey: string,
): Promise<Retrieved[]> {
  if (!paperIds.length) return [];
  return db.$queryRaw<Retrieved[]>(
    Prisma.sql`WITH query AS (SELECT websearch_to_tsquery('english', ${query}) AS terms) SELECT c."paperId",p.title,c.page,c.section,c.text,ts_rank_cd(to_tsvector('english', c.text), query.terms) AS distance FROM "DocumentChunk" c JOIN "Paper" p ON p.id=c."paperId" JOIN "Project" pr ON pr.id=p."projectId" CROSS JOIN query WHERE pr."userId"=${userId} AND pr.id=${projectId} AND pr.deleting=false AND p.id IN (${Prisma.join(paperIds)}) AND c."configKey"=${configKey} AND to_tsvector('english', c.text) @@ query.terms ORDER BY distance DESC LIMIT 16`,
  );
}
