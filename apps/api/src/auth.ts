import { randomBytes, createHash, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import type { Request, Response, NextFunction } from 'express';
import { db } from '@paperlens/db';
const scrypt = promisify(scryptCallback);
export const tokenHash = (token: string) => createHash('sha256').update(token).digest('hex');
export async function hashPassword(password: string) {
  const salt = randomBytes(16).toString('hex');
  const key = (await scrypt(password, salt, 64)) as Buffer;
  return `${salt}:${key.toString('hex')}`;
}
export async function verifyPassword(password: string, stored: string) {
  const [salt, hex] = stored.split(':');
  const actual = (await scrypt(password, salt, 64)) as Buffer;
  const expected = Buffer.from(hex, 'hex');
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
export const cookieOptions = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'lax' as const,
  path: '/',
};
export async function startSession(userId: string, res: Response) {
  const token = randomBytes(32).toString('hex');
  const csrf = randomBytes(32).toString('hex');
  await db.session.create({
    data: { id: tokenHash(token), userId, csrf, expiresAt: new Date(Date.now() + 7 * 86400000) },
  });
  res.cookie('paperlens_session', token, { ...cookieOptions, maxAge: 7 * 86400000 });
  return csrf;
}
export async function authenticate(req: Request, res: Response, next: NextFunction) {
  const token = req.cookies.paperlens_session;
  if (typeof token !== 'string') throw Object.assign(new Error('Please sign in'), { status: 401 });
  const session = await db.session.findUnique({ where: { id: tokenHash(token) } });
  if (!session || session.expiresAt < new Date())
    throw Object.assign(new Error('Session expired. Please sign in'), { status: 401 });
  res.locals.userId = session.userId;
  res.locals.session = session;
  if (
    !['GET', 'HEAD', 'OPTIONS'].includes(req.method) &&
    req.header('x-csrf-token') !== session.csrf
  )
    throw Object.assign(new Error('Invalid security token. Refresh and try again'), {
      status: 403,
    });
  next();
}
