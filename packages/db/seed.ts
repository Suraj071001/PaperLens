import { db } from './src/index.js';
import { hashPassword } from '../../apps/api/src/auth.js';
if (process.env.NODE_ENV === 'production')
  throw new Error('Development seed cannot run in production');
if (!process.env.SEED_EMAIL || !process.env.SEED_PASSWORD)
  throw new Error('Set SEED_EMAIL and SEED_PASSWORD (12+ characters) before seeding');
if (process.env.SEED_PASSWORD.length < 12)
  throw new Error('Seed password must be at least 12 characters');
const user = await db.user.upsert({
  where: { email: process.env.SEED_EMAIL },
  create: {
    email: process.env.SEED_EMAIL,
    passwordHash: await hashPassword(process.env.SEED_PASSWORD),
  },
  update: {},
});
if (!(await db.project.findFirst({ where: { userId: user.id } })))
  await db.project.create({
    data: {
      userId: user.id,
      name: 'My first literature review',
      description:
        'Upload related research papers to explore their methods, findings, and open questions.',
    },
  });
console.log('Development account and empty project ready. No synthetic AI results were seeded.');
await db.$disconnect();
