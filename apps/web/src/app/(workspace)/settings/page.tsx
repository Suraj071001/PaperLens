'use client';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { ThemeToggle } from '@/components/theme';
import { useUser } from '@/components/shell';
import { api } from '@/lib/api';
export default function Settings() {
  const user = useUser();
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">YOUR WORKSPACE, YOUR WAY</span>
          <h1>Account settings.</h1>
          <p>Manage your account and reading preferences.</p>
        </div>
      </div>
      <section className="panel settings-panel">
        <h2>Your account</h2>
        <div className="account-email">{user.email}</div>
      </section>
      <section className="panel settings-panel">
        <h2>Change password</h2>
        <p>Updating your password signs out your other sessions.</p>
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            const form = e.currentTarget;
            setBusy(true);
            setError('');
            setNotice('');
            try {
              await api('/account', {
                method: 'PATCH',
                body: JSON.stringify(Object.fromEntries(new FormData(form))),
              });
              setNotice('Password updated. Other sessions have been signed out.');
              form.reset();
            } catch (e) {
              setError((e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          <label>
            Current password
            <input
              type="password"
              name="currentPassword"
              autoComplete="current-password"
              required
            />
          </label>
          <label>
            New password
            <input
              type="password"
              name="password"
              minLength={12}
              maxLength={128}
              autoComplete="new-password"
              required
            />
          </label>
          {error && (
            <div role="alert" className="error-box">
              {error}
            </div>
          )}
          {notice && (
            <div role="status" className="success-box">
              {notice}
            </div>
          )}
          <Button type="submit" disabled={busy}>
            Update password
          </Button>
        </form>
      </section>
      <section className="panel settings-panel">
        <div className="panel-heading">
          <h2>Appearance</h2>
          <ThemeToggle />
        </div>
        <p>Switch between light and dark mode. This preference is saved on this device.</p>
      </section>
    </>
  );
}
