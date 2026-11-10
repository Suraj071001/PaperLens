# PaperLens

A local full-stack research-paper comparison application. Next.js App Router + TypeScript + Tailwind + shadcn-style Radix components; Express API; PostgreSQL/Prisma/pgvector; Groq structured-output models; persistent LangGraph workflows; BullMQ/Redis; private S3/MinIO originals.

## Quick start (PowerShell)

Prerequisites: Node.js 22.13+ (22 LTS), npm, Docker Desktop running with Linux containers. Run all commands from the repository root.

```powershell
npm ci
Copy-Item .env.example .env
# Edit .env and set GROQ_API_KEY to your own key.
npm run infra:up
npm run db:generate
npm run db:migrate
npm run dev
```

Open http://localhost:3000, create an account, create a project, upload 2–10 searchable PDFs, and select **Analyze papers**. Sign-up is real; no demo login or fake production results exist. The frontend proxies `/api` to Express so cookies, downloads, and progress events use the same origin. The API listens on 4000. PostgreSQL uses host port **55432** to avoid Windows reserved-port conflicts. Redis is 6379; MinIO is 9000 with its console at 9001. Infrastructure ports bind only to localhost.

If `.env` already exists, edit it instead of overwriting it. API and worker scripts load the root `.env`; the browser never receives the Groq key. `API_INTERNAL_URL` can override the Next.js server-side proxy destination (default `http://127.0.0.1:4000`). It must be configured in the web process environment at build time.

Optional development seed (an empty project, not synthetic AI results):

```powershell
$env:SEED_EMAIL = 'researcher@example.com'
$env:SEED_PASSWORD = 'choose-a-long-local-password'
npm run db:seed
```

## Configuration

See `.env.example` for all settings and local defaults.

| Variables                                                        | Purpose                                                      |
| ---------------------------------------------------------------- | ------------------------------------------------------------ |
| `GROQ_API_KEY`                                                   | Required for actual analysis and chat; server only           |
| `GROQ_MODEL`                                                     | Groq structured-output model, default `openai/gpt-oss-120b`   |
| `GROQ_TPM_LIMIT`                                                 | Shared token-per-minute budget across the API and worker; default 8000 |
| `DATABASE_URL`, `REDIS_URL`                                      | Database and durable job queue connections                   |
| `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`                          | S3-compatible private object storage                         |
| `S3_ACCESS_KEY`, `S3_SECRET_KEY`                                 | Server-side storage credentials                              |
| `WEB_ORIGIN`                                                     | Exact browser origin for CORS and CSRF checks                |
| `API_PORT`, `NODE_ENV`                                           | API port and secure-cookie mode                              |
| `MAX_FILE_MB`, `MAX_PAPERS`, `MAX_PAGES`, `MAX_CHUNKS`           | Upload and processing limits                                 |
| `MAX_CONTEXT_CHARS`, `MAX_OUTPUT_TOKENS`, `MAX_AI_CALLS_PER_RUN` | Per-call context/output and per-run call ceilings            |
| `PAPER_CONCURRENCY`, `WORKER_CONCURRENCY`                        | Bounded parallelism across papers and projects               |

The default MinIO credentials are for local development. Production storage should use a private bucket, scoped credentials, encryption, lifecycle/backup policies, and HTTPS. `ensureBucket` creates a missing bucket; alternatively provision it and give the application object-level access plus `HeadBucket` access. Passage retrieval uses PostgreSQL full text search over locally extracted PDF text; generation uses Groq. Groq requests share a Redis-backed rolling token budget; set `GROQ_TPM_LIMIT` to the limit for the configured model and account tier.

## Architecture

```text
apps/web       Next.js pages, authenticated workspace, uploads, results, citations, chat
apps/api       Versioned REST API, sessions, authorization, exports, SSE
apps/worker    BullMQ analysis and cleanup workers; queue reconciliation and heartbeat
packages/db    Prisma schema, pgvector migration, client and development seed
packages/shared Zod schemas, citation/upload validation and types
packages/ai    Groq provider adapter, extraction, chunking, retrieval and LangGraph
tests          Generated real PDF fixtures; production-independent fake AI adapter
```

