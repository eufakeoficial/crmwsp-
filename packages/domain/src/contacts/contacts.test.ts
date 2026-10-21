import { parseContactCsv } from "@crmwsp/contracts";
import { describe, expect, it } from "vitest";
import { mergeTags, normalizePhoneE164, planContactImport } from "./index.js";

describe("normalizePhoneE164", () => {
  it("accepts common human formats", () => {
    expect(normalizePhoneE164("+34 600-111 222")).toBe("+34600111222");
    expect(normalizePhoneE164("0034600111222")).toBe("+34600111222");
    expect(normalizePhoneE164("(591) 7000 0000")).toBe("+59170000000");
  });
  it("rejects garbage", () => {
    expect(normalizePhoneE164("abc")).toBeUndefined();
    expect(normalizePhoneE164("+0123")).toBeUndefined();
    expect(normalizePhoneE164("")).toBeUndefined();
  });
});

describe("planContactImport", () => {
  it("dedupes by normalized phone and reports reasons", () => {
    const csv = [
      "Teléfono;Nombre;Etiquetas;Acepta marketing",
      "+34 600 111 222;Ana;vip|cliente;sí",
      "0034600111222;Ana bis;;",
      ";Sin tel;;",
      "xyz;Malo;;",
      "+59170000000;Luis;;no",
    ].join("\n");
    const parsed = parseContactCsv(csv);
    expect(parsed.columns.marketingConsent).toBe(true);
    const plan = planContactImport(parsed.rows);
    expect(plan.rows.map((r) => [r.phoneE164, r.name, r.tags, r.marketingConsent])).toEqual([
      ["+34600111222", "Ana", ["vip", "cliente"], "granted"],
      ["+59170000000", "Luis", [], "revoked"],
    ]);
    expect(plan.skipped).toEqual([
      { line: 3, reason: "duplicate_in_file" },
      { line: 4, reason: "missing_phone" },
      { line: 5, reason: "invalid_phone" },
    ]);
  });

  it("never infers consent without an explicit column", () => {
    const plan = planContactImport(parseContactCsv("phone,name\n+34600111222,Ana\n").rows);
    expect(plan.rows[0]?.marketingConsent).toBeNull();
  });

  it("handles quoted fields with delimiters and quotes", () => {
    const parsed = parseContactCsv('phone,name,tags\n+34600111222,"Pérez, ""Ana""","a,b"\n');
    expect(parsed.rows[0]).toMatchObject({ name: 'Pérez, "Ana"', tags: ["a", "b"] });
  });
});

describe("mergeTags", () => {
  it("keeps order without duplicates", () => {
    expect(mergeTags(["a", "b"], ["b", "c"])).toEqual(["a", "b", "c"]);
  });
});
