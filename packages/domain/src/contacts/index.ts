import { contactTagSchema, e164PhoneSchema, type CsvContactRow, type ImportSkipReason } from "@crmwsp/contracts";

/**
 * Normalizes a phone typed by a human into E.164: strips spaces, dashes, dots and parentheses,
 * turns a leading `00` into `+`, and adds `+` to bare digits. Returns undefined when invalid.
 */
export function normalizePhoneE164(raw: string): string | undefined {
  let p = raw.trim().replace(/[\s\-().]/g, "");
  if (p.startsWith("00")) p = `+${p.slice(2)}`;
  if (!p.startsWith("+")) p = `+${p}`;
  return e164PhoneSchema.safeParse(p).success ? p : undefined;
}

export interface PlannedImportRow {
  line: number;
  phoneE164: string;
  name: string | null;
  email: string | null;
  tags: string[];
  marketingConsent: "granted" | "revoked" | null;
}

export interface ContactImportPlan {
  rows: PlannedImportRow[];
  skipped: { line: number; reason: ImportSkipReason }[];
}

/** Validates and dedupes parsed CSV rows by normalized phone (first occurrence wins). */
export function planContactImport(rows: readonly CsvContactRow[]): ContactImportPlan {
  const seen = new Set<string>();
  const planned: PlannedImportRow[] = [];
  const skipped: ContactImportPlan["skipped"] = [];
  for (const r of rows) {
    if (!r.phone) {
      skipped.push({ line: r.line, reason: "missing_phone" });
      continue;
    }
    const phoneE164 = normalizePhoneE164(r.phone);
    if (!phoneE164) {
      skipped.push({ line: r.line, reason: "invalid_phone" });
      continue;
    }
    if (seen.has(phoneE164)) {
      skipped.push({ line: r.line, reason: "duplicate_in_file" });
      continue;
    }
    const tags = [...new Set(r.tags)];
    if (tags.length > 30 || !tags.every((t) => contactTagSchema.safeParse(t).success)) {
      skipped.push({ line: r.line, reason: "invalid_tags" });
      continue;
    }
    seen.add(phoneE164);
    planned.push({
      line: r.line,
      phoneE164,
      name: r.name.slice(0, 200) || null,
      email: r.email.slice(0, 200) || null,
      tags,
      marketingConsent: r.marketingConsent,
    });
  }
  return { rows: planned, skipped };
}

/** Merges tags keeping order and the 30-tag cap of the contact book. */
export function mergeTags(existing: readonly string[], added: readonly string[]): string[] {
  return [...new Set([...existing, ...added])].slice(0, 30);
}
