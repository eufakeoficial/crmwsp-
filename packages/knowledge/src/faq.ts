import type { FaqPair } from "./types.js";

const QA_LINE = /^\s*(?:\*\*)?(P|Q|R|A|Pregunta|Question|Respuesta|Answer)(?:\*\*)?\s*:\s*(.*)$/i;

/** Accepts "P:/R:", "Q:/A:" (also Pregunta/Respuesta) and markdown with one "## question" per pair. */
export function parseFaq(input: string): FaqPair[] {
  const text = input.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n");
  return /^##\s+\S/m.test(text) ? parseMarkdown(text) : parseQa(text);
}

function parseMarkdown(text: string): FaqPair[] {
  const pairs: FaqPair[] = [];
  let q: string | null = null;
  let body: string[] = [];
  const flush = () => {
    const answer = body.join("\n").trim();
    if (q && answer) pairs.push({ question: q, answer });
  };
  for (const line of text.split("\n")) {
    const heading = /^##\s/.test(line) ? stripHeading(line) : null;
    if (heading) {
      flush();
      q = heading;
      body = [];
    } else if (q !== null) body.push(line);
  }
  flush();
  return pairs;
}

function parseQa(text: string): FaqPair[] {
  const pairs: FaqPair[] = [];
  let q: string[] | null = null;
  let a: string[] | null = null;
  const flush = () => {
    const question = q?.join("\n").trim();
    const answer = a?.join("\n").trim();
    if (question && answer) pairs.push({ question, answer });
  };
  for (const line of text.split("\n")) {
    const m = QA_LINE.exec(line);
    const tag = m?.[1]?.toLowerCase();
    if (m && (tag === "p" || tag === "q" || tag === "pregunta" || tag === "question")) {
      flush();
      q = [m[2] as string];
      a = null;
    } else if (m && q && (tag === "r" || tag === "a" || tag === "respuesta" || tag === "answer")) {
      a = [m[2] as string];
    } else if (a) a.push(line);
    else if (q) q.push(line);
  }
  flush();
  return pairs;
}

/** "## Question ##  " -> "Question", without backtracking-prone regexes. */
function stripHeading(line: string): string | null {
  let end = line.length;
  while (end > 2 && /[\s#]/.test(line[end - 1] as string)) end--;
  const q = line.slice(2, end).trim();
  return q || null;
}
