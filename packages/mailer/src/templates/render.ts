import { layout } from "./blocks.js";
import { EMAIL_TEMPLATES, type EmailContext, type EmailData, type EmailKey, type EmailKind } from "./templates.js";

export interface RenderedEmail {
  key: EmailKey;
  kind: EmailKind;
  subject: string;
  preheader: string;
  html: string;
  text: string;
  /** RFC 8058 one-click unsubscribe, only for optional emails. */
  headers: Record<string, string>;
}

export function renderTemplate<K extends EmailKey>(key: K, data: EmailData<K>, ctx: EmailContext): RenderedEmail {
  const template = EMAIL_TEMPLATES[key] as unknown as {
    kind: EmailKind;
    build: (d: EmailData<K>, c: EmailContext) => { subject: string; preheader: string; blocks: Parameters<typeof layout>[0]["blocks"] };
  };
  if (template.kind === "optional" && !ctx.marketing) throw new Error(`Email "${key}" needs preference and unsubscribe links`);
  const built = template.build(data, ctx);
  const marketing = template.kind === "optional" ? ctx.marketing : undefined;
  const { html, text } = layout({ ...built, assetsUrl: ctx.assetsUrl, siteUrl: ctx.siteUrl, marketing });
  return {
    key, kind: template.kind, subject: built.subject, preheader: built.preheader, html, text,
    headers: marketing ? { "List-Unsubscribe": `<${marketing.unsubscribeUrl}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" } : {},
  };
}

export function sampleEmail(key: EmailKey, ctx: EmailContext): RenderedEmail {
  return renderTemplate(key, EMAIL_TEMPLATES[key].sample as EmailData<typeof key>, ctx);
}

export const EMAIL_KEYS = Object.keys(EMAIL_TEMPLATES) as EmailKey[];
