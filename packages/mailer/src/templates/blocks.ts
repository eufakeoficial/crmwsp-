/**
 * Email building blocks for Vende+ WSP.
 * Ported from the sibling directory project's block kit (table layout, inline styles,
 * Outlook fallbacks, escaped dynamic strings) and re-skinned with the CRMWSP tokens
 * from apps/web/src/app/globals.css (navy / royal / azure + lime accent).
 */

export const BRAND = {
  name: "Vende+ WSP",
  siteUrl: "https://www.vendemas.chat",
  from: "Vende+ WSP <no-responder@vendemas.chat>",
  noReply: "no-responder@vendemas.chat",
} as const;

export const C = {
  navy: "#050a3a",
  royal: "#0a1696",
  azure: "#1233d8",
  royalSoft: "#e8ecfd",
  lime: "#d2f34c",
  limeSoft: "#eef9c4",
  ink: "#121212",
  muted: "#5c5c57",
  line: "#e4e4df",
  paper: "#f2f2ef",
  success: "#14663a",
  successSoft: "#e3f5ea",
  warning: "#8a4b00",
  warningSoft: "#fff1d6",
  danger: "#b02a24",
  dangerSoft: "#fde7e5",
} as const;

export type RichPart = string | { b: string } | { a: string; href: string };
export type Rich = string | readonly RichPart[];
export interface Block { html: string; text: string }

/** Web font first (progressive), email-safe fallbacks after. */
const F = "font-family:'Plus Jakarta Sans',Arial,Helvetica,sans-serif";
const TABLE = 'role="presentation" cellpadding="0" cellspacing="0" border="0"';
const FULL = 'role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"';

export function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** Only absolute http(s) URLs reach an href. */
export function safeUrl(value: string): string {
  const url = new URL(value);
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error("Email links must be http(s)");
  return escapeHtml(value);
}

function richHtml(value: Rich): string {
  const parts = typeof value === "string" ? [value] : value;
  return parts
    .map((p) =>
      typeof p === "string" ? escapeHtml(p)
        : "b" in p ? `<b>${escapeHtml(p.b)}</b>`
          : `<a class="lnk" href="${safeUrl(p.href)}" style="color:${C.azure};font-weight:bold">${escapeHtml(p.a)}</a>`,
    )
    .join("");
}

export function richText(value: Rich): string {
  const parts = typeof value === "string" ? [value] : value;
  return parts.map((p) => (typeof p === "string" ? p : "b" in p ? p.b : `${p.a} (${p.href})`)).join("");
}

const PILL_TONES = {
  lime: [C.lime, C.navy],
  blue: [C.royalSoft, C.royal],
  green: [C.successSoft, C.success],
  amber: [C.warningSoft, C.warning],
  red: [C.dangerSoft, C.danger],
} as const;
export type PillTone = keyof typeof PILL_TONES;

export function pill(label: string, tone: PillTone = "blue"): Block {
  const [bg, fg] = PILL_TONES[tone];
  return {
    html: `<tr><td class="px" style="padding:28px 36px 4px 36px"><table ${TABLE}><tr><td bgcolor="${bg}" style="background:${bg};border-radius:999px;padding:5px 12px;${F};font-size:12px;font-weight:bold;color:${fg}">${escapeHtml(label)}</td></tr></table></td></tr>`,
    text: `[${label}]`,
  };
}

export function title(value: string): Block {
  return {
    html: `<tr><td class="px t-ink" style="padding:8px 36px 12px 36px;${F};font-size:26px;line-height:32px;mso-line-height-rule:exactly;font-weight:bold;color:${C.navy}"><h1 style="margin:0;font-size:26px;line-height:32px;font-weight:bold;color:inherit">${escapeHtml(value)}</h1></td></tr>`,
    text: value.toUpperCase(),
  };
}

