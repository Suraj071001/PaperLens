import { describe, it, expect } from 'vitest';
import {
  validatePdf,
  validateCitations,
  summarySchema,
  claimSchema,
  vectorLiteral,
  validateComparison,
  comparisonDimensions,
} from '@paperlens/shared';
import { hashPassword, verifyPassword, tokenHash } from '../apps/api/src/auth.js';
import { extractPages, chunkPages } from '../packages/ai/src/documents.js';
import { makePdf } from './fixtures.js';
describe('upload validation', () => {
  it('requires both signature and extension', () => {
    expect(() => validatePdf('bad.pdf', Buffer.from('not a pdf document at all'))).toThrow();
    expect(() => validatePdf('bad.txt', Buffer.from('%PDF-1.7 document content'))).toThrow();
  });
  it('enforces configured size and rejects truncation', () => {
    expect(() => validatePdf('a.pdf', Buffer.from('%PDF-1.7 document content'), 10)).toThrow(
      /size/,
    );
    expect(() => validatePdf('a.pdf', Buffer.from('%PDF-'))).toThrow(/truncated/);
  });
  it('accepts genuine generated PDFs', async () =>
    expect(() => validatePdf('study.PDF', awaitedPdf)).not.toThrow());
});
const awaitedPdf = await makePdf();
describe('PDF page coverage', () => {
  it('preserves physical page numbers and headings', async () => {
    const pages = await extractPages(awaitedPdf);
    expect(pages).toHaveLength(2);
    expect(pages[0].page).toBe(1);
    expect(pages[1].page).toBe(2);
    expect(pages[1].text).toContain('0.81');
    expect(pages[1].section).toMatch(/Results/);
    const chunks = await chunkPages(pages);
    expect(new Set(chunks.map((c) => c.page))).toEqual(new Set([1, 2]));
  });
  it('rejects unreadable PDFs', async () => {
    const { default: PDF } = await import('pdfkit');
    const d = new PDF();
    const parts: Buffer[] = [];
    const p = new Promise<Buffer>((r) => {
      d.on('data', (b) => parts.push(b));
      d.on('end', () => r(Buffer.concat(parts)));
    });
    d.end();
    await expect(extractPages(await p)).rejects.toThrow(/OCR_REQUIRED/);
  });
  it('overlaps long text without losing page metadata', async () => {
    const text = 'Detailed experimental evidence. '.repeat(450);
    const chunks = await chunkPages([{ page: 7, section: 'Methods', text }]);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every((c) => c.page === 7 && c.section === 'Methods')).toBe(true);
  });
});
describe('evidence validation', () => {
  const claim = {
    text: 'A reported finding',
    kind: 'reported',
    citations: [{ paperId: 'a', page: 2 }],
  };
  it('accepts grounded claims and explicit missing evidence', () => {
    expect(() => validateCitations(claim, { a: 2 })).not.toThrow();
    expect(() =>
      validateCitations({ text: 'Not reported', kind: 'missing', citations: [] }, { a: 2 }),
    ).not.toThrow();
  });
  it('rejects nonexistent, out-of-range and unretrieved citations', () => {
    expect(() => validateCitations(claim, { b: 3 })).toThrow();
    expect(() => validateCitations(claim, { a: 1 })).toThrow();
    expect(() => validateCitations(claim, { a: 4 }, new Set(['a:1']))).toThrow();
  });
  it('rejects unsupported factual claims', () => {
    expect(() => validateCitations({ ...claim, citations: [] }, { a: 2 })).toThrow();
    expect(claimSchema.safeParse({ ...claim, kind: 'fact' }).success).toBe(false);
  });
  it('rejects malformed summaries and incomplete comparison matrices', () => {
    expect(summarySchema.safeParse({ title: 'Hallucination' }).success).toBe(false);
    expect(() =>
      validateComparison(
        {
          schemaVersion: 1,
          synthesis: claim as any,
          rows: comparisonDimensions.map((d) => ({ dimension: d, cells: [] })),
          discussion: [],
          relationships: [],
        },
        ['a', 'b'],
      ),
    ).toThrow();
  });
  it('rejects invalid embedding dimensions and nonfinite values', () => {
    expect(() => vectorLiteral([1, 2])).toThrow();
    expect(() => vectorLiteral([NaN], 1)).toThrow();
    expect(vectorLiteral([0.1, 0.2], 2)).toBe('[0.1,0.2]');
  });
});
describe('password security', () => {
  it('salts hashes and verifies passwords', async () => {
    const a = await hashPassword('my secure password');
    const b = await hashPassword('my secure password');
    expect(a).not.toBe(b);
    expect(await verifyPassword('my secure password', a)).toBe(true);
    expect(await verifyPassword('wrong password', a)).toBe(false);
    expect(tokenHash('secret')).not.toContain('secret');
  });
});
