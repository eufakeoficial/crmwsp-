import { describe, expect, it } from "vitest";
import { buildMessageCitations, MESSAGE_CITATION_EXCERPT_MAX } from "./citations.js";

const chunks = new Map([
  ["c1", { title: "Catálogo 2026", content: "Limpieza dental  desde\n$40" }],
  ["c2", { title: "Catálogo 2026", content: "Otro fragmento de la misma fuente" }],
  ["c3", { title: "Políticas", content: "x".repeat(500) }],
  ["c4", { title: "Horarios", content: "Lunes a viernes" }],
  ["c5", { title: "Garantía", content: "12 meses" }],
]);

describe("buildMessageCitations", () => {
  it("returns title and normalized excerpt", () => {
    expect(buildMessageCitations([{ chunkId: "c1" }], chunks)).toEqual([
      { chunkId: "c1", title: "Catálogo 2026", excerpt: "Limpieza dental desde $40" },
    ]);
  });
  it("drops missing chunks, duplicate chunks and repeated sources", () => {
    const out = buildMessageCitations([{ chunkId: "gone" }, { chunkId: "c1" }, { chunkId: "c1" }, { chunkId: "c2" }], chunks);
    expect(out.map((c) => c.chunkId)).toEqual(["c1"]);
  });
  it("truncates long excerpts", () => {
    const [c] = buildMessageCitations([{ chunkId: "c3" }], chunks);
    expect(c?.excerpt.length).toBe(MESSAGE_CITATION_EXCERPT_MAX);
    expect(c?.excerpt.endsWith("…")).toBe(true);
  });
  it("caps the number of citations", () => {
    const out = buildMessageCitations(["c1", "c3", "c4", "c5"].map((chunkId) => ({ chunkId })), chunks);
    expect(out.map((c) => c.chunkId)).toEqual(["c1", "c3", "c4"]);
  });
  it("returns [] when nothing was cited", () => {
    expect(buildMessageCitations([], chunks)).toEqual([]);
  });
});