export function paragraph(value: Rich): Block {
  return {
    html: `<tr><td class="px t-ink" style="padding:0 36px 16px 36px;${F};font-size:16px;line-height:25px;mso-line-height-rule:exactly;color:${C.ink}">${richHtml(value)}</td></tr>`,
    text: richText(value),
  };
}

export function note(value: Rich): Block {
  return {
    html: `<tr><td class="px t-muted" style="padding:0 36px 28px 36px;${F};font-size:13px;line-height:20px;color:${C.muted}">${richHtml(value)}</td></tr>`,
    text: richText(value),
  };
}

export function code(value: string): Block {
  return {
    html: `<tr><td class="px" style="padding:4px 36px 20px 36px"><table ${FULL}><tr><td class="bg-panel t-ink" bgcolor="${C.royalSoft}" style="background:${C.royalSoft};border-radius:14px;padding:18px;text-align:center;font-family:'Courier New',monospace;font-size:32px;letter-spacing:8px;font-weight:bold;color:${C.navy}">${escapeHtml(value)}</td></tr></table></td></tr>`,
    text: value,
  };
}

export type Row = readonly [label: string, value: string];

export function facts(rows: readonly Row[]): Block {
  const last = rows.length - 1;
  const cells = rows
    .map(([label, value], i) => {
      const pad = `padding:${i === 0 ? 14 : 8}px 16px ${i === last ? 14 : 8}px 16px`;
      return `<tr><td class="t-muted" style="${pad};${F};font-size:14px;color:${C.muted}">${escapeHtml(label)}</td><td class="t-ink" align="right" style="${pad};${F};font-size:15px;font-weight:bold;color:${C.ink}">${escapeHtml(value)}</td></tr>`;
    })
    .join("");
  return {
    html: `<tr><td class="px" style="padding:0 36px 20px 36px"><table ${FULL} class="bg-panel" bgcolor="${C.paper}" style="background:${C.paper};border-radius:14px">${cells}</table></td></tr>`,
    text: rows.map(([l, v]) => `${l}: ${v}`).join("\n"),
  };
}

export function checks(items: readonly Rich[]): Block {
  const html = items
    .map((item) => `<table ${FULL}><tr><td width="28" valign="top" style="${F};font-size:16px;line-height:25px;color:${C.success};font-weight:bold">&#10003;</td><td class="t-ink" style="${F};font-size:16px;line-height:25px;color:${C.ink};padding-bottom:6px">${richHtml(item)}</td></tr></table>`)
    .join("");
  return {
    html: `<tr><td class="px" style="padding:0 36px 16px 36px">${html}</td></tr>`,
    text: items.map((i) => `- ${richText(i)}`).join("\n"),
  };
}

const BUTTONS = {
  primary: [C.azure, "#ffffff"],
  /** Lime only where contrast is AA: navy text on lime (14:1). */
  lime: [C.lime, C.navy],
  danger: [C.danger, "#ffffff"],
} as const;
export type ButtonTone = keyof typeof BUTTONS;

/** Bulletproof button: the colour lives on the <td> (works with images blocked and in Outlook). */
export function button(label: string, href: string, tone: ButtonTone = "primary"): Block {
  const [bg, fg] = BUTTONS[tone];
  const cls = tone === "primary" ? "btn" : "";
  const clsA = tone === "primary" ? "btn-a" : "";
  return {
    html: `<tr><td class="px" style="padding:8px 36px 28px 36px"><table ${TABLE}><tr><td class="${cls}" bgcolor="${bg}" style="border-radius:10px;background:${bg};mso-padding-alt:15px 30px"><a href="${safeUrl(href)}" target="_blank" class="${clsA}" style="display:inline-block;padding:15px 30px;${F};font-size:16px;font-weight:bold;color:${fg};text-decoration:none;border-radius:10px;line-height:20px">${escapeHtml(label)}</a></td></tr></table></td></tr>`,
    text: `${label}: ${href}`,
  };
}

const CALLOUTS = {
  info: [C.royalSoft, C.royal],
  tip: [C.limeSoft, C.navy],
  warn: [C.warningSoft, C.warning],
  danger: [C.dangerSoft, C.danger],
} as const;
export type CalloutTone = keyof typeof CALLOUTS;

