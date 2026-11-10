import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { RecursiveCharacterTextSplitter } from '@langchain/textsplitters';
import type { Page } from '@paperlens/shared';
import { config, analysisConfig } from './config.js';
export async function extractPages(bytes: Uint8Array): Promise<Page[]> {
  const task = getDocument({ data: new Uint8Array(bytes), useSystemFonts: true });
  try {
    const pdf = await task.promise;
    if (pdf.numPages > config.MAX_PAGES)
      throw new Error(`Document exceeds ${config.MAX_PAGES} PDF pages`);
    const pages: Page[] = [];
    let section = 'Not reported';
    for (let page = 1; page <= pdf.numPages; page++) {
      const p = await pdf.getPage(page);
      const content = await p.getTextContent();
      const text = content.items
        .map((i) => ('str' in i ? i.str + (i.hasEOL ? '\n' : ' ') : ''))
        .join('')
        .trim();
      const heading = text
        .split('\n')
        .find(
          (l) =>
            /^(\d+(\.\d+)*\s+)?(abstract|introduction|related work|methods?|methodology|results|discussion|conclusions?|references|limitations)\b/i.test(
              l.trim(),
            ) && l.length < 100,
        );
      if (heading) section = heading.trim();
      pages.push({ page, text, section });
      p.cleanup();
    }
    const readable = pages.filter((p) => p.text.replace(/\s/g, '').length >= 40);
    if (!readable.length || readable.length < pages.length * 0.6)
      throw new Error(
        'OCR_REQUIRED: This PDF is scanned or contains too little readable text. Run OCR and upload a searchable PDF.',
      );
    // Reject mixed documents rather than silently omitting image-only pages.
    if (pages.some((p) => p.text.replace(/\s/g, '').length < 15))
      throw new Error(
        'OCR_REQUIRED: One or more PDF pages have no usable text. Run OCR or remove blank pages before uploading.',
      );
    return pages;
  } finally {
    await task.destroy();
  }
}
export async function chunkPages(pages: Page[]) {
  const splitter = new RecursiveCharacterTextSplitter({
    chunkSize: analysisConfig.chunkSize,
    chunkOverlap: analysisConfig.chunkOverlap,
  });
  const chunks: { page: number; section: string; text: string }[] = [];
  for (const p of pages)
    for (const text of await splitter.splitText(p.text))
      chunks.push({ page: p.page, section: p.section, text });
  if (chunks.length > config.MAX_CHUNKS)
    throw new Error('Document exceeds the configured chunk budget');
  return chunks;
}
