export interface CsvRecord {
  line: number;
  cells: string[];
}

/** Strips a UTF-8 BOM and picks `;`, `,` or tab by counting them in the first non-quoted line. */
export function detectDelimiter(text: string): string {
  const counts: Record<string, number> = { ",": 0, ";": 0, "\t": 0 };
  let inQuotes = false;
  for (const ch of text) {
    if (ch === '"') inQuotes = !inQuotes;
    else if (!inQuotes) {
      if (ch === "\n") break;
      if (ch in counts) counts[ch] = (counts[ch] ?? 0) + 1;
    }
  }
  let best = ",";
  for (const d of [",", ";", "\t"]) if ((counts[d] ?? 0) > (counts[best] ?? 0)) best = d;
  return best;
}

/** RFC 4180-style parser: quotes, "" escapes, newlines inside quotes, CRLF/LF/CR, BOM. */
export function parseCsv(input: string, delimiter?: string): CsvRecord[] {
  const text = input.charCodeAt(0) === 0xfeff ? input.slice(1) : input;
  const delim = delimiter ?? detectDelimiter(text);
  const records: CsvRecord[] = [];
  let cells: string[] = [];
  let cell = "";
  let inQuotes = false;
  let line = 1;
  let startLine = 1;
  let hadQuote = false;

  const endCell = () => {
    cells.push(cell);
    cell = "";
    hadQuote = false;
  };
  const endRecord = () => {
    endCell();
    const blank = cells.length === 1 && cells[0] === "" && !hadQuote;
    if (!blank) records.push({ line: startLine, cells });
    cells = [];
  };

  for (let i = 0; i < text.length; i++) {
    const ch = text[i] as string;
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i++;
        } else inQuotes = false;
      } else {
        if (ch === "\n") line++;
        cell += ch;
      }
      continue;
    }
    if (ch === '"' && cell === "") {
      inQuotes = true;
      hadQuote = true;
    } else if (ch === delim) {
      endCell();
    } else if (ch === "\r" || ch === "\n") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      endRecord();
      line++;
      startLine = line;
    } else cell += ch;
  }
  if (cell !== "" || cells.length > 0 || hadQuote) endRecord();
  return records;
}
