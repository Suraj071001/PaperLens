'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Plus, ArrowUpRight, BookOpen, FolderOpen, Search, X, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { api } from '@/lib/api';
import { Modal } from '@/components/modal';
type Project = {
  id: string;
  name: string;
  description: string;
  createdAt: string;
  _count: { papers: number };
  runs: { status: string }[];
};
export default function Dashboard() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [create, setCreate] = useState(false);
  const [busy, setBusy] = useState(false);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const load = async () => {
    setLoading(true);
    try {
      const d = await api(`/projects?page=${page}`);
      setProjects(d.items);
      setTotal(d.total);
      setError('');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    void load();
  }, [page]);
  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">YOUR PERSONAL RESEARCH LIBRARY</span>
          <h1>
            Research projects<span className="brand-dot">.</span>
          </h1>
          <p>A home for your papers. A starting point for your next insight.</p>
        </div>
        <Button onClick={() => setCreate(true)}>
          <Plus />
          New project
        </Button>
      </div>
      <section className="dashboard-banner">
        <div className="banner-icon">
          <BookOpen size={30} />
        </div>
        <div>
          <span className="eyebrow">A LITTLE STRUCTURE. A LOT MORE CLARITY.</span>
          <h2>Big ideas start with a good question.</h2>
          <p>Bring related papers together, compare their evidence, and see what connects.</p>
        </div>
        <span className="banner-number">
          {String(total).padStart(2, '0')}
          <small>PROJECTS</small>
        </span>
      </section>
      <div className="list-toolbar">
        <h2>
          All projects <span className="count-pill">{total}</span>
        </h2>
        <label className="search-field">
          <Search size={17} />
          <input
            aria-label="Filter projects on this page"
            placeholder="Find a project on this page…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </label>
      </div>
      {error && (
        <div className="error-box" role="alert">
          {error} <button onClick={load}>Retry</button>
        </div>
      )}
      {loading ? (
        <div className="center-state">
          <Loader2 className="animate-spin" />
          Loading your projects…
        </div>
      ) : projects.length === 0 ? (
        <div className="empty-state">
          <span className="empty-icon">
            <FolderOpen size={30} />
          </span>
          <h2>Your next discovery belongs here.</h2>
          <p>Create a project, add your first papers, and start connecting the dots.</p>
          <Button onClick={() => setCreate(true)}>
            <Plus />
            Create your first project
          </Button>
          <span className="muted-note">Searchable PDFs · 2–10 papers per project</span>
        </div>
      ) : (
        <div className="project-grid">
          {projects
            .filter((p) =>
              (p.name + ' ' + p.description).toLowerCase().includes(search.toLowerCase()),
            )
            .map((p, i) => (
              <Link href={`/projects/${p.id}`} className="project-card" key={p.id}>
                <div className="project-card-top">
                  <span className={`project-icon tone-${i % 3}`}>
                    <FolderOpen size={22} />
                  </span>
                  <ArrowUpRight size={20} />
                </div>
                <h3>{p.name}</h3>
                <p>{p.description || 'A new collection of research, ready to explore.'}</p>
                <div className="project-card-meta">
                  <span>
                    <BookOpen size={15} />
                    {p._count.papers} papers
                  </span>
                  <span className={`status ${p.runs[0]?.status || 'uploaded'}`}>
                    {p.runs[0]?.status || 'Collecting papers'}
                  </span>
                </div>
                <div className="project-date">
                  Created{' '}
                  {new Date(p.createdAt).toLocaleDateString(undefined, {
                    month: 'short',
                    day: 'numeric',
                    year: 'numeric',
                  })}
                </div>
              </Link>
            ))}
        </div>
      )}
      {total > 20 && (
        <div className="pagination">
          <Button variant="outline" disabled={page === 1} onClick={() => setPage(page - 1)}>
            Previous
          </Button>
          <span>
            Page {page} of {Math.ceil(total / 20)}
          </span>
          <Button variant="outline" disabled={page * 20 >= total} onClick={() => setPage(page + 1)}>
            Next
          </Button>
        </div>
      )}
      {create && (
        <Modal onClose={() => setCreate(false)}>
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="create-title"
            className="modal-card"
          >
            <div className="modal-heading">
              <h2 id="create-title">A new line of inquiry.</h2>
              <Button
                variant="ghost"
                size="icon"
                aria-label="Close"
                onClick={() => setCreate(false)}
              >
                <X />
              </Button>
            </div>
            <p>Give this collection a name you’ll recognize.</p>
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                setBusy(true);
                try {
                  const d = new FormData(e.currentTarget);
                  const p = await api('/projects', {
                    method: 'POST',
                    body: JSON.stringify(Object.fromEntries(d)),
                  });
                  window.location.assign(`/projects/${p.id}`);
                } catch (e) {
                  setError((e as Error).message);
                } finally {
                  setBusy(false);
                }
              }}
            >
              <label>
                Project name
                <input
                  autoFocus
                  name="name"
                  placeholder="e.g. Retrieval-augmented generation"
                  maxLength={120}
                  required
                />
              </label>
              <label>
                Research question or notes <span className="optional">optional</span>
                <textarea
                  name="description"
                  placeholder="What are you trying to understand?"
                  maxLength={2000}
                  rows={3}
                />
              </label>
              {error && <div className="error-box">{error}</div>}
              <Button disabled={busy} type="submit">
                {busy ? <Loader2 className="animate-spin" /> : <Plus />}Create project
              </Button>
            </form>
          </section>
        </Modal>
      )}
    </>
  );
}
