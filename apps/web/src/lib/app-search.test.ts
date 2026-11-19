import { describe, expect, it } from "vitest";
import { buildSearchIndex, editDistance, navHrefs, normalize, searchApp, suggestedEntries } from "./app-search";
import { contactsSearchHref, inboxConversationHref, inboxSearchHref, parseInboxDeepLink, remoteQuery, snippet } from "./app-search-helpers";

type Role = "owner" | "admin" | "agent" | "viewer";
const top = (q: string, role: Role = "owner") => searchApp(q, role)[0]?.entry.href;
const hrefs = (q: string, role: Role = "owner") => searchApp(q, role).map((r) => r.entry.href);

describe("normalize / editDistance", () => {
  it("strips accents and case", () => {
    expect(normalize("  Suscripción, QR! ")).toBe("suscripcion qr");
  });
  it("computes small distances and bails out", () => {
    expect(editDistance("suscripcion", "suscripsion", 2)).toBe(1);
    expect(editDistance("abc", "abcdefgh", 2)).toBeGreaterThan(2);
  });
});

describe("synonyms", () => {
  it.each([
    ["pagar", "/app/settings/billing"],
    ["cobro", "/app/settings/billing"],
    ["factura", "/app/settings/billing"],
    ["usdt", "/app/settings/billing"],
    ["qr", "/app/settings/billing"],
    ["api key", "/app/channels"],
    ["clave", "/app/channels"],
    ["credenciales", "/app/channels"],
    ["webhook", "/app/channels"],
    ["saldo", "/app/channels"],
    ["recargar", "/app/channels"],
    ["foto", "/app/settings/whatsapp-profile"],
    ["perfil", "/app/settings/whatsapp-profile"],
    ["nombre del negocio", "/app/settings/whatsapp-profile"],
    ["nombre de la empresa", "/app/settings/company"],
    ["empresa", "/app/settings/company"],
    ["ia", "/app/settings/ai"],
    ["bot", "/app/settings/ai"],
    ["respuestas cortas", "/app/settings/ai"],
    ["prompt", "/app/settings/ai"],
    ["simulador", "/app/settings/ai/simulator"],
    ["probar ia", "/app/settings/ai/simulator"],
    ["plantillas", "/app/templates"],
    ["cliente", "/app/contacts"],
    ["contacto", "/app/contacts"],
    ["lead", "/app/contacts"],
    ["chat", "/app/inbox"],
    ["inbox", "/app/inbox"],
    ["agenda", "/app/agenda"],
    ["cita", "/app/agenda"],
    ["presupuesto", "/app/quotes"],
    ["cotización", "/app/quotes"],
    ["pedido", "/app/orders"],
    ["campañas", "/app/broadcasts"],
    ["difusión", "/app/broadcasts"],
    ["equipo", "/app/team"],
    ["usuarios", "/app/team"],
    ["invitar", "/app/team"],
    ["límites", "/app/settings/plan"],
    ["uso", "/app/settings/plan"],
    ["plan", "/app/settings/plan"],
  ])("%s -> %s", (q, href) => {
    expect(hrefs(q)).toContain(href);
  });

  it("ranks the best match first for the headline examples", () => {
    expect(top("pagar")).toBe("/app/settings/billing");
    expect(top("api key")).toBe("/app/channels");
    expect(top("simulador")).toBe("/app/settings/ai/simulator");
    expect(top("mensaje")).toBe("/app/inbox");
  });
});

describe("accents and typos", () => {
  it("matches without accents", () => {
    expect(top("suscripcion")).toBe("/app/settings/billing");
  });
  it("tolerates a typo", () => {
    expect(top("suscripsion")).toBe("/app/settings/billing");
    expect(top("presupuestoo")).toBe("/app/quotes");
  });
  it("returns nothing for gibberish", () => {
    expect(searchApp("zzzzqx", "owner")).toEqual([]);
  });
});

describe("empty query", () => {
  it("returns no ranked results", () => {
    expect(searchApp("   ", "owner")).toEqual([]);
  });
  it("suggests recents first, deduped, then starters", () => {
    const s = suggestedEntries("owner", ["/app/orders", "/app/inbox"]).map((e) => e.href);
    expect(s.slice(0, 2)).toEqual(["/app/orders", "/app/inbox"]);
    expect(new Set(s).size).toBe(s.length);
    expect(s.length).toBeLessThanOrEqual(6);
  });
  it("ignores unknown recents", () => {
    expect(suggestedEntries("owner", ["/nope"])[0]?.href).toBe("/app/inbox");
  });
});

describe("role filtering", () => {
  it("hides admin-only sections from agents", () => {
    expect(hrefs("suscripcion", "agent")).not.toContain("/app/settings/billing");
    expect(hrefs("equipo", "agent")).not.toContain("/app/team");
    expect(hrefs("suscripcion", "admin")).toContain("/app/settings/billing");
  });
  it("hides AI sections from viewers but not from agents", () => {
    expect(hrefs("simulador", "viewer")).toEqual([]);
    expect(hrefs("simulador", "agent")).toContain("/app/settings/ai/simulator");
  });
  it("never suggests forbidden entries", () => {
    expect(suggestedEntries("viewer", ["/app/settings/billing"]).map((e) => e.href)).not.toContain("/app/settings/billing");
  });
});

describe("index", () => {
  it("covers every nav route with a description", () => {
    const index = buildSearchIndex();
    for (const h of navHrefs()) expect(index.some((e) => e.href === h)).toBe(true);
    for (const e of index) expect(e.description).not.toBe("");
  });
  it("has unique ids", () => {
    const ids = buildSearchIndex().map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("remote search helpers", () => {
  it("only queries from 2 characters, trimmed and capped", () => {
    expect(remoteQuery("a")).toBeNull();
    expect(remoteQuery("  a ")).toBeNull();
    expect(remoteQuery(" ab ")).toBe("ab");
    expect(remoteQuery("x".repeat(150))).toHaveLength(100);
  });
  it("builds deep links", () => {
    expect(inboxConversationHref("abc")).toBe("/app/inbox?conversation=abc");
    expect(inboxSearchHref(" hola mundo ")).toBe("/app/inbox?q=hola%20mundo");
    expect(contactsSearchHref("+54 9")).toBe("/app/contacts?q=%2B54%209");
  });
  it("parses the inbox deep link defensively", () => {
    const id = "44444444-4444-4444-8444-444444444444";
    expect(parseInboxDeepLink(`?conversation=${id}&q=%20hola%20`)).toEqual({ conversation: id, q: "hola" });
    expect(parseInboxDeepLink("?conversation=../etc").conversation).toBeNull();
    expect(parseInboxDeepLink("").q).toBe("");
    expect(parseInboxDeepLink(`?q=${"x".repeat(150)}`).q).toHaveLength(100);
  });
  it("shortens snippets", () => {
    expect(snippet("  hola\n  mundo ")).toBe("hola mundo");
    expect(snippet("x".repeat(100), 10)).toBe(`${"x".repeat(9)}…`);
    expect(snippet(null)).toBe("");
  });
});
