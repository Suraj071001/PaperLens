import { z } from 'zod';
export const config = z
  .object({
    DATABASE_URL: z.string().default('postgresql://paperlens:paperlens@localhost:55432/paperlens'),
    REDIS_URL: z.string().default('redis://localhost:6379'),
    GROQ_API_KEY: z.string().default(''),
    GROQ_MODEL: z.string().default('openai/gpt-oss-120b'),
    GROQ_TPM_LIMIT: z.coerce.number().int().min(1000).default(8000),
    WEB_ORIGIN: z.url().default('http://localhost:3000'),
    MAX_FILE_MB: z.coerce.number().int().min(1).max(100).default(25),
    MAX_PAPERS: z.coerce.number().int().min(2).max(10).default(10),
    MAX_PAGES: z.coerce.number().int().positive().default(150),
    MAX_CHUNKS: z.coerce.number().int().positive().default(400),
    MAX_CONTEXT_CHARS: z.coerce.number().int().min(5000).default(90000),
    MAX_OUTPUT_TOKENS: z.coerce.number().int().positive().default(4000),
    MAX_AI_CALLS_PER_RUN: z.coerce.number().int().positive().default(500),
    PAPER_CONCURRENCY: z.coerce.number().int().min(1).max(4).default(1),
    WORKER_CONCURRENCY: z.coerce.number().int().min(1).max(4).default(1),
  })
  .parse(process.env);
export const analysisConfig = {
  model: config.GROQ_MODEL,
  retrieval: 'postgres-full-text-v1',
  promptVersion: 'paperlens-groq-v1',
  chunkSize: 6000,
  chunkOverlap: 500,
  schemaVersion: 2,
};
