import type { MessageCitation } from "@crmwsp/contracts";

/** Max citation chips shown under one AI bubble. */
export const MESSAGE_CITATIONS_MAX = 3;
/** Max characters of the excerpt shown in the chip tooltip. */
export const MESSAGE_CITATION_EXCERPT_MAX = 240;

export interface CitationChunkInfo {
  title: string;
  content: string;
}

/**
 * Maps the chunk ids cited by an AI reply to display citations. Chunks that no longer exist
 * (deleted source) are dropped, and several chunks of the same source collapse into one chip.
 */
export function buildMessageCitations(
  cited: ReadonlyArray<{ chunkId: string }>,
  chunks: ReadonlyMap<string, CitationChunkInfo>,
  max: number = MESSAGE_CITATIONS_MAX,
): MessageCitation[] {
  const out: MessageCitation[] = [];
  const seenChunks = new Set<string>();
  const seenTitles = new Set<string>();
  for (const { chunkId } of cited) {
    if (out.length >= max) break;
    if (seenChunks.has(chunkId)) continue;
    seenChunks.add(chunkId);
    const info = chunks.get(chunkId);
    const title = info?.title.trim();
    if (!info || !title || seenTitles.has(title)) continue;
    seenTitles.add(title);
    const content = info.content.replace(/\s+/g, " ").trim();
    const excerpt =
      content.length > MESSAGE_CITATION_EXCERPT_MAX ? `${content.slice(0, MESSAGE_CITATION_EXCERPT_MAX - 1).trimEnd()}…` : content;
    out.push({ chunkId, title, excerpt });
  }
  return out;
}
