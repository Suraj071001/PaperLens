import Link from 'next/link';
import {
  ArrowRight,
  ScanLine,
  BookOpen,
  Network,
  Quote,
  FileCheck2,
  ShieldCheck,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ThemeToggle } from '@/components/theme';
export default function Landing() {
  return (
    <div className="landing">
      <nav className="public-nav">
        <Link href="/" className="brand">
          <span className="brand-icon">
            <ScanLine />
          </span>
          PaperLens<span className="brand-dot">.</span>
        </Link>
        <div className="nav-right">
          <ThemeToggle />
          <Link href="/login">Log in</Link>
          <Button asChild>
            <Link href="/signup">
              Create an account <ArrowRight />
            </Link>
          </Button>
        </div>
      </nav>
      <main>
        <section className="hero">
          <div className="hero-copy">
            <span className="eyebrow">
              <span className="live-dot" /> YOUR RESEARCH, IN PERSPECTIVE
            </span>
            <h1>
              Read between
              <br />
              the <span>papers.</span>
            </h1>
            <p>
              Turn a stack of research papers into a connected understanding. Compare methods,
              uncover differences, and follow every insight back to its source.
            </p>
            <div className="hero-actions">
              <Button asChild>
                <Link href="/signup">
                  Start your research <ArrowRight />
                </Link>
              </Button>
              <a href="#how-it-works">See how it works ↓</a>
            </div>
            <div className="hero-note">
              <ShieldCheck size={17} /> Private projects. Evidence at every step.
            </div>
          </div>
          <div
            className="research-visual"
            aria-label="Research workflow: papers, evidence, and a connected understanding"
          >
            <div className="visual-header">
              <span className="tiny-label">THE RESEARCH WORKSPACE</span>
              <span className="visual-dot" />
            </div>
            <div className="visual-docs">
              {['01', '02', '03'].map((n, i) => (
                <div className="visual-paper" key={n}>
                  <div className="paper-top">
                    <BookOpen size={19} />
                    <span>{n}</span>
                  </div>
                  <strong>
                    {['Research question', 'Method & evidence', 'Findings & limits'][i]}
                  </strong>
                  <div className="ink-line wide" />
                  <div className="ink-line" />
                  <div className="ink-line short" />
                  <div className="paper-tag">Source document</div>
                </div>
              ))}
            </div>
            <div className="connection-line">
              <span />
              <span />
              <span />
            </div>
            <div className="insight-card">
              <div className="insight-icon">
                <Network size={23} />
              </div>
              <div>
                <span className="tiny-label">ONE CONNECTED VIEW</span>
                <h3>A clearer picture of the literature</h3>
                <p>Shared themes · Distinct methods · Open questions</p>
              </div>
            </div>
            <div className="evidence-strip">
              <Quote size={16} />
              <span>Every claim connects to a PDF page</span>
              <FileCheck2 size={16} />
            </div>
          </div>
        </section>
        <section className="steps" id="how-it-works">
          <div className="section-intro">
            <span className="eyebrow">LESS SORTING. MORE UNDERSTANDING.</span>
            <h2>From papers to perspective.</h2>
          </div>
          <div className="step-grid">
            {[
              {
                n: '01',
                title: 'Bring your sources',
                text: 'Create a project and upload 2–10 searchable PDFs. Keep the literature for each question together.',
                icon: BookOpen,
              },
              {
                n: '02',
                title: 'Explore the connections',
                text: 'Read individual summaries, compare the evidence side by side, and explore potential research directions.',
                icon: Network,
              },
              {
                n: '03',
                title: 'Ask a better question',
                text: 'Ask follow-up questions, check the cited pages, and export your analysis for the next stage of your work.',
                icon: Quote,
              },
            ].map((x) => (
              <article key={x.n}>
                <div className="step-heading">
                  <x.icon size={23} />
                  <span>{x.n}</span>
                </div>
                <h3>{x.title}</h3>
                <p>{x.text}</p>
              </article>
            ))}
          </div>
        </section>
      </main>
      <footer className="public-footer">
        <span>PaperLens · A little clarity for your next discovery.</span>
        <span>AI assists. Your judgment leads.</span>
      </footer>
    </div>
  );
}
