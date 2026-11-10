'use client';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState, createContext, useContext } from 'react';
import { ScanLine, FolderOpen, Settings, LogOut, ArrowUpRight, Loader2 } from 'lucide-react';
import { ThemeToggle } from './theme';
import { Button } from './ui/button';
import { api } from '@/lib/api';
import { WebMCP } from './webmcp';
const UserContext = createContext<{ email: string }>({ email: '' });
export const useUser = () => useContext(UserContext);
export function Shell({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<{ email: string } | null>(null);
  const [error, setError] = useState('');
  const router = useRouter();
  const path = usePathname();
  useEffect(() => {
    api('/auth/me')
      .then(setUser)
      .catch((e) => setError(e.message));
  }, []);
  if (error)
    return (
      <div className="center-state">
        <ScanLine size={36} />
        <h2>Your workspace is waiting.</h2>
        <p>{error}</p>
        <Button asChild>
          <Link href="/login">Go to login</Link>
        </Button>
        <Button variant="outline" onClick={() => window.location.reload()}>
          Retry
        </Button>
      </div>
    );
  if (!user)
    return (
      <div className="center-state">
        <Loader2 className="animate-spin" />
        <p>Opening your workspace…</p>
      </div>
    );
  return (
    <UserContext.Provider value={user}>
      <div className="app-shell">
        <aside className="sidebar">
          <Link href="/dashboard" className="brand">
            <span className="brand-icon">
              <ScanLine />
            </span>
            PaperLens<span className="brand-dot">.</span>
          </Link>
          <span className="sidebar-label">WORKSPACE</span>
          <nav>
            <Link className={path != '/settings' ? 'active' : ''} href="/dashboard">
              <FolderOpen size={19} /> Research projects
            </Link>
            <Link className={path === '/settings' ? 'active' : ''} href="/settings">
              <Settings size={19} /> Account settings
            </Link>
          </nav>
          <div className="sidebar-bottom">
            <div className="research-tip">
              <QuoteMark />
              <strong>Stay close to the source.</strong>
              <p>Click any citation to check the original evidence.</p>
            </div>
            <div className="user-row">
              <span className="avatar">{user.email.slice(0, 1).toUpperCase()}</span>
              <div>
                <strong>My workspace</strong>
                <span title={user.email}>{user.email}</span>
              </div>
              <Button
                aria-label="Log out"
                variant="ghost"
                size="icon"
                onClick={async () => {
                  await api('/auth/logout', { method: 'POST' });
                  router.push('/login');
                }}
              >
                <LogOut />
              </Button>
            </div>
          </div>
        </aside>
        <div className="app-body">
          <header className="app-topbar">
            <span>
              Workspace <span className="breadcrumb-slash">/</span>{' '}
              {path === '/settings'
                ? 'Account'
                : path.includes('/projects/')
                  ? 'Research project'
                  : 'Research projects'}
            </span>
            <div>
              <span className="private-label">
                <span className="live-dot" /> Private workspace
              </span>
              <ThemeToggle />
              <Link href="/" aria-label="About PaperLens">
                <ArrowUpRight size={18} />
              </Link>
            </div>
          </header>
          <main className="workspace-main">{children}</main>
        </div>
      </div>
    </UserContext.Provider>
  );
}
function QuoteMark() {
  return (
    <>
      <WebMCP />
      <span className="quote-mark">“</span>
    </>
  );
}
