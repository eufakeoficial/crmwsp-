import { AppError, ErrorCode, KNOWLEDGE_MAX_ROW_ERRORS, type KnowledgeRowError } from "@crmwsp/contracts";
import {
  KnowledgeError,
  chunkDocument,
  contentHash,
  parseCsvCatalog,
  parseFaq,
  parsePdf,
  type Chunk,
  type ChunkInput,
} from "@crmwsp/knowledge";
import { withDefaultCurrency } from "./default-currency.js";

/** 422: the content was understood as a request but cannot be turned into a knowledge source. */
export class UnprocessableSourceError extends AppError {
  constructor(message: string, errors: KnowledgeRowError[] = [], total: number = errors.length) {
    super(ErrorCode.ValidationError, message, 422, {
      details: { errors: errors.slice(0, KNOWLEDGE_MAX_ROW_ERRORS), totalErrors: total },
    });
  }
}

export interface ProcessedSource {
  kind: "csv" | "pdf" | "faq" | "text";
  hash: string;
  chunks: Chunk[];
}

export type RawSource =
  | { kind: "csv"; data: Buffer; defaultCurrency: string }
  | { kind: "pdf"; data: Buffer }
  | { kind: "faq" | "text"; content: string };

const decode = (data: Buffer): string => new TextDecoder("utf-8").decode(data);

async function toChunkInput(src: RawSource): Promise<ChunkInput> {
  switch (src.kind) {
    case "csv": {
      const parsed = parseCsvCatalog(withDefaultCurrency(decode(src.data), src.defaultCurrency));
      if (parsed.errors.length > 0) {
        throw new UnprocessableSourceError(
          "The catalog has invalid rows; nothing was imported",
          parsed.errors.map((e) => ({ line: e.line, reason: e.reason })),
        );
      }
      if (parsed.rows.length === 0) throw new UnprocessableSourceError("The catalog has no rows");
      return { kind: "catalog", rows: parsed.rows };
    }
    case "pdf": {
      if (src.data.subarray(0, 5).toString("latin1") !== "%PDF-") throw new UnprocessableSourceError("The file is not a PDF");
      const { text } = await parsePdf(new Uint8Array(src.data));
      if (text.trim() === "") throw new UnprocessableSourceError("The PDF has no extractable text (scanned PDFs are not supported)");
      return { kind: "pdf", text };
    }
    case "faq": {
      const pairs = parseFaq(src.content);
      if (pairs.length === 0) throw new UnprocessableSourceError("No question/answer pairs found (use P:/R:, Q:/A: or '## question' headings)");
      return { kind: "faq", pairs };
    }
    case "text": {
      if (src.content.trim() === "") throw new UnprocessableSourceError("The text is empty");
      return { kind: "text", text: src.content };
    }
  }
}

/** Parses, chunks and hashes a source in memory (MVP: no object storage). Throws UnprocessableSourceError (422). */
export async function processSource(src: RawSource): Promise<ProcessedSource> {
  let input: ChunkInput;
  try {
    input = await toChunkInput(src);
  } catch (err) {
    if (err instanceof KnowledgeError) throw new UnprocessableSourceError(err.message);
    throw err;
  }
  const chunks = chunkDocument(input);
  if (chunks.length === 0) throw new UnprocessableSourceError("The source produced no content");
  return { kind: src.kind, hash: contentHash(input), chunks };
}
