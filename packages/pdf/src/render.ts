import PDFDocument from "pdfkit";
import { labelsFor } from "./labels";
import { formatMoney } from "./money";
import { encodeQr } from "./qr";
import { computeQuoteTotals } from "./totals";
import { QuoteDocumentSchema, type QuoteDocument, type QuoteDocumentInput } from "./types";

const INK = "#121212";
const MUTED = "#6b6b6b";
const HAIRLINE = "#e4e4e4";
const PAGE_W = 595.28;
const PAGE_H = 841.89;
const MARGIN = 48;
const CONTENT_W = PAGE_W - MARGIN * 2;
const FOOTER_RESERVE = 64;
const BOTTOM = PAGE_H - FOOTER_RESERVE;
const TOP = 36;

// Characters Helvetica (WinAnsi) can show beyond Latin-1.
const WIN_ANSI_EXTRA = new Set("€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ");

/**
 * Standard PDF fonts only cover WinAnsi. Normalise exotic spaces and replace
 * unsupported characters so extraction and layout stay predictable.
 */
export function pdfSafe(input: string): string {
  let out = "";
  for (const ch of input.normalize("NFC").replace(/[\u00a0\u202f\u2009\u2007]/g, " ")) {
    const cp = ch.codePointAt(0) as number;
    if (ch === "\n" || (cp >= 0x20 && cp <= 0xff && cp !== 0x7f && !(cp >= 0x80 && cp < 0xa0)) || WIN_ANSI_EXTRA.has(ch)) {
      out += ch;
    } else if (cp < 0x20 || (cp >= 0x7f && cp < 0xa0)) {
      out += " ";
    } else {
      out += "?";
    }
  }
  return out;
}

function readableOn(hex: string): string {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255) as [number, number, number];
  const lin = (c: number) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  const lum = 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
  return lum > 0.4 ? INK : "#ffffff";
}

function collect(doc: PDFKit.PDFDocument): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const chunks: Uint8Array[] = [];
    doc.on("data", (c: Uint8Array) => chunks.push(c));
    doc.on("end", () => {
      const total = chunks.reduce((n, c) => n + c.length, 0);
      const out = new Uint8Array(total);
      let off = 0;
      for (const c of chunks) {
        out.set(c, off);
        off += c.length;
      }
      resolve(out);
    });
    doc.on("error", reject);
  });
}

