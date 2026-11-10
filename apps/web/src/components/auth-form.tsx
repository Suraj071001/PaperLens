'use client';
import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowRight, ScanLine, Loader2 } from 'lucide-react';
import { Button } from './ui/button';
import { api } from '@/lib/api';
export function AuthForm({ signup = false }: { signup?: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  return (
    <main className="auth-layout">
      <aside className="auth-aside">
        <Link href="/" className="brand">
          <ScanLine /> PaperLens.
        </Link>
        <div>
          <span className="eyebrow">MAKE ROOM FOR DISCOVERY</span>
          <h1>
            Good research
            <br />
            starts with
            <br />
            <em>connections.</em>
          </h1>
          <p>
            Your papers, questions, and insights.
            <br />
            One thoughtful workspace.
          </p>
        </div>
        <span>Evidence first. Always.</span>
      </aside>
      <section className="auth-main">
        <div className="auth-card">
          <Link href="/" className="back-link">
            ← Back to PaperLens
          </Link>
          <h2>{signup ? 'A fresh perspective starts here.' : 'Welcome back.'}</h2>
          <p>
            {signup
              ? 'Create your private research workspace.'
              : 'Pick up where your curiosity left off.'}
          </p>
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              setBusy(true);
              setError('');
              const data = new FormData(e.currentTarget);
              try {
                await api(`/auth/${signup ? 'signup' : 'login'}`, {
                  method: 'POST',
                  body: JSON.stringify(Object.fromEntries(data)),
                });
                router.push('/dashboard');
              } catch (e) {
                setError((e as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            <label>
              Email address
              <input
                name="email"
                type="email"
                placeholder="you@university.edu"
                autoComplete="email"
                required
              />
            </label>
            <label>
              Password
              <input
                name="password"
                type="password"
                minLength={12}
                maxLength={128}
                autoComplete={signup ? 'new-password' : 'current-password'}
                required
                placeholder="At least 12 characters"
              />
            </label>
            {error && (
              <div className="error-box" role="alert">
                {error}
              </div>
            )}
            <Button disabled={busy} className="w-full" type="submit">
              {busy ? <Loader2 className="animate-spin" /> : null}
              {signup ? 'Create account' : 'Log in'}
              <ArrowRight />
            </Button>
          </form>
          <p className="auth-switch">
            {signup ? 'Already have an account?' : 'New to PaperLens?'}{' '}
            <Link href={signup ? '/login' : '/signup'}>
              {signup ? 'Log in' : 'Create an account'}
            </Link>
          </p>
        </div>
      </section>
    </main>
  );
}