The API stores PDFs privately and queues analyses. The worker executes validation → extraction → indexing → complete-paper evidence/summary → comparison → research directions → citation validation → persistence. LangGraph stores checkpoints in PostgreSQL; its own tables are installed idempotently on worker startup. Each physical PDF page retains its page number and a best-effort section heading. LangChain splits page text into overlapping chunks. Extracted chunks and chunk evidence are persisted individually; hierarchical reduction includes all chunk evidence when a paper exceeds the synthesis context budget. No complete summary uses only top-k retrieval. Follow-up chat uses PostgreSQL full text retrieval scoped by user, project, selected paper IDs and analysis configuration.

Analysis cache keys combine sorted document hashes and the model/prompt/chunk/retrieval configuration. A database uniqueness constraint plus a project advisory lock prevents duplicate run records. BullMQ job IDs equal run IDs. Durable reconciliation re-enqueues database runs after enqueue failures or Redis recovery. Retries use exponential backoff; completed chunks and summaries are reused. Failed model/citation output is rejected before checkpointing the corresponding successful stage. Project deletion is marked immediately, then a retrying cleanup job removes private objects, checkpoints, and cascading relational records after active processing stops.

Claims carry `reported`, `interpretation`, `suggestion`, or `missing` labels. Unknown fields use `Not reported`. Citation validation checks ownership-scoped paper IDs and physical page bounds; chat additionally checks against retrieved pages. This does **not** establish scientific correctness or entailment. Embedded PDF instructions are treated as untrusted data in the provider system prompt. No provider tool execution is exposed to paper content.

## API

All endpoints are under `/api/v1`. Mutating requests require the exact `Origin: WEB_ORIGIN`; after sign-in they also require `x-csrf-token` from `/auth/me`. Session cookies are HTTP-only, SameSite Lax, hashed in the database, expire after seven days, and are Secure in production.

| Method      | Path                                          | Function                                                        |
| ----------- | --------------------------------------------- | --------------------------------------------------------------- |
| GET         | `/health`                                     | Database, Redis, bucket and worker readiness                    |
| POST        | `/auth/signup`, `/auth/login`, `/auth/logout` | Account and session lifecycle                                   |
| GET         | `/auth/me`                                    | Current account and CSRF token                                  |
| PATCH       | `/account`                                    | Verify current password, change password, revoke other sessions |
| GET, POST   | `/projects`                                   | Paginated list / create                                         |
| GET, DELETE | `/projects/:id`                               | Project detail / asynchronous deletion                          |
| POST        | `/projects/:id/uploads`                       | Multipart `files`; signature/size checks and hash deduplication |
| GET         | `/papers/:id`, `/papers/:id/file`             | Paper metadata / authorized original PDF                        |
| POST        | `/projects/:id/runs`                          | Start or reuse an analysis                                      |
| GET, POST   | `/runs/:id`, `/runs/:id/retry`                | Status / retry failed run                                       |
| GET         | `/projects/:id/events`                        | SSE persisted progress, reconnectable after refresh             |
| GET         | `/projects/:id/results`                       | Latest completed comparison and summaries                       |
| GET         | `/projects/:id/conversations`                 | Recent conversations and saved messages                         |
| POST        | `/projects/:id/chat`                          | Grounded answer; optional `paperIds`, `conversationId`          |
| GET         | `/projects/:id/exports?format=md\|pdf`        | Export summaries, comparison and source citations               |

Chat answers are buffered until schema/citation checks pass. Clients can request `text/event-stream` for a validated final `answer` event; token-by-token model output is not streamed. Progress SSE polls durable database state every two seconds and revalidates the session. Errors use `{error:{code,message}}`. Authentication, upload/AI, and general request limits are configured at the API layer. Logs contain lifecycle events and run identifiers, not prompts, passwords, PDFs, or provider response bodies.

## Development and verification

```powershell
npm run typecheck
npm run lint
npm test
# Requires Docker services and migrated DB. Stop the normal worker first.
npm run test:integration
npm run build
```

