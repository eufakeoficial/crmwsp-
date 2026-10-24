import { describe, expect, it } from "vitest";
import {
  autoMailReason,
  buildReferences,
  headerMap,
  htmlToText,
  normalizeSubject,
  parseAddress,
  parseMessageIds,
  replySubject,
  sanitizeEmailHtml,
  ticketNumberFromSubject,
} from "./index.js";

describe("parseAddress", () => {
  it("parses display names and bare addresses", () => {
    expect(parseAddress('"Ana Pérez" <Ana@Example.com>')).toEqual({ email: "ana@example.com", name: "Ana Pérez" });
    expect(parseAddress("bob@example.org")).toEqual({ email: "bob@example.org", name: null });
  });
  it("rejects garbage and header injection", () => {
    expect(parseAddress("not an email")).toBeNull();
    expect(parseAddress("a@b.c\r\nBcc: x@y.z")).toBeNull();
    expect(parseAddress(null)).toBeNull();
  });
});

describe("subjects and tokens", () => {
  it("normalizes reply prefixes and the ticket token", () => {
    expect(normalizeSubject("RE: Fwd: Re:  Hola   Mundo [Ticket #42]")).toBe("hola mundo");
    expect(normalizeSubject("RV: Consulta")).toBe("consulta");
  });
  it("reads the ticket number token", () => {
    expect(ticketNumberFromSubject("Re: algo [Ticket #123]")).toBe(123);
    expect(ticketNumberFromSubject("[#7] x")).toBe(7);
    expect(ticketNumberFromSubject("sin token")).toBeNull();
  });
  it("builds a reply subject with a single token", () => {
    expect(replySubject("Consulta [Ticket #9]", 9)).toBe("Re: Consulta [Ticket #9]");
    expect(replySubject("Re: Consulta", 9)).toBe("Re: Consulta [Ticket #9]");
  });
});

describe("message ids", () => {
  it("extracts unique ids from headers", () => {
    expect(parseMessageIds("<a@x> <b@y>\r\n <a@x>")).toEqual(["<a@x>", "<b@y>"]);
    expect(parseMessageIds(null)).toEqual([]);
  });
  it("builds references with the replied id last", () => {
    expect(buildReferences(["<a@x>"], "<b@y>")).toEqual(["<a@x>", "<b@y>"]);
    expect(buildReferences(["<a@x>"], "<a@x>")).toEqual(["<a@x>"]);
  });
});

describe("autoMailReason", () => {
  const h = (o: Record<string, string>) => headerMap(o);
  it("flags auto-replies, bulk, bounces and lists", () => {
    expect(autoMailReason(h({ "Auto-Submitted": "auto-replied" }), "a@b.co")).toBe("auto_submitted");
    expect(autoMailReason(h({ Precedence: "bulk" }), "a@b.co")).toBe("precedence");
    expect(autoMailReason(h({}), "MAILER-DAEMON@b.co".toLowerCase())).toBe("bounce");
    expect(autoMailReason(h({ "List-Id": "x" }), "a@b.co")).toBe("list");
  });
  it("accepts normal human mail", () => {
    expect(autoMailReason(h({ "Auto-Submitted": "no" }), "ana@b.co")).toBeNull();
  });
  it("accepts the array header shape", () => {
    expect(autoMailReason(headerMap([{ name: "Auto-Submitted", value: "auto-generated" }]), "a@b.co")).toBe("auto_submitted");
  });
});

describe("sanitizeEmailHtml", () => {
  it("removes scripts, handlers and javascript: links", () => {
    const out = sanitizeEmailHtml('<p onclick="x()">Hola</p><script>alert(1)</script><a href="javascript:alert(1)">x</a><a href="JaVa&#115;cript:alert(1)">y</a>');
    expect(out).not.toMatch(/script|onclick|javascript/i);
    expect(out).toContain("<p>Hola</p>");
  });
  it("blocks remote images (trackers) but keeps inline cid/data images", () => {
    const out = sanitizeEmailHtml('<img src="https://t.example/pixel.gif"><img src="cid:logo"><img src="data:image/png;base64,AAAA">');
    expect(out).not.toContain("t.example");
    expect(out).toContain('src="cid:logo"');
    expect(out).toContain('src="data:image/png;base64,AAAA"');
  });
  it("drops iframes, forms, styles with url() and base/meta tags", () => {
    const out = sanitizeEmailHtml('<base href="https://evil"><meta http-equiv="refresh" content="0;url=https://evil"><iframe src="https://evil"></iframe><form action="https://evil"><input></form><div style="background:url(https://t/x)">a</div><style>body{}</style>');
    expect(out).not.toMatch(/evil|iframe|form|input|url\(|<style|<base|<meta/i);
  });
  it("keeps safe links with noopener", () => {
    expect(sanitizeEmailHtml('<a href="https://vendemas.chat">v</a>')).toContain('rel="noopener noreferrer nofollow"');
  });
  it("converts html to text", () => {
    expect(htmlToText("<p>Hola&nbsp;<b>Ana</b></p><p>chau</p>")).toBe("Hola Ana\nchau");
  });
});
