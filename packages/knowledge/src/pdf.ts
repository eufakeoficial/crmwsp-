import { extractText, getDocumentProxy } from "unpdf";
import { KnowledgeError, type PdfParseResult } from "./types.js";

export const MAX_PDF_BYTES = 15 * 1024 * 1024;
export const MAX_PDF_PAGES = 300;

export async function parsePdf(bytes: Uint8Array): Promise<PdfParseResult> {
  if (bytes.byteLength > MAX_PDF_BYTES) {
    throw new KnowledgeError("pdf_too_large", `PDF exceeds the ${MAX_PDF_BYTES / 1024 / 1024} MB limit`);
  }
  let doc;
  try {
    // pdf.js may detach the buffer it receives; hand it a copy.
    // The pdf.js build bundled by unpdf has no eval/new Function path (isEvalSupported was removed
    // upstream; a test guards this) and never runs PDF scripting. XFA forms are disabled too.
    doc = await getDocumentProxy(new Uint8Array(bytes), { enableXfa: false });
  } catch (err) {
    throw new KnowledgeError("pdf_invalid", `Could not read PDF: ${err instanceof Error ? err.message : "unknown error"}`);
  }
  if (doc.numPages > MAX_PDF_PAGES) {
    throw new KnowledgeError("pdf_too_many_pages", `PDF has ${doc.numPages} pages; the limit is ${MAX_PDF_PAGES}`);
  }
  const { text } = await extractText(doc, { mergePages: false });
  return { text: text.map((t) => t.trim()).filter(Boolean).join("\n\n"), pages: doc.numPages };
}