With the normal API and worker running and `GROQ_API_KEY` empty, `npm run test:smoke` checks live HTTP signup, upload, progress SSE, worker backoff, the retry endpoint and asynchronous deletion. It refuses to run with a configured key to avoid model charges. `npm run format` formats the source.

### Verified in this workspace

- Dependency installation, Prisma client generation, schema validation and migration deployment passed.
- Docker PostgreSQL/pgvector, Redis and MinIO passed health checks; the running API reported `status: ok` and a live worker heartbeat.
- 12 unit tests and 9 integration tests passed on Vitest 5. Integration AI responses are explicitly test-only; the other integrations are real.
- The live HTTP/worker smoke check passed, including missing-key failure, backoff, explicit retry, SSE and file/record cleanup.
- TypeScript checks, ESLint and the Next.js production build passed.
- No live Groq output or browser interaction/visual QA was verified. The optional feature-detected WebMCP project-creation tool was not tested in a supported browser context.

Unit tests exercise hashing, signature and upload limits, page extraction, OCR detection, chunk metadata, citation validation and output shapes. Integration tests use real PostgreSQL, Redis, MinIO, LangGraph checkpoints, HTTP sessions and generated two-page PDFs, with AI mocked only through `tests/fake-provider.ts`. They cover an upload-to-comparison run, duplicate uploads/jobs, crash recovery and idempotency, source access, cross-user retrieval, chat history and exports. Integration tests create uniquely named accounts and delete only their own records and files.

For production processes after installing dependencies and building:

```powershell
npm run start -w @paperlens/web
# In separate terminals/process manager services:
npm run start -w @paperlens/api
npm run start -w @paperlens/worker
```

API and worker run TypeScript with `tsx`, which must be installed in the runtime image. Use a process manager and separate worker deployment. Run migrations once before starting workers. Use a TLS reverse proxy for the web app, keep the API/storage/database internal, and set `WEB_ORIGIN` to the actual HTTPS origin. The requested TCP PostgreSQL/Redis worker architecture is intended for Node.js hosts, not the Sites Cloudflare Worker runtime.

## Practical limits

- OCR is detected but not performed. Image-only pages, severely mixed scanned documents, encrypted PDFs, and damaged PDFs fail explicitly. Tables, equations, multi-column reading order and section headings use PDF.js text extraction and may need manual review.
- Context and call ceilings stop oversized analyses rather than silently omitting document content. Map/reduce is lossy; researchers should check cited pages. API retry attempts can incur additional provider charges; the call ceiling is an application-level bound, not an exact dollar budget. Configure provider spending limits separately.
- Chat uses the active retrieval/prompt configuration. Reanalyze old projects after configuration changes. Conversation listings currently return the latest 30 conversations and 100 messages per conversation.
- Rate limits are per API process/IP, not a distributed billing quota. Public multi-instance deployment needs a shared rate-limit store, verified email/password recovery, operational alerts and resource limits for untrusted PDF processing.
- Uploads buffer a bounded batch in API memory; use appropriately sized processes and proxy body/time limits. S3 and PostgreSQL are not an atomic transaction; a process crash between object creation and database commit can leave an orphan object requiring lifecycle reconciliation.
- PDF exports use built-in Helvetica; some non-Latin characters may not render. They include source titles and citation URLs; Markdown retains clickable source links requiring sign-in.
- No real Groq analysis is verified until a working API key is supplied. Test-only responses never appear in the normal application.

## Official API references checked

- [Next.js App Router installation](https://nextjs.org/docs/app/getting-started/installation)
- [LangGraph persistence](https://docs.langchain.com/oss/javascript/langgraph/persistence)
- [LangChain ChatOpenAI](https://docs.langchain.com/oss/javascript/integrations/chat/openai)
- [BullMQ retry/backoff](https://docs.bullmq.io/guide/retrying-failing-jobs)
- [Groq structured outputs](https://console.groq.com/docs/structured-outputs)
- [PDF.js examples](https://mozilla.github.io/pdf.js/examples/)

The lockfile pins resolved compatible package versions. Prisma uses stable 7.10 rather than its npm `latest` prerelease 8.0.0-rc.13.
