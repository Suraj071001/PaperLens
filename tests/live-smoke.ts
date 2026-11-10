// Optional HTTP/worker smoke check for local development with NO Groq key.
import { randomUUID } from 'node:crypto';
import { makePdf } from './fixtures.js';
import { db } from '@paperlens/db';
const origin = 'http://localhost:3000';
const base = 'http://localhost:4000/api/v1';
let cookie = '',
  csrf = '',
  userId = '';
async function call(path: string, method = 'GET', body?: unknown) {
  const response = await fetch(base + path, {
    method,
    headers: {
      Origin: origin,
      ...(cookie ? { Cookie: cookie } : {}),
      ...(csrf ? { 'x-csrf-token': csrf } : {}),
      ...(body && !(body instanceof FormData) ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body instanceof FormData ? body : body ? JSON.stringify(body) : undefined,
  });
  const setCookie = response.headers.getSetCookie()[0];
  if (setCookie) cookie = setCookie.split(';')[0];
  const value = await response.json();
  if (value.csrf) csrf = value.csrf;
  if (!response.ok) throw new Error(`${path}: ${response.status}`);
  return value;
}
const health = await call('/health');
if (health.aiConfigured)
  throw new Error(
    'This smoke check is only for an unconfigured AI provider; it must not incur real model charges',
  );
try {
  const user = await call('/auth/signup', 'POST', {
    email: `smoke-${randomUUID()}@example.test`,
    password: randomUUID(),
  });
  userId = user.id;
  const project = await call('/projects', 'POST', { name: 'Temporary worker smoke test' });
  const form = new FormData();
  form.append(
    'files',
    new Blob([new Uint8Array(await makePdf('Alpha'))], { type: 'application/pdf' }),
    'alpha.pdf',
  );
  form.append(
    'files',
    new Blob([new Uint8Array(await makePdf('Beta'))], { type: 'application/pdf' }),
    'beta.pdf',
  );
  await call(`/projects/${project.id}/uploads`, 'POST', form);
  const run = await call(`/projects/${project.id}/runs`, 'POST', {});
  const stream = await fetch(`${base}/projects/${project.id}/events`, {
    headers: { Cookie: cookie },
  });
  const reader = stream.body!.getReader();
  const event = await reader.read();
  if (!new TextDecoder().decode(event.value).includes('data:'))
    throw new Error('SSE event missing');
  await reader.cancel();
  async function waitFailed() {
    for (let i = 0; i < 80; i++) {
      const current = await call(`/runs/${run.id}`);
      if (current.status === 'failed') {
        if (!current.error.includes('not configured'))
          throw new Error('Expected actionable missing-key failure');
        return;
      }
      await new Promise((r) => setTimeout(r, 500));
    }
    throw new Error('Worker did not reach failure state');
  }
  await waitFailed();
  await call(`/runs/${run.id}/retry`, 'POST', {});
  await waitFailed();
  await call(`/projects/${project.id}`, 'DELETE');
  for (let i = 0; i < 40; i++) {
    if (!(await db.project.findUnique({ where: { id: project.id } }))) break;
    await new Promise((r) => setTimeout(r, 500));
  }
  if (await db.project.findUnique({ where: { id: project.id } }))
    throw new Error('Cleanup did not finish');
  console.log(
    'PASS: live HTTP signup, two-PDF upload, SSE, real worker failure/backoff, retry endpoint, and asynchronous deletion. No AI requests sent.',
  );
} finally {
  if (userId) await db.user.deleteMany({ where: { id: userId } });
  await db.$disconnect();
}
