import { z } from 'zod';
export const credentialsSchema = z.object({
  email: z
    .email()
    .max(254)
    .transform((v) => v.toLowerCase()),
  password: z.string().min(12).max(128),
});
export const projectSchema = z.object({
  name: z.string().trim().min(1).max(120),
  description: z.string().max(2000).default(''),
});
export const citationSchema = z.object({ paperId: z.string(), page: z.number().int().positive() });
export const claimSchema = z.object({
  text: z.string(),
  kind: z.enum(['reported', 'interpretation', 'suggestion', 'missing']),
  citations: z.array(citationSchema),
});
export const summaryFields = [
  'problem',
  'objectives',
  'contributions',
  'methodology',
  'experimentalSetup',
  'datasets',
  'findings',
  'limitations',
  'futureWork',
  'plainLanguage',
] as const;
export const summarySchema = z.object({
  schemaVersion: z.literal(1),
  title: z.string(),
  authors: z.string(),
  year: z.string(),
  venue: z.string(),
  bibliographyCitations: z.array(citationSchema),
  ...Object.fromEntries(summaryFields.map((k) => [k, claimSchema])),
}) as z.ZodObject<
  {
    schemaVersion: z.ZodLiteral<1>;
    title: z.ZodString;
    authors: z.ZodString;
    year: z.ZodString;
    venue: z.ZodString;
    bibliographyCitations: z.ZodArray<typeof citationSchema>;
  } & Record<(typeof summaryFields)[number], typeof claimSchema>
>;
export const comparisonDimensions = [
  'Objectives',
  'Hypotheses / questions',
  'Methods / models',
  'Datasets / sample sizes',
  'Experimental settings',
  'Evaluation metrics',
  'Results',
  'Strengths',
  'Limitations',
  'Agreements / disagreements',
  'Novel contributions',
  'Practical applications',
  'Open questions',
] as const;
export const comparisonSchema = z.object({
  schemaVersion: z.literal(1),
  synthesis: claimSchema,
  rows: z.array(
    z.object({
      dimension: z.enum(comparisonDimensions),
      cells: z.array(z.object({ paperId: z.string(), claim: claimSchema })),
    }),
  ),
  discussion: z.array(claimSchema),
  relationships: z.array(claimSchema),
});
export const gapsSchema = z.object({ suggestions: z.array(claimSchema) });
export const evidenceSchema = z.object({ claims: z.array(claimSchema) });
export const chatSchema = z.object({ answer: claimSchema });
export type Claim = z.infer<typeof claimSchema>;
export type Citation = z.infer<typeof citationSchema>;
export type Summary = z.infer<typeof summarySchema>;
export type Comparison = z.infer<typeof comparisonSchema>;
export type Page = { page: number; text: string; section: string };
export function validateCitations(
  value: unknown,
  pages: Record<string, number>,
  allowed?: Set<string>,
): void {
  if (!value || typeof value !== 'object') return;
  if (Array.isArray(value)) {
    value.forEach((v) => validateCitations(v, pages, allowed));
    return;
  }
  const obj = value as Record<string, unknown>;
  if ('paperId' in obj && 'page' in obj) {
    const c = citationSchema.parse(obj);
    if (
      !pages[c.paperId] ||
      c.page > pages[c.paperId] ||
      (allowed && !allowed.has(`${c.paperId}:${c.page}`))
    )
      throw new Error('Invalid source citation');
  }
  if ('kind' in obj && 'text' in obj && 'citations' in obj) {
    const c = claimSchema.parse(obj);
    if (c.kind !== 'missing' && c.citations.length === 0)
      throw new Error('Evidence citation required');
    if (
      c.kind === 'missing' &&
      c.text !== 'Not reported' &&
      !/not contain|insufficient|not enough|not reported/i.test(c.text)
    )
      throw new Error('Missing evidence must be explicit');
  }
  Object.values(obj).forEach((v) => validateCitations(v, pages, allowed));
}
export function validateComparison(value: Comparison, ids: string[]) {
  if (
    value.rows.length !== comparisonDimensions.length ||
    new Set(value.rows.map((r) => r.dimension)).size !== comparisonDimensions.length
  )
    throw new Error('Incomplete comparison dimensions');
  for (const row of value.rows)
    if (
      row.cells.length !== ids.length ||
      new Set(row.cells.map((c) => c.paperId)).size !== ids.length ||
      row.cells.some((c) => !ids.includes(c.paperId))
    )
      throw new Error('Incomplete comparison papers');
}
export function validatePdf(name: string, bytes: Uint8Array, maxBytes = 25 * 1024 * 1024) {
  if (!/\.pdf$/i.test(name) || new TextDecoder().decode(bytes.slice(0, 5)) !== '%PDF-')
    throw new Error('Only valid PDF files are accepted');
  if (bytes.length > maxBytes) throw new Error('PDF exceeds upload size limit');
  if (bytes.length < 20) throw new Error('PDF is empty or truncated');
}
export function vectorLiteral(vector: number[], dimensions = 1536) {
  if (vector.length !== dimensions || vector.some((n) => !Number.isFinite(n)))
    throw new Error('Invalid embedding dimensions or values');
  return `[${vector.join(',')}]`;
}
