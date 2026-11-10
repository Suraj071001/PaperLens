'use client';
import { use, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import {
  Upload,
  FileText,
  ArrowUpRight,
  Play,
  RotateCcw,
  Loader2,
  Trash2,
  BookOpen,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Results, type ResultsData } from '@/components/results';
import { api } from '@/lib/api';
import { Modal } from '@/components/modal';
type Paper = {
  id: string;
  title: string;
  status: string;
  error: string | null;
  pageCount: number;
  size: number;
};
type Run = { id: string; status: string; stage: string; error: string | null };
type Project = {
  id: string;
  name: string;
  description: string;
  papers: Paper[];
  runs: Run[];
  limits: { maxPapers: number; maxFileMB: number };
};
const stages = [
  'validation',
  'extraction',
  'indexing',
  'summarization',
  'comparison',
  'research_gaps',
  'citation_validation',
  'persistence',
  'completed',
];
export default function ProjectPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [project, setProject] = useState<Project>();
  const [results, setResults] = useState<ResultsData>();
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [drag, setDrag] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const resultRun = useRef('');
  const load = async () => {
    try {
      setProject(await api(`/projects/${id}`));
      setError('');
    } catch (e) {
      setError((e as Error).message);
    }
  };
  useEffect(() => {
    void load();
    const events = new EventSource(`/api/v1/projects/${id}/events`);
    events.onmessage = (e) => {
      const data = JSON.parse(e.data);
      setProject((p) =>
        p
          ? {
              ...p,
              papers: p.papers.map((x) => ({
                ...x,
                ...data.papers.find((y: Paper) => y.id === x.id),
              })),
              runs: data.runs,
            }
          : p,
      );
    };
    return () => events.close();
  }, [id]);
  const run = project?.runs[0];
  useEffect(() => {
    if (!project) return;
    const completed = run?.status === 'completed' ? run.id : 'initial';
    if (resultRun.current === completed) return;
    resultRun.current = completed;
    api<ResultsData>(`/projects/${id}/results`)
      .then(setResults)
      .catch(() => {});
  }, [project?.id, run?.id, run?.status, id]);
  const active = run?.status === 'queued' || run?.status === 'running';
  async function upload(files: File[]) {
    if (!files.length) return;
    setError('');
    setNotice('');
    if (
      files.some(
        (f) =>
          !f.name.toLowerCase().endsWith('.pdf') ||
          f.size > (project?.limits.maxFileMB || 25) * 1024 * 1024,
      )
    ) {
      setError(`Choose PDF files up to ${project?.limits.maxFileMB || 25} MB each.`);
      return;
    }
    setBusy(true);
    try {
      const body = new FormData();
      files.forEach((f) => body.append('files', f));
      const result = await api(`/projects/${id}/uploads`, { method: 'POST', body });
      setNotice(
        `${result.papers.length} paper${result.papers.length === 1 ? '' : 's'} uploaded.${result.duplicates ? ` ${result.duplicates} duplicate(s) skipped.` : ''}`,
      );
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
      if (input.current) input.current.value = '';
    }
  }
  if (!project)
    return (
      <div className="center-state">
        {error ? (
          <>
            <p role="alert">{error}</p>
            <Button onClick={load}>Retry</Button>
          </>
        ) : (
          <>
            <Loader2 className="animate-spin" />
            Opening project…
          </>
        )}
      </div>
    );
  return (
    <>
      <div className="page-heading project-title-row">
        <div>
          <Link href="/dashboard" className="back-link">
            ← All projects
          </Link>
          <h1>{project.name}</h1>
          <p>{project.description || 'Collect the evidence. Explore the connections.'}</p>
        </div>
        <div className="heading-actions">
          <Button
            variant="ghost"
            size="icon"
            aria-label="Delete project"
            onClick={() => setConfirmDelete(true)}
          >
            <Trash2 />
          </Button>
          {run?.status === 'failed' ? (
            <>
              {run.error?.includes('Analysis configuration changed') && (
                <Button
                  disabled={busy || project.papers.length < 2}
                  onClick={async () => {
                    setBusy(true);
                    setError('');
                    try {
                      await api(`/projects/${id}/runs`, { method: 'POST' });
                      await load();
                    } catch (e) {
                      setError((e as Error).message);
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  <Play />
                  Start new analysis
                </Button>
              )}
              <Button
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  try {
                    await api(`/runs/${run.id}/retry`, { method: 'POST' });
                    await load();
                  } catch (e) {
                    setError((e as Error).message);
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                <RotateCcw />
                Retry analysis
              </Button>
            </>
          ) : (
            <Button
              disabled={busy || active || project.papers.length < 2}
              onClick={async () => {
                setBusy(true);
                setError('');
                try {
                  await api(`/projects/${id}/runs`, { method: 'POST' });
                  await load();
                } catch (e) {
                  setError((e as Error).message);
                } finally {
                  setBusy(false);
                }
              }}
            >
              {active ? <Loader2 className="animate-spin" /> : <Play />}
              {active ? 'Analyzing…' : results ? 'Update analysis' : 'Analyze papers'}
            </Button>
          )}
        </div>
      </div>
      {error && (
        <div className="error-box" role="alert">
          {error}
        </div>
      )}
      {notice && (
        <div className="success-box" role="status">
          {notice}
        </div>
      )}
      <section
        className={`upload-zone ${drag ? 'dragging' : ''}`}
        onDragOver={(e) => {
          e.preventDefault();
          if (!busy && !active) setDrag(true);
        }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDrag(false);
          if (!busy && !active) void upload(Array.from(e.dataTransfer.files));
        }}
      >
        <div className="upload-copy">
          <span className="upload-icon">
            <Upload size={24} />
          </span>
          <div>
            <h3>{busy ? 'Uploading your papers…' : 'Drop your papers here.'}</h3>
            <p>
              Searchable PDFs · Up to {project.limits.maxFileMB} MB each · {project.papers.length}/
              {project.limits.maxPapers} papers
            </p>
          </div>
        </div>
        <input
          ref={input}
          type="file"
          accept=".pdf,application/pdf"
          multiple
          hidden
          aria-label="Select PDF papers"
          onChange={(e) => void upload(Array.from(e.target.files || []))}
        />
        <Button
          variant="outline"
          disabled={busy || active || project.papers.length >= project.limits.maxPapers}
          onClick={() => input.current?.click()}
        >
          {busy ? <Loader2 className="animate-spin" /> : <Upload />}Browse files
        </Button>
      </section>
      {run && (
        <section className="run-panel" aria-live="polite">
          <div className="run-top">
            <strong>
              {run.status === 'completed'
                ? 'Analysis complete'
                : run.status === 'failed'
                  ? 'Analysis needs attention'
                  : `Working through your papers · ${run.stage.replaceAll('_', ' ')}`}
            </strong>
            <span className={`status ${run.status}`}>{run.status}</span>
          </div>
          <div
            className="progress-track"
            role="progressbar"
            aria-label="Analysis stage progress"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.max(5, ((stages.indexOf(run.stage) + 1) / stages.length) * 100)}
          >
            <div
              style={{
                width: `${Math.max(5, ((stages.indexOf(run.stage) + 1) / stages.length) * 100)}%`,
              }}
            />
          </div>
          {run.error ? (
            <div className="error-box">{run.error}</div>
          ) : (
            <p>
              {active && run.stage === 'summarization'
                ? 'Summaries are built in cited sections. Groq rate limits can pause requests, so this stage and its progress bar may stay unchanged for several minutes. Completed evidence is saved.'
                : active
                  ? 'Progress is saved. You can leave this page and come back later.'
                : 'Results and their source citations are saved in this project.'}
            </p>
          )}
        </section>
      )}
      <section className="panel">
        <div className="panel-heading">
          <h2>
            Source papers <span className="count-pill">{project.papers.length}</span>
          </h2>
          <span className="muted-note">Original documents stay private</span>
        </div>
        {!project.papers.length ? (
          <div className="center-state" style={{ minHeight: 150 }}>
            <BookOpen />
            <p style={{ fontSize: 14 }}>Add at least two papers to begin your comparison.</p>
          </div>
        ) : (
          <div className="paper-list">
            {project.papers.map((p) => (
              <div className="paper-row" key={p.id}>
                <span className="file-icon">
                  <FileText size={20} />
                </span>
                <div className="paper-info">
                  <strong>{p.title}</strong>
                  <small>
                    {(p.size / 1024 / 1024).toFixed(1)} MB
                    {p.pageCount ? ` · ${p.pageCount} PDF pages` : ''}
                  </small>
                  {p.error && <div className="error-box">{p.error}</div>}
                </div>
                <span className={`status ${p.status}`}>{p.status}</span>
                <Button asChild variant="ghost" size="icon">
                  <a
                    href={`/api/v1/papers/${p.id}/file`}
                    target="_blank"
                    rel="noreferrer"
                    aria-label={`Open ${p.title}`}
                  >
                    <ArrowUpRight />
                  </a>
                </Button>
              </div>
            ))}
          </div>
        )}
      </section>
      {results && (
        <>
          {results.run.paperIds.length !== project.papers.length && (
            <div className="result-note">
              These results cover the previous collection. Run an updated analysis to include newly
              uploaded papers.
            </div>
          )}
          <Results data={results} projectId={id} />
        </>
      )}
      {confirmDelete && (
        <Modal onClose={() => setConfirmDelete(false)}>
          <section
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="delete-title"
            className="modal-card"
          >
            <h2 id="delete-title">Delete this project?</h2>
            <p>
              “{project.name}” and all its papers, conversations, and results will be permanently
              removed.
            </p>
            <div className="heading-actions">
              <Button variant="outline" onClick={() => setConfirmDelete(false)}>
                Keep project
              </Button>
              <Button
                variant="destructive"
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  try {
                    await api(`/projects/${id}`, { method: 'DELETE' });
                    window.location.assign('/dashboard');
                  } catch (e) {
                    setError((e as Error).message);
                    setConfirmDelete(false);
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                Delete project
              </Button>
            </div>
          </section>
        </Modal>
      )}
    </>
  );
}
