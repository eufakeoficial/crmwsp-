import { describe, expect, it } from "vitest";
import { POLICY_SOURCES, diffPolicyText, normalizePolicyText } from "./policy-text.js";

describe("normalizePolicyText", () => {
  it("strips scripts, styles, tags and entities; collapses spaces; keeps line structure", () => {
    const html = `<html><head><style>p{}</style><script>var t=Date.now()</script></head>
<body><h1>Política&nbsp;de   mensajes</h1><p>Solo con <b>opt-in</b> &amp; baja.</p><br><p>Fin</p></body></html>`;
    expect(normalizePolicyText(html, "text/html")).toBe("Política de mensajes\nSolo con opt-in & baja.\nFin");
  });

  it("ignores volatile noise so equal content hashes equally", () => {
    const a = normalizePolicyText("# Título\r\n\r\nTexto   uno \n<!-- build 123 -->\n", "text/markdown");
    const b = normalizePolicyText("# Título\n\nTexto uno\n<!-- build 999 -->", "text/markdown");
    expect(a).toBe(b);
  });
});

describe("diffPolicyText", () => {
  it("lists added and removed lines", () => {
    const d = diffPolicyText("a\nb\nc", "a\nB\nc\nd");
    expect(d.added).toEqual(["B", "d"]);
    expect(d.removed).toEqual(["b"]);
    expect(d.summary).toContain("+ B");
    expect(d.summary).toContain("- b");
  });

  it("caps the summary size", () => {
    const next = Array.from({ length: 500 }, (_, i) => `line ${i}`).join("\n");
    const d = diffPolicyText("", next, 20);
    expect(d.added.length).toBe(500);
    expect(d.summary.split("\n").length).toBeLessThanOrEqual(22);
    expect(d.summary).toContain("480 más");
  });

  it("reports no change for identical text", () => {
    expect(diffPolicyText("x\ny", "x\ny")).toEqual({ added: [], removed: [], summary: "" });
  });
});

describe("POLICY_SOURCES", () => {
  it("only lists official https sources and avoids facebook.com/legal scraping", () => {
    for (const s of POLICY_SOURCES) {
      expect(s.url.startsWith("https://")).toBe(true);
      expect(new URL(s.url).hostname).toMatch(/^(developers\.facebook\.com|whatsappbusiness\.com)$/);
    }
    expect(new Set(POLICY_SOURCES.map((s) => s.key)).size).toBe(POLICY_SOURCES.length);
  });
});
