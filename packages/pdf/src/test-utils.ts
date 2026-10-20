import { inflateSync } from "node:zlib";

/** Page count by counting /Type /Page objects (not /Pages). */
export function countPages(pdf: Uint8Array): number {
  return (Buffer.from(pdf).toString("latin1").match(/\/Type \/Page(?![s\w])/g) ?? []).length;
}

/**
 * Tiny text extractor for PDFs produced by pdfkit with standard fonts:
 * inflates content streams and decodes hex strings in Tj/TJ operators
 * (WinAnsi). Returns one line per text-showing operator.
 */
export function extractText(pdf: Uint8Array): string {
  const raw = Buffer.from(pdf);
  const latin = raw.toString("latin1");
  // WinAnsi differs from Latin-1 only for 0x80-0x9F; the euro sign is the one we need.
  const decoder = { decode: (b: Buffer) => b.toString("latin1").replaceAll("\x80", "€") };
  const lines: string[] = [];
  const re = /stream\r?\n/g;
  for (let m = re.exec(latin); m; m = re.exec(latin)) {
    const start = m.index + m[0].length;
    const end = latin.indexOf("endstream", start);
    if (end < 0) break;
    let content: string;
    try {
      content = inflateSync(raw.subarray(start, end)).toString("latin1");
    } catch {
      continue; // images, fonts, etc.
    }
    for (const op of content.matchAll(/\[((?:<[0-9a-fA-F]*>|[^\]<])*)\]\s*TJ|<([0-9a-fA-F]*)>\s*Tj/g)) {
      const hexes = [...(op[1] ?? op[2] ?? "").matchAll(/<([0-9a-fA-F]*)>/g)].map((h) => h[1] as string);
      if (op[2] !== undefined) hexes.push(op[2]);
      const bytes = Buffer.from(hexes.join(""), "hex");
      lines.push(decoder.decode(bytes));
    }
  }
  return lines.join("\n");
}
