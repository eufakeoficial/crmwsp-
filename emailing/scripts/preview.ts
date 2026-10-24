/**
 * Renders every template with its sample data into emailing/preview/.
 * Run: npx --yes tsx emailing/scripts/preview.ts   (from the repo root; no deps are added)
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { EMAIL_KEYS, sampleEmail, type EmailContext } from "../../packages/mailer/src/templates/index.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const out = join(root, "preview");
mkdirSync(out, { recursive: true });

// Previews load the logo from ../assets so they work offline; production uses https://www.vendemas.chat/brand.
const ctx: EmailContext = {
  siteUrl: "https://www.vendemas.chat",
  assetsUrl: "../assets",
  marketing: { manageUrl: "https://www.vendemas.chat/app/settings", unsubscribeUrl: "https://www.vendemas.chat/unsubscribe" },
};

const problems: string[] = [];
const rows: string[] = [];
for (const key of EMAIL_KEYS) {
  const email = sampleEmail(key, ctx);
  if (/undefined|\[object/.test(email.html + email.text)) problems.push(`${key}: contains undefined`);
  for (const [, href] of email.html.matchAll(/href="([^"]+)"/g)) {
    if (!/^https:\/\//.test(href ?? "")) problems.push(`${key}: non-https href ${href}`);
  }
  writeFileSync(join(out, `${key}.html`), email.html);
  writeFileSync(join(out, `${key}.txt`), `Asunto: ${email.subject}\nPreheader: ${email.preheader}\n\n${email.text}`);
  rows.push(`<li><a href="${key}.html">${key}</a> <small>(${email.kind}) &mdash; ${email.subject.replace(/</g, "&lt;")} &middot; <a href="${key}.txt">texto</a></small></li>`);
}
writeFileSync(
  join(out, "index.html"),
  `<!doctype html><meta charset="utf-8"><title>Previews Vende+ WSP</title><body style="font-family:Arial,sans-serif;max-width:760px;margin:24px auto;padding:0 16px"><h1>Previews de correos Vende+ WSP</h1><ul style="line-height:2">${rows.join("")}</ul></body>`,
);
console.log(`Rendered ${EMAIL_KEYS.length} templates to ${out}`);
if (problems.length) { console.error(problems.join("\n")); process.exit(1); }