export function callout(value: Rich, tone: CalloutTone = "info"): Block {
  const [bg, fg] = CALLOUTS[tone];
  return {
    html: `<tr><td class="px" style="padding:0 36px 20px 36px"><table ${FULL}><tr><td class="bg-panel t-ink" bgcolor="${bg}" style="background:${bg};border-radius:12px;border-left:4px solid ${tone === "tip" ? "#9fc41a" : fg};padding:14px 16px;${F};font-size:15px;line-height:22px;color:${fg}">${richHtml(value)}</td></tr></table></td></tr>`,
    text: richText(value),
  };
}

/** Highlighted figure: navy tile with a lime number (AA on navy). */
export function stat(value: string, label: string): Block {
  return {
    html: `<tr><td class="px" style="padding:0 36px 20px 36px"><table ${FULL}><tr><td bgcolor="${C.navy}" style="background:${C.navy};background-image:linear-gradient(135deg,${C.navy},${C.royal});border-radius:14px;padding:18px 20px;${F}"><div style="font-size:32px;line-height:38px;font-weight:bold;color:${C.lime}">${escapeHtml(value)}</div><div style="font-size:14px;color:#dfe4ff">${escapeHtml(label)}</div></td></tr></table></td></tr>`,
    text: `${label}: ${value}`,
  };
}

/** Quoted excerpt (ticket replies). */
export function quote(who: string, body: string): Block {
  return {
    html: `<tr><td class="px" style="padding:0 36px 20px 36px"><table ${FULL}><tr><td class="bd" style="border-left:4px solid ${C.azure};padding:4px 0 4px 16px;${F}"><div class="t-muted" style="font-size:13px;font-weight:bold;color:${C.muted};padding-bottom:4px">${escapeHtml(who)}</div><div class="t-ink" style="font-size:15px;line-height:23px;color:${C.ink}">${escapeHtml(body).replace(/\n/g, "<br>")}</div></td></tr></table></td></tr>`,
    text: `${who}:\n> ${body.replace(/\n/g, "\n> ")}`,
  };
}

// -- Layout ------------------------------------------------------------------------------

export interface MarketingLinks { manageUrl: string; unsubscribeUrl: string }

export interface LayoutInput {
  subject: string;
  preheader: string;
  blocks: readonly Block[];
  /** Base URL where logo-on-dark.png is served (https://www.vendemas.chat/brand in production). */
  assetsUrl: string;
  siteUrl: string;
  /** Present only for emails the recipient can opt out of. */
  marketing?: MarketingLinks | undefined;
}

const HIDDEN_FILL = "&#8199;&#65279;&#847;".repeat(4);