/** Renders a quote to PDF bytes. Pure: no I/O besides the returned buffer. */
export async function renderQuotePdf(input: QuoteDocumentInput | QuoteDocument): Promise<Uint8Array> {
  const quote = QuoteDocumentSchema.parse(input);
  const L = labelsFor(quote.locale);
  const totals = computeQuoteTotals(quote.items);
  const brand = quote.brandColor;
  const onBrand = readableOn(brand);
  const money = (minor: number) => pdfSafe(formatMoney(minor, quote.currency, quote.locale));
  const numFmt = new Intl.NumberFormat(quote.locale, { maximumFractionDigits: 3 });
  const pctFmt = new Intl.NumberFormat(quote.locale, { maximumFractionDigits: 2 });
  const dateFmt = new Intl.DateTimeFormat(quote.locale, { dateStyle: "long", timeZone: "UTC" });
  const date = (iso: string) => pdfSafe(dateFmt.format(new Date(`${iso}T00:00:00Z`)));

  const doc = new PDFDocument({
    size: "A4",
    margins: { top: TOP, bottom: FOOTER_RESERVE, left: MARGIN, right: MARGIN },
    bufferPages: true,
    info: {
      Title: pdfSafe(`${L.quote} ${quote.number}`),
      Author: pdfSafe(quote.seller.name),
      Producer: "@crmwsp/pdf",
      CreationDate: new Date(`${quote.issueDate}T00:00:00Z`),
    },
  });
  const done = collect(doc);

  const chrome = () => {
    doc.save().rect(0, 0, PAGE_W, 8).fill(brand).restore();
  };
  chrome();
  doc.on("pageAdded", chrome);

  const font = (bold = false, size = 9, color = INK) => doc.font(bold ? "Helvetica-Bold" : "Helvetica").fontSize(size).fillColor(color);

  // ---- Header -----------------------------------------------------------
  let y = 34;
  const { seller, customer } = quote;
  let leftBottom = y;
  if (seller.logoPng) {
    doc.image(Buffer.from(seller.logoPng), MARGIN, y, { fit: [150, 48] });
    leftBottom = y + 52;
  } else {
    font(true, 18);
    doc.text(pdfSafe(seller.name), MARGIN, y, { width: CONTENT_W - 220 });
    leftBottom = doc.y;
  }

  const rightX = PAGE_W - MARGIN - 200;
  font(true, 8, MUTED).text(L.quote, rightX, y, { width: 200, align: "right", characterSpacing: 1.5 });
  font(true, 20).text(pdfSafe(quote.number), rightX, doc.y + 2, { width: 200, align: "right" });
  font(false, 9).text(`${L.issued}: ${date(quote.issueDate)}`, rightX, doc.y + 4, { width: 200, align: "right" });
  font(true, 9).text(`${L.validUntil}: ${date(quote.validUntil)}`, rightX, doc.y + 1, { width: 200, align: "right" });
  y = Math.max(leftBottom, doc.y) + 22;

  // ---- Parties ----------------------------------------------------------
  const colW = (CONTENT_W - 24) / 2;
  const party = (label: string, x: number, p: { name: string; taxId?: string | undefined; address?: string | undefined; phone?: string | undefined; email?: string | undefined }, showName: boolean) => {
    font(true, 8, MUTED).text(label, x, y, { width: colW, characterSpacing: 1.5 });
    if (showName) font(true, 11).text(pdfSafe(p.name), x, doc.y + 3, { width: colW });
    font(false, 9);
    const lines = [p.taxId ? `${L.taxId}: ${p.taxId}` : "", p.address ?? "", p.phone ?? "", p.email ?? ""].filter(Boolean);
    for (const line of lines) doc.text(pdfSafe(line), x, doc.y + 1, { width: colW });
    return doc.y;
  };
  const a = party(L.from, MARGIN, seller, true);
  const b = party(L.to, MARGIN + colW + 24, customer, true);
  y = Math.max(a, b) + 24;

  // ---- Items table --------------------------------------------------------
  const cw = { qty: 56, unit: 78, disc: 42, tax: 42, amt: 82 };
  const descW = CONTENT_W - cw.qty - cw.unit - cw.disc - cw.tax - cw.amt;
  const x0 = MARGIN;
  const xQty = x0 + descW;
  const xUnit = xQty + cw.qty;
  const xDisc = xUnit + cw.unit;
  const xTax = xDisc + cw.disc;
  const xAmt = xTax + cw.tax;
  const PAD = 6;

  const tableHeader = () => {
    doc.save().rect(x0, y, CONTENT_W, 22).fill(INK).restore();
    doc.save().rect(x0, y + 22, CONTENT_W, 2).fill(brand).restore();
    font(true, 8, "#ffffff");
    const ty = y + 7;
    doc.text(L.description, x0 + PAD, ty, { width: descW - PAD, lineBreak: false });
    doc.text(L.quantity, xQty, ty, { width: cw.qty - PAD, align: "right", lineBreak: false });
    doc.text(L.unitPrice, xUnit, ty, { width: cw.unit - PAD, align: "right", lineBreak: false });
    doc.text(L.discount, xDisc, ty, { width: cw.disc - PAD, align: "right", lineBreak: false });
    doc.text(L.tax, xTax, ty, { width: cw.tax - PAD, align: "right", lineBreak: false });
    doc.text(L.amount, xAmt, ty, { width: cw.amt - PAD, align: "right", lineBreak: false });
    y += 24;
  };
  const newPage = () => {
    doc.addPage();
    y = TOP;
  };

  tableHeader();
  quote.items.forEach((item, i) => {
    const line = totals.lines[i] as (typeof totals.lines)[number];
    font(false, 9);
    const desc = pdfSafe(item.description);
    const h = Math.max(doc.heightOfString(desc, { width: descW - PAD * 2 }), 11) + 12;
    if (y + h > BOTTOM) {
      newPage();
      tableHeader();
    }
    const ty = y + 6;
    font(false, 9).text(desc, x0 + PAD, ty, { width: descW - PAD * 2 });
    const qty = pdfSafe(`${numFmt.format(item.quantity)}${item.unit ? ` ${item.unit}` : ""}`);
    font(false, 9).text(qty, xQty, ty, { width: cw.qty - PAD, align: "right" });
    doc.text(money(item.unitPriceMinor), xUnit, ty, { width: cw.unit - PAD, align: "right" });
    font(false, 9, MUTED);
    doc.text(item.discountPercent ? `${pctFmt.format(item.discountPercent)} %` : "-", xDisc, ty, { width: cw.disc - PAD, align: "right" });
    doc.text(item.taxRatePercent !== undefined ? `${pctFmt.format(item.taxRatePercent)} %` : "-", xTax, ty, { width: cw.tax - PAD, align: "right" });
    font(true, 9).text(money(line.netMinor), xAmt, ty, { width: cw.amt - PAD, align: "right" });
    y += h;
    doc.save().moveTo(x0, y).lineTo(x0 + CONTENT_W, y).lineWidth(0.5).strokeColor(HAIRLINE).stroke().restore();
  });
  y += 14;

  // ---- Totals ---------------------------------------------------------------
  const rows: [string, string][] = [[L.subtotal, money(totals.subtotalMinor)]];
  if (totals.discountTotalMinor > 0) rows.push([L.discountTotal, `-${money(totals.discountTotalMinor)}`]);
  for (const t of totals.taxes) rows.push([`${L.taxLine} ${pctFmt.format(t.ratePercent)} %`, money(t.taxMinor)]);
  const boxW = 240;
  const boxX = PAGE_W - MARGIN - boxW;
  const totalsH = rows.length * 18 + 34;
  if (y + totalsH > BOTTOM) newPage();
  for (const [label, value] of rows) {
    font(false, 9.5, MUTED).text(label, boxX + PAD, y + 4, { width: boxW / 2, lineBreak: false });
    font(false, 9.5).text(value, boxX, y + 4, { width: boxW - PAD, align: "right", lineBreak: false });
    y += 18;
  }
  y += 4;
  doc.save().rect(boxX, y, boxW, 30).fill(brand).restore();
  font(true, 11, onBrand).text(L.total.toUpperCase(), boxX + 10, y + 9, { width: 80, lineBreak: false });
  font(true, 13, onBrand).text(money(totals.totalMinor), boxX, y + 8, { width: boxW - 10, align: "right", lineBreak: false });
  y += 30 + 24;

  // ---- Notes / terms ------------------------------------------------------------
  const block = (title: string, body: string) => {
    font(false, 9);
    const h = doc.heightOfString(pdfSafe(body), { width: CONTENT_W }) + 22;
    if (y + Math.min(h, 80) > BOTTOM) newPage();
    font(true, 8, MUTED).text(title.toUpperCase(), MARGIN, y, { width: CONTENT_W, characterSpacing: 1.5 });
    font(false, 9).text(pdfSafe(body), MARGIN, doc.y + 4, { width: CONTENT_W });
    y = doc.y + 18;
  };
  if (quote.notes) block(L.notes, quote.notes);
  if (quote.terms) block(L.terms, quote.terms);

  // ---- Payment link / QR ----------------------------------------------------------
  if (quote.paymentLink) {
    const qr = encodeQr(quote.paymentLink);
    const size = 96;
    if (y + size + 16 > BOTTOM) newPage();
    const cell = size / (qr.length + 8); // 4-module quiet zone on each side
    doc.save().roundedRect(MARGIN, y, size, size, 4).lineWidth(0.5).strokeColor(HAIRLINE).fillAndStroke("#ffffff", HAIRLINE).restore();
    doc.save().fillColor(INK);
    qr.forEach((row, r) =>
      row.forEach((dark, c) => {
        if (dark) doc.rect(MARGIN + (c + 4) * cell, y + (r + 4) * cell, cell + 0.15, cell + 0.15).fill();
      }),
    );
    doc.restore();
    const tx = MARGIN + size + 16;
    font(true, 11).text(L.payOnline, tx, y + 10, { width: CONTENT_W - size - 16 });
    font(false, 9, MUTED).text(L.payHint, tx, doc.y + 4, { width: CONTENT_W - size - 16 });
    font(false, 8.5, INK).text(quote.paymentLink, tx, doc.y + 6, {
      width: CONTENT_W - size - 16,
      link: quote.paymentLink,
      underline: true,
    });
    y += size + 16;
  }

  // ---- Footer on every page ------------------------------------------------------------
  const range = doc.bufferedPageRange();
  for (let i = 0; i < range.count; i++) {
    doc.switchToPage(range.start + i);
    const prev = doc.page.margins.bottom;
    doc.page.margins.bottom = 0; // allow drawing inside the reserved footer area
    const fy = PAGE_H - 40;
    doc.save().moveTo(MARGIN, fy - 8).lineTo(PAGE_W - MARGIN, fy - 8).lineWidth(0.5).strokeColor(HAIRLINE).stroke().restore();
    font(false, 8, MUTED).text(pdfSafe(`${seller.name} · ${quote.number}`), MARGIN, fy, { width: CONTENT_W - 120, lineBreak: false });
    doc.text(L.page(i + 1, range.count), PAGE_W - MARGIN - 120, fy, { width: 120, align: "right", lineBreak: false });
    doc.page.margins.bottom = prev;
  }

  doc.end();
  return done;
}
