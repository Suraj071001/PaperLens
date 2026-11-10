// Test-only adapter. Production code never imports this file.
import type { AIProvider, Usage } from '../packages/ai/src/provider.js';
import { summaryFields, comparisonDimensions, type Claim } from '@paperlens/shared';
import type { z } from 'zod';
export class FakeProvider implements AIProvider {
  calls = 0;
  failOnce = false;
  async structured<T>(
    schema: z.ZodType<T>,
    instruction: string,
    context: any,
    onUsage?: (u: Usage) => Promise<void>,
  ): Promise<T> {
    this.calls++;
    if (this.failOnce && instruction.startsWith('Compare all')) {
      this.failOnce = false;
      throw new Error('Simulated transient model failure');
    }
    const claim = (id: string, page = 1, kind: Claim['kind'] = 'reported'): Claim => ({
      text:
        kind === 'suggestion'
          ? 'AI-generated suggestion: test multilingual collections.'
          : 'The study evaluates retrieval on 100 documents.',
      kind,
      citations: [{ paperId: id, page }],
    });
    let output: unknown;
    if (instruction.startsWith('Extract concise'))
      output = { claims: [claim(context.paperId, context.page)] };
    else if (instruction.startsWith('Produce a complete'))
      output = {
        schemaVersion: 1,
        title: 'Retrieval study',
        authors: 'A. Researcher',
        year: '2024',
        venue: 'Not reported',
        bibliographyCitations: [{ paperId: context.paperId, page: 1 }],
        ...Object.fromEntries(summaryFields.map((f) => [f, claim(context.paperId)])),
      };
    else if (instruction.startsWith('Compare all')) {
      const ids = context.papers.map((p: any) => p.paperId);
      output = {
        schemaVersion: 1,
        synthesis: claim(ids[0]),
        rows: comparisonDimensions.map((d) => ({
          dimension: d,
          cells: ids.map((id: string) => ({ paperId: id, claim: claim(id) })),
        })),
        discussion: [claim(ids[0])],
        relationships: [claim(ids[0])],
      };
    } else if (instruction.startsWith('Propose'))
      output = { suggestions: [claim(context.synthesis.citations[0].paperId, 1, 'suggestion')] };
    else if (instruction.startsWith('Answer'))
      output = { answer: claim(context.evidence[0].paperId, context.evidence[0].page) };
    else output = { claims: context.flatMap((x: any) => x.claims || []).slice(0, 20) };
    await onUsage?.({
      model: 'test-only',
      promptVersion: 'test',
      durationMs: 1,
      inputTokens: 10,
      outputTokens: 10,
    });
    return schema.parse(output);
  }
}
