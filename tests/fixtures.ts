import PDFDocument from 'pdfkit';
export async function makePdf(title = 'Study Alpha', pages = 2) {
  const doc = new PDFDocument({ autoFirstPage: false });
  const buffers: Buffer[] = [];
  const done = new Promise<Buffer>((resolve) => {
    doc.on('data', (b) => buffers.push(b));
    doc.on('end', () => resolve(Buffer.concat(buffers)));
  });
  for (let i = 1; i <= pages; i++) {
    doc.addPage();
    doc.fontSize(16).text(i === 1 ? title : '2 Results');
    doc
      .fontSize(12)
      .text(
        i === 1
          ? '1 Introduction\nAuthors: A. Researcher. Published 2024. We investigate retrieval methods using a sample of 100 documents. Our method compares lexical and dense retrieval on the same dataset.'
          : 'A controlled experiment reports recall of 0.81 for dense retrieval and 0.72 for lexical retrieval. Limitations include a small dataset and a single language. Future work should test multilingual collections.',
      );
  }
  doc.end();
  return done;
}