export function layout(input: LayoutInput): { html: string; text: string } {
  const brand = escapeHtml(BRAND.name);
  const logo = `${input.assetsUrl.replace(/\/$/, "")}/logo-on-dark.png`;
  const reason = input.marketing
    ? `Recibes este correo porque tienes una cuenta en ${brand}. <a class="lnk-f" href="${safeUrl(input.marketing.manageUrl)}" style="color:${C.muted}">Elegir qué avisos recibo</a> &middot; <a class="lnk-f" href="${safeUrl(input.marketing.unsubscribeUrl)}" style="color:${C.muted}">Darme de baja de estos avisos</a>`
    : `Este es un correo de servicio sobre tu cuenta en ${brand}.`;
  const html = `<!DOCTYPE html>
<html lang="es" xmlns="http://www.w3.org/1999/xhtml" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="X-UA-Compatible" content="IE=edge">
<meta name="x-apple-disable-message-reformatting">
<meta name="format-detection" content="telephone=no,address=no,email=no,date=no">
<meta name="color-scheme" content="light dark">
<meta name="supported-color-schemes" content="light dark">
<title>${escapeHtml(input.subject)}</title>
<!--[if mso]><noscript><xml><o:OfficeDocumentSettings><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml></noscript><style>table,td,a{font-family:Arial,Helvetica,sans-serif!important}</style><![endif]-->
<link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;700&display=swap" rel="stylesheet">
<style>
body{margin:0;padding:0;-webkit-text-size-adjust:100%;-ms-text-size-adjust:100%}
table{border-collapse:collapse}
img{border:0;outline:none;text-decoration:none;-ms-interpolation-mode:bicubic}
a{text-underline-offset:3px}
@media (max-width:620px){.w{width:100%!important}.px{padding-left:22px!important;padding-right:22px!important}}
@media (prefers-color-scheme:dark){
.bg-body{background:#03062a!important}
.bg-card{background:#0d1244!important}
.bg-panel{background:#1a2160!important}
.t-ink,.t-ink *{color:#f2f2ef!important}
.t-muted{color:#b9bedf!important}
.lnk{color:#9db0ff!important}
.lnk-f{color:#b9bedf!important}
.btn{background:${C.lime}!important}
.btn-a{color:${C.navy}!important}
.bd{border-color:#9db0ff!important}
}
[data-ogsc] .bg-card{background:#0d1244!important}
</style>
</head>
<body class="bg-body" style="margin:0;padding:0;background:${C.paper}">
<div style="display:none!important;visibility:hidden;opacity:0;color:transparent;height:0;width:0;overflow:hidden;mso-hide:all;font-size:1px;line-height:1px">${escapeHtml(input.preheader)}${HIDDEN_FILL}</div>
<table ${FULL} class="bg-body" bgcolor="${C.paper}" style="background:${C.paper}">
<tr><td align="center" style="padding:24px 12px">
<table ${TABLE} class="w" width="600" style="width:600px;max-width:600px">
<tr><td class="px" bgcolor="${C.navy}" style="background:${C.navy};background-image:linear-gradient(135deg,${C.navy} 0%,${C.royal} 100%);border-radius:20px 20px 0 0;padding:26px 36px 22px 36px">
<a href="${safeUrl(input.siteUrl)}" target="_blank"><img src="${escapeHtml(logo)}" width="150" alt="${brand}" style="display:block;width:150px;max-width:150px;height:auto;border:0;${F};font-size:20px;font-weight:bold;color:#ffffff"></a>
</td></tr>
<tr><td bgcolor="${C.lime}" style="background:${C.lime};height:4px;line-height:4px;font-size:0">&nbsp;</td></tr>
<tr><td class="bg-card" bgcolor="#ffffff" style="background:#ffffff;border-radius:0 0 20px 20px">
<table ${FULL}>
${input.blocks.map((b) => b.html).join("\n")}
</table>
</td></tr>
<tr><td class="t-muted" style="padding:20px 8px 0 8px;${F};font-size:12px;line-height:18px;color:${C.muted};text-align:center">
${brand} &middot; <a class="lnk-f" href="${safeUrl(input.siteUrl)}" style="color:${C.muted}">${escapeHtml(input.siteUrl.replace(/^https?:\/\//, ""))}</a><br>
${reason}<br>
Este mensaje se envía desde una dirección que no recibe respuestas (${escapeHtml(BRAND.noReply)}).
</td></tr>
</table>
</td></tr>
</table>
</body>
</html>`;
  const footer = [
    `${BRAND.name} · ${input.siteUrl}`,
    input.marketing
      ? `Elegir qué avisos recibo: ${input.marketing.manageUrl}\nDarme de baja de estos avisos: ${input.marketing.unsubscribeUrl}`
      : `Este es un correo de servicio sobre tu cuenta en ${BRAND.name}.`,
    `Este mensaje se envía desde una dirección que no recibe respuestas (${BRAND.noReply}).`,
  ].join("\n");
  const text = `${BRAND.name}\n\n${input.blocks.map((b) => b.text).join("\n\n")}\n\n—\n${footer}\n`;
  return { html, text };
}
