'use client';
import { useEffect, useState } from 'react';
import { Download, MessageSquare, ArrowUpRight, Send, Loader2, Info } from 'lucide-react';
import { summaryFields, type Claim, type Summary, type Comparison } from '@paperlens/shared';
import { Button } from './ui/button';
import { Tabs, TabsList, TabsTrigger, TabsContent } from './ui/tabs';
import { api } from '@/lib/api';
export type ResultsData = {
  run: { id: string; paperIds: string[]; createdAt: string };
  summaries: { paperId: string; output: Summary; paper: { title: string } }[];
  result: { output: Comparison; gaps: { suggestions: Claim[] } };
};
export function ClaimView({ claim, titles }: { claim: Claim; titles: Record<string, string> }) {
  return (
    <div className="claim">
      {claim.kind === 'interpretation' && <span className="claim-label">AI interpretation</span>}
      {claim.kind === 'suggestion' && <span className="claim-label">AI-generated suggestion</span>}
      {claim.text}{' '}
      {claim.citations.map((c, i) => (
        <a
          key={i}
          className="citation"
          href={`/api/v1/papers/${c.paperId}/file#page=${c.page}`}
          target="_blank"
          rel="noreferrer"
          title={`${titles[c.paperId] || 'Source paper'} · PDF page ${c.page}`}
        >
          {(titles[c.paperId] || 'Paper').replace(/\.pdf$/i, '').slice(0, 28)} · p. {c.page}
          <span className="sr-only"> (opens source PDF in a new tab)</span>
        </a>
      ))}
    </div>
  );
}
const fieldTitles: Record<string, string> = {
  problem: 'Research problem',
  objectives: 'Objectives',
  contributions: 'Main contributions',
  methodology: 'Methodology',
  experimentalSetup: 'Experimental setup',
  datasets: 'Datasets & sources',
  findings: 'Findings & reported metrics',
  limitations: 'Limitations',
  futureWork: 'Future work',
  plainLanguage: 'In plain language',
};
export function Results({ data, projectId }: { data: ResultsData; projectId: string }) {
  const titles = Object.fromEntries(
    data.summaries.map((s) => [
      s.paperId,
      s.output.title === 'Not reported' ? s.paper.title : s.output.title,
    ]),
  );
  const c = data.result.output;
  return (
    <section>
      <div className="result-toolbar">
        <h2>Your research, connected.</h2>
        <div>
          <Button asChild variant="outline" size="sm">
            <a href={`/api/v1/projects/${projectId}/exports?format=md`}>
              <Download />
              Markdown
            </a>
          </Button>
          <Button asChild variant="outline" size="sm">
            <a href={`/api/v1/projects/${projectId}/exports?format=pdf`}>
              <Download />
              PDF
            </a>
          </Button>
        </div>
      </div>
      <div className="result-note">
        <Info size={15} />
        <span>
          Citations use PDF page numbers, which may differ from printed labels. Check the source
          before relying on a claim; validated citations do not guarantee scientific correctness.
        </span>
      </div>
      <Tabs defaultValue="overview">
        <TabsList>
          {[
            ['overview', 'Overview'],
            ['summaries', 'Paper Summaries'],
            ['comparison', 'Comparison'],
            ['gaps', 'Research Gaps'],
            ['chat', 'Chat'],
          ].map(([value, label]) => (
            <TabsTrigger key={value} value={value}>
              {label}
            </TabsTrigger>
          ))}
        </TabsList>
        <TabsContent value="overview">
          <div className="overview-grid">
            <article className="panel">
              <div className="panel-heading">
                <h2>The bigger picture</h2>
                <span className="status completed">{data.summaries.length} papers</span>
              </div>
              <ClaimView claim={c.synthesis} titles={titles} />
            </article>
            <aside className="panel">
              <div className="panel-heading">
                <h2>Source collection</h2>
              </div>
              {data.summaries.map((s, i) => (
                <a
                  className="paper-row"
                  href={`/api/v1/papers/${s.paperId}/file`}
                  target="_blank"
                  rel="noreferrer"
                  key={s.paperId}
                >
                  <span className="count-pill">{String(i + 1).padStart(2, '0')}</span>
                  <div className="paper-info">
                    <strong>{titles[s.paperId]}</strong>
                    <small>{s.output.year}</small>
                  </div>
                  <ArrowUpRight size={16} />
                </a>
              ))}
            </aside>
          </div>
          <article className="panel">
            <div className="panel-heading">
              <h2>How the papers relate</h2>
            </div>
            {c.relationships.map((x, i) => (
              <div className="gap-item" key={i}>
                <span className="gap-number">{String(i + 1).padStart(2, '0')}</span>
                <ClaimView claim={x} titles={titles} />
              </div>
            ))}
          </article>
        </TabsContent>
        <TabsContent value="summaries">
          {data.summaries.map((s) => (
            <article className="panel summary-card" key={s.paperId}>
              <div className="summary-header">
                <h2>{titles[s.paperId]}</h2>
                <p>
                  {s.output.authors} · {s.output.year} · {s.output.venue}
                </p>
                <div>
                  {s.output.bibliographyCitations.map((x, i) => (
                    <a
                      className="citation"
                      href={`/api/v1/papers/${x.paperId}/file#page=${x.page}`}
                      target="_blank"
                      rel="noreferrer"
                      key={i}
                    >
                      Bibliographic source · PDF p. {x.page}
                    </a>
                  ))}
                </div>
              </div>
              <div className="summary-fields">
                {summaryFields.map((f) => (
                  <section key={f}>
                    <h3>{fieldTitles[f]}</h3>
                    <ClaimView claim={s.output[f]} titles={titles} />
                  </section>
                ))}
              </div>
            </article>
          ))}
        </TabsContent>
        <TabsContent value="comparison">
          <div className="comparison-wrap">
            <table className="comparison-table">
              <thead>
                <tr>
                  <th>Comparison lens</th>
                  {data.summaries.map((s) => (
                    <th key={s.paperId}>{titles[s.paperId]}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {c.rows.map((row) => (
                  <tr key={row.dimension}>
                    <td>{row.dimension}</td>
                    {data.summaries.map((s) => (
                      <td key={s.paperId}>
                        <ClaimView
                          claim={row.cells.find((x) => x.paperId === s.paperId)!.claim}
                          titles={titles}
                        />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="comparison-mobile">
            {c.rows.map((row) => (
              <section className="panel" key={row.dimension}>
                <h2>{row.dimension}</h2>
                {row.cells.map((cell) => (
                  <div key={cell.paperId}>
                    <h3>{titles[cell.paperId]}</h3>
                    <ClaimView claim={cell.claim} titles={titles} />
                  </div>
                ))}
              </section>
            ))}
          </div>
          <article className="panel" style={{ marginTop: 24 }}>
            <div className="panel-heading">
              <h2>Important similarities & differences</h2>
            </div>
            {c.discussion.map((x, i) => (
              <div className="gap-item" key={i}>
                <ClaimView claim={x} titles={titles} />
              </div>
            ))}
          </article>
        </TabsContent>
        <TabsContent value="gaps">
          <article className="panel">
            <h2>Where could this research go next?</h2>
            <p style={{ fontSize: 14, marginTop: 10 }}>
              AI-generated suggestions based on this collection. These are starting points for
              investigation, not a verified survey of gaps in the wider literature.
            </p>
            {data.result.gaps.suggestions.map((x, i) => (
              <div className="gap-item" key={i}>
                <span className="gap-number">{String(i + 1).padStart(2, '0')}</span>
                <ClaimView claim={x} titles={titles} />
              </div>
            ))}
          </article>
        </TabsContent>
        <TabsContent value="chat">
          <ResearchChat projectId={projectId} titles={titles} />
        </TabsContent>
      </Tabs>
    </section>
  );
}
function ResearchChat({
  projectId,
  titles,
}: {
  projectId: string;
  titles: Record<string, string>;
}) {
  const [messages, setMessages] = useState<{ role: string; content: any }[]>([]);
  const [conversationId, setConversationId] = useState<string>();
  const [conversations, setConversations] = useState<any[]>([]);
  const [selected, setSelected] = useState(Object.keys(titles));
  const [question, setQuestion] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    api(`/projects/${projectId}/conversations`)
      .then((cs) => {
        setConversations(cs);
        if (cs[0]) {
          setConversationId(cs[0].id);
          setMessages([...cs[0].messages].reverse());
        }
      })
      .catch((e) => setError(e.message));
  }, [projectId]);
  return (
    <div className="chat-layout">
      <aside className="panel chat-sources">
        <h3>Include sources</h3>
        <p className="muted-note">Choose the papers to ask about.</p>
        {Object.entries(titles).map(([id, title]) => (
          <label key={id}>
            <input
              type="checkbox"
              checked={selected.includes(id)}
              onChange={(e) =>
                setSelected(e.target.checked ? [...selected, id] : selected.filter((x) => x !== id))
              }
            />
            {title}
          </label>
        ))}
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            setConversationId(undefined);
            setMessages([]);
          }}
        >
          New conversation
        </Button>
        {conversations.length > 0 && (
          <label style={{ marginTop: 18 }}>
            Saved conversations
            <select
              value={conversationId || ''}
              onChange={(e) => {
                const c = conversations.find((c) => c.id === e.target.value);
                if (c) {
                  setConversationId(c.id);
                  setMessages([...c.messages].reverse());
                }
              }}
            >
              <option value="">New conversation</option>
              {conversations.map((c, i) => (
                <option key={c.id} value={c.id}>
                  Conversation {conversations.length - i}
                </option>
              ))}
            </select>
          </label>
        )}
      </aside>
      <section className="panel">
        <div className="chat-messages" aria-live="polite">
          {!messages.length && (
            <div className="center-state" style={{ minHeight: 250 }}>
              <MessageSquare size={30} />
              <h3>Put your papers in conversation.</h3>
              <p style={{ fontSize: 14 }}>
                Ask about a method, a result, or something that doesn’t quite add up.
              </p>
            </div>
          )}
          {messages.map((m, i) => (
            <article key={i} className={`chat-message ${m.role}`}>
              <strong>{m.role === 'user' ? 'You' : 'PaperLens'}</strong>
              {m.role === 'user' ? (
                <div className="claim">{m.content.text}</div>
              ) : (
                <ClaimView claim={m.content} titles={titles} />
              )}
            </article>
          ))}
          {busy && (
            <p className="muted-note">
              <Loader2 size={16} className="animate-spin inline" /> Finding evidence and checking
              citations…
            </p>
          )}
        </div>
        {error && (
          <div className="error-box" role="alert">
            {error}
          </div>
        )}
        <form
          className="chat-input"
          onSubmit={async (e) => {
            e.preventDefault();
            if (!selected.length) {
              setError('Select at least one source paper.');
              return;
            }
            setBusy(true);
            setError('');
            try {
              const result = await api(`/projects/${projectId}/chat`, {
                method: 'POST',
                body: JSON.stringify({ question, conversationId, paperIds: selected }),
              });
              setMessages((ms) => [
                ...ms,
                { role: 'user', content: { text: question } },
                { role: 'assistant', content: result.answer },
              ]);
              setConversationId(result.conversationId);
              setQuestion('');
              setConversations(await api(`/projects/${projectId}/conversations`));
            } catch (e) {
              setError((e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          <label>
            <span className="sr-only">Question about your papers</span>
            <textarea
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              rows={2}
              maxLength={4000}
              placeholder="What do these papers agree on?"
              required
            />
          </label>
          <Button disabled={busy || !selected.length} type="submit">
            <Send />
            Ask
          </Button>
        </form>
      </section>
    </div>
  );
}
