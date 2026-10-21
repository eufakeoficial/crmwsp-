/**
 * Dev-only demo data seed (Spanish, LatAm).
 *
 * Usage: pnpm --filter @crmwsp/db db:seed-demo [tenant-slug]   (default: dev-tenant)
 *
 * - All writes run inside withTenant() with the app role (DATABASE_URL), so RLS applies.
 * - The tenant slug is resolved to an id with DATABASE_URL_MIGRATOR (read-only lookup), because
 *   the app role cannot see the tenants table without an app.tenant_id. Or set DEMO_TENANT_ID.
 * - Idempotent: every demo row is marked (contacts/products tag `demo`, `DEMO-` document numbers,
 *   `demo:` notification keys, `[demo]` knowledge title). A re-run removes the previous demo rows
 *   and inserts them again, so counts never grow.
 * - Refuses to run when NODE_ENV=production.
 */
import { randomBytes } from "node:crypto";
import { and, eq, like, sql } from "drizzle-orm";
import postgres from "postgres";
import { createDb } from "../src/client.js";
import {
  channelConnections,
  consents,
  contacts,
  conversations,
  knowledgeChunks,
  knowledgeSources,
  messages,
  notifications,
  orderItems,
  orders,
  payments,
  productVariants,
  products,
  quoteItems,
  quotes,
} from "../src/schema/index.js";
import { withTenant } from "../src/with-tenant.js";

const DEMO_TAG = "demo";
const CURRENCY = "MXN";
const DAY = 86_400_000;

if (process.env.NODE_ENV === "production") {
  console.error("seed-demo: refusing to run with NODE_ENV=production");
  process.exit(1);
}

const slug = process.argv[2] ?? "dev-tenant";
const appUrl = process.env.DATABASE_URL;
if (!appUrl) {
  console.error("seed-demo: DATABASE_URL is not set");
  process.exit(1);
}

async function resolveTenantId(): Promise<string> {
  if (process.env.DEMO_TENANT_ID) return process.env.DEMO_TENANT_ID;
  const adminUrl = process.env.DATABASE_URL_MIGRATOR;
  if (!adminUrl) throw new Error("set DATABASE_URL_MIGRATOR (slug lookup) or DEMO_TENANT_ID");
  const admin = postgres(adminUrl, { max: 1, onnotice: () => {} });
  try {
    const rows = await admin`select id from tenants where slug = ${slug}`;
    const id = rows[0]?.id as string | undefined;
    if (!id) throw new Error(`tenant "${slug}" not found`);
    return id;
  } finally {
    await admin.end({ timeout: 5 });
  }
}

const NAMES = [
  "María Fernanda López", "Juan Carlos Ramírez", "Camila Rojas", "Santiago Herrera", "Valentina Torres",
  "Mateo Gutiérrez", "Sofía Vargas", "Diego Castillo", "Lucía Mendoza", "Andrés Morales",
  "Paula Jiménez", "Sebastián Ortiz", "Daniela Silva", "Nicolás Peña", "Isabella Cruz",
  "Felipe Navarro", "Mariana Cárdenas", "Alejandro Ríos", "Carolina Salazar", "Ricardo Medina",
  "Gabriela Fuentes", "Tomás Aguilar", "Natalia Paredes", "Emilio Vega", "Renata Campos",
];
const TAG_SETS = [["vip"], ["lead"], ["cliente"], ["lead", "campaña-octubre"], ["cliente", "recurrente"], ["mayorista"]];

const PRODUCTS: {
  name: string;
  category: string;
  kind: "physical" | "service";
  price: number;
  variants: [string, Record<string, string>, number | null][];
}[] = [
  { name: "Camiseta algodón premium", category: "Ropa", kind: "physical", price: 29900, variants: [["S", { talla: "S" }, null], ["M", { talla: "M" }, null], ["L", { talla: "L" }, 31900]] },
  { name: "Sudadera con capucha", category: "Ropa", kind: "physical", price: 59900, variants: [["Gris-M", { color: "Gris", talla: "M" }, null], ["Negro-M", { color: "Negro", talla: "M" }, null]] },
  { name: "Gorra bordada", category: "Accesorios", kind: "physical", price: 19900, variants: [["Única", {}, null]] },
  { name: "Mochila urbana 20L", category: "Accesorios", kind: "physical", price: 89900, variants: [["Azul", { color: "Azul" }, null], ["Negro", { color: "Negro" }, null]] },
  { name: "Taza cerámica personalizada", category: "Hogar", kind: "physical", price: 14900, variants: [["Estándar", {}, null]] },
  { name: "Botella térmica 750ml", category: "Hogar", kind: "physical", price: 34900, variants: [["Acero", { color: "Acero" }, null], ["Verde", { color: "Verde" }, null]] },
  { name: "Diseño de logotipo", category: "Servicios", kind: "service", price: 450000, variants: [["Estándar", {}, null]] },
  { name: "Sesión fotográfica de producto", category: "Servicios", kind: "service", price: 280000, variants: [["Media jornada", { duración: "4h" }, null], ["Jornada completa", { duración: "8h" }, 520000]] },
  { name: "Instalación y mantenimiento", category: "Servicios", kind: "service", price: 180000, variants: [["Visita", {}, null]] },
  { name: "Asesoría de marketing (1h)", category: "Servicios", kind: "service", price: 95000, variants: [["1 hora", {}, null]] },
];

const CHATS: { dir: "in" | "out"; text: string }[][] = [
  [{ dir: "in", text: "Hola, buenas tardes. ¿Tienen camisetas en talla M?" }, { dir: "out", text: "¡Hola! Sí, tenemos la camiseta de algodón premium en talla M, $299 MXN." }, { dir: "in", text: "Perfecto, ¿hacen envíos a Guadalajara?" }, { dir: "out", text: "Claro, el envío tarda de 3 a 5 días hábiles." }],
  [{ dir: "in", text: "Buen día, necesito cotización para un logotipo." }, { dir: "out", text: "Con gusto. ¿Para qué tipo de negocio sería?" }, { dir: "in", text: "Una cafetería pequeña en Bogotá." }],
  [{ dir: "in", text: "¿Cuánto cuesta la sesión fotográfica?" }, { dir: "out", text: "Media jornada $2,800 MXN y jornada completa $5,200 MXN." }, { dir: "in", text: "Me interesa la de media jornada, ¿tienen fecha para el viernes?" }],
  [{ dir: "in", text: "Hola, ya hice la transferencia de mi pedido." }, { dir: "out", text: "¡Gracias! La estamos validando y te confirmamos en breve." }],
  [{ dir: "in", text: "¿Tienen la mochila en color azul?" }, { dir: "out", text: "Sí, quedan unidades. ¿Te preparo el pedido?" }, { dir: "in", text: "Sí por favor, mándame los datos de pago." }],
  [{ dir: "in", text: "Buenas, quisiera precios al por mayor de tazas personalizadas." }, { dir: "out", text: "Claro. ¿Qué cantidad necesitas aproximadamente?" }, { dir: "in", text: "Unas 100 piezas para un evento." }],
  [{ dir: "in", text: "Hola, ¿pueden pasar a hacer mantenimiento esta semana?" }, { dir: "out", text: "Hola, tenemos disponibilidad el jueves por la mañana. ¿Te sirve?" }],
  [{ dir: "in", text: "Gracias por la atención, todo llegó perfecto." }, { dir: "out", text: "¡Qué gusto! Quedamos atentos a lo que necesites." }],
];

const QUOTE_STATUSES = ["draft", "sent", "accepted", "rejected", "expired"] as const;
const ORDER_PLAN = [
  { status: "draft", fulfillment: "shipping" },
  { status: "draft", fulfillment: "pickup" },
  { status: "pending_payment", fulfillment: "shipping" },
  { status: "pending_payment", fulfillment: "service" },
  { status: "paid", fulfillment: "shipping" },
  { status: "paid", fulfillment: "service" },
] as const;

async function main(): Promise<void> {
  const tenantId = await resolveTenantId();
  const { db, close } = createDb(appUrl as string, { max: 2 });
  const now = Date.now();
  const counts: Record<string, number> = {};
  const bump = (k: string, n: number): void => {
    counts[k] = (counts[k] ?? 0) + n;
  };

  try {
    await withTenant(db, tenantId, async (tx) => {
      // Cleanup of a previous run (quotes/orders reference contacts without cascade, so they go first).
      await tx.delete(orders).where(and(eq(orders.tenantId, tenantId), like(orders.number, "DEMO-%")));
      await tx.delete(quotes).where(and(eq(quotes.tenantId, tenantId), like(quotes.number, "DEMO-%")));
      await tx.delete(products).where(and(eq(products.tenantId, tenantId), sql`${DEMO_TAG} = ANY(${products.tags})`));
      await tx.delete(contacts).where(and(eq(contacts.tenantId, tenantId), sql`${DEMO_TAG} = ANY(${contacts.tags})`));
      await tx.delete(notifications).where(and(eq(notifications.tenantId, tenantId), like(notifications.dedupeKey, "demo:%")));
      await tx.delete(knowledgeSources).where(and(eq(knowledgeSources.tenantId, tenantId), like(knowledgeSources.title, "[demo]%")));

      // Channel connection: reuse any, else create a pending demo one.
      const existing = await tx
        .select({ id: channelConnections.id })
        .from(channelConnections)
        .where(eq(channelConnections.tenantId, tenantId))
        .limit(1);
      let channelId = existing[0]?.id;
      if (!channelId) {
        const [created] = await tx
          .insert(channelConnections)
          .values({
            tenantId,
            provider: "gupshup",
            phoneE164: "+520000000000",
            webhookToken: `demo-${randomBytes(16).toString("hex")}`,
            status: "pending",
          })
          .returning({ id: channelConnections.id });
        channelId = created!.id;
        bump("channel_connections", 1);
      }

      // Contacts + consents.
      const contactRows = await tx
        .insert(contacts)
        .values(
          NAMES.map((name, i) => ({
            tenantId,
            name,
            phoneE164: `+5255500${String(1000 + i)}`,
            tags: [DEMO_TAG, ...TAG_SETS[i % TAG_SETS.length]!],
            extracted: { ciudad: ["CDMX", "Guadalajara", "Bogotá", "Lima", "Santiago"][i % 5] },
            createdAt: new Date(now - (30 - i) * DAY),
          })),
        )
        .returning({ id: contacts.id });
      bump("contacts", contactRows.length);

      const consentValues = contactRows.flatMap((c, i) => {
        const granted = i % 3 !== 2;
        const base = { tenantId, contactId: c.id, evidence: { source: "demo-seed" } };
        return [
          { ...base, kind: "service" as const, status: "granted" as const, grantedAt: new Date(now - 20 * DAY) },
          granted
            ? { ...base, kind: "marketing" as const, status: "granted" as const, grantedAt: new Date(now - 10 * DAY) }
            : {
                ...base,
                kind: "marketing" as const,
                status: "revoked" as const,
                grantedAt: new Date(now - 15 * DAY),
                revokedAt: new Date(now - 5 * DAY),
              },
        ];
      });
      await tx.insert(consents).values(consentValues);
      bump("consents", consentValues.length);

      // Conversations + messages.
      let msgTotal = 0;
      const convIds: string[] = [];
      for (const [i, chat] of CHATS.entries()) {
        const start = now - (CHATS.length - i) * DAY;
        const at = (j: number): Date => new Date(start + j * 120_000);
        let lastInIdx = 0;
        chat.forEach((m, j) => {
          if (m.dir === "in") lastInIdx = j;
        });
        const [conv] = await tx
          .insert(conversations)
          .values({
            tenantId,
            contactId: contactRows[i]!.id,
            channelConnectionId: channelId,
            status: i === CHATS.length - 1 ? "resolved" : i % 3 === 1 ? "pending" : "open",
            aiMode: i % 2 === 0 ? "assist" : "off",
            lastInboundAt: at(lastInIdx),
            lastMessageAt: at(chat.length - 1),
          })
          .returning({ id: conversations.id });
        convIds.push(conv!.id);
        await tx.insert(messages).values(
          chat.map((m, j) => ({
            tenantId,
            conversationId: conv!.id,
            direction: m.dir === "in" ? ("inbound" as const) : ("outbound" as const),
            type: "text" as const,
            body: m.text,
            status: m.dir === "in" ? ("received" as const) : ("read" as const),
            author: m.dir === "in" ? ("contact" as const) : ("user" as const),
            sentAt: at(j),
            createdAt: at(j),
          })),
        );
        msgTotal += chat.length;
      }
      bump("conversations", convIds.length);
      bump("messages", msgTotal);

      // Catalog.
      const variantRows: { id: string; productId: string; name: string; price: bigint; options: Record<string, string> }[] = [];
      for (const [i, p] of PRODUCTS.entries()) {
        const code = `DEMO-${String(i + 1).padStart(3, "0")}`;
        const [prod] = await tx
          .insert(products)
          .values({
            tenantId,
            sku: code,
            slug: `demo-${i + 1}`,
            kind: p.kind,
            category: p.category,
            tags: [DEMO_TAG],
            trackStock: p.kind === "physical",
            name: p.name,
            description: `${p.name} (producto de demostración).`,
            unit: p.kind === "service" ? "servicio" : "pieza",
            priceMinor: BigInt(p.price),
            currency: CURRENCY,
            taxRateBp: 1600,
          })
          .returning({ id: products.id });
        const vs = await tx
          .insert(productVariants)
          .values(
            p.variants.map(([, options, price], j) => ({
              tenantId,
              productId: prod!.id,
              sku: `${code}-${j + 1}`,
              options,
              optionKey: Object.entries(options)
                .sort()
                .map(([k, v]) => `${k}=${v}`)
                .join("|"),
              priceMinor: price === null ? null : BigInt(price),
              stockOnHand: p.kind === "physical" ? 20 + j * 5 : 0,
              position: j,
            })),
          )
          .returning({ id: productVariants.id });
        vs.forEach((v, j) =>
          variantRows.push({
            id: v.id,
            productId: prod!.id,
            name: p.name,
            price: BigInt(p.variants[j]![2] ?? p.price),
            options: p.variants[j]![1],
          }),
        );
        bump("products", 1);
        bump("product_variants", vs.length);
      }

      const lineFor = (k: number, qty: number) => {
        const v = variantRows[k % variantRows.length]!;
        const net = v.price * BigInt(qty);
        const tax = (net * 1600n) / 10000n;
        return { v, qty, net, tax };
      };

      // Quotes in different statuses.
      for (const [i, status] of QUOTE_STATUSES.entries()) {
        const ln = [lineFor(i * 2, 2), lineFor(i * 2 + 1, 1)];
        const sub = ln.reduce((a, l) => a + l.net, 0n);
        const tax = ln.reduce((a, l) => a + l.tax, 0n);
        const [q] = await tx
          .insert(quotes)
          .values({
            tenantId,
            number: `DEMO-Q-${String(i + 1).padStart(3, "0")}`,
            contactId: contactRows[i]!.id,
            conversationId: convIds[i] ?? null,
            status,
            currency: CURRENCY,
            subtotalMinor: sub,
            taxMinor: tax,
            totalMinor: sub + tax,
            validUntil: new Date(now + (status === "expired" ? -3 : 15) * DAY),
            sentAt: status === "draft" ? null : new Date(now - 4 * DAY),
            acceptedAt: status === "accepted" ? new Date(now - 2 * DAY) : null,
            createdByType: "user",
          })
          .returning({ id: quotes.id });
        await tx.insert(quoteItems).values(
          ln.map((l, p) => ({
            tenantId,
            quoteId: q!.id,
            position: p + 1,
            productId: l.v.productId,
            variantId: l.v.id,
            description: l.v.name,
            quantityMilli: BigInt(l.qty * 1000),
            unitPriceMinor: l.v.price,
            taxRateBp: 1600,
            lineTotalMinor: l.net + l.tax,
          })),
        );
        bump("quotes", 1);
        bump("quote_items", ln.length);
      }

      // Orders. Paid ones get a matching payment verified_by='reconciliation'.
      for (const [i, plan] of ORDER_PLAN.entries()) {
        const l = lineFor(i + 3, 1 + (i % 3));
        const total = l.net + l.tax;
        const paidAt = plan.status === "paid" ? new Date(now - (i + 1) * DAY) : null;
        const [o] = await tx
          .insert(orders)
          .values({
            tenantId,
            number: `DEMO-O-${String(i + 1).padStart(3, "0")}`,
            contactId: contactRows[i + 5]!.id,
            conversationId: convIds[(i + 3) % convIds.length] ?? null,
            status: plan.status,
            currency: CURRENCY,
            subtotalMinor: l.net,
            taxMinor: l.tax,
            totalMinor: total,
            fulfillment: plan.fulfillment,
            paidAt,
            createdByType: "user",
          })
          .returning({ id: orders.id });
        await tx.insert(orderItems).values({
          tenantId,
          orderId: o!.id,
          variantId: l.v.id,
          productId: l.v.productId,
          description: l.v.name,
          options: l.v.options,
          quantity: l.qty,
          unitPriceMinor: l.v.price,
          taxRateBp: 1600,
          lineTotalMinor: total,
        });
        if (paidAt) {
          await tx.insert(payments).values({
            tenantId,
            orderId: o!.id,
            provider: "stripe",
            providerRef: `demo_cs_${i + 1}`,
            url: "https://example.invalid/demo-checkout",
            amountMinor: total,
            currency: CURRENCY,
            status: "succeeded",
            verifiedBy: "reconciliation",
            paidAt,
          });
          bump("payments", 1);
        }
        bump("orders", 1);
        bump("order_items", 1);
      }

      // Notifications.
      await tx.insert(notifications).values([
        { tenantId, kind: "order_paid", title: "Pedido DEMO-O-005 pagado", body: "Pago verificado por conciliación.", entity: "order", dedupeKey: "demo:order_paid:5", whatsappStatus: "not_configured" },
        { tenantId, kind: "approval_requested", title: "Presupuesto DEMO-Q-001 pendiente de aprobación", entity: "quote", dedupeKey: "demo:approval:1", whatsappStatus: "not_configured" },
        { tenantId, kind: "handoff", title: "Una conversación necesita atención humana", conversationId: convIds[2] ?? null, dedupeKey: "demo:handoff:1", whatsappStatus: "not_configured" },
      ]);
      bump("notifications", 3);

      // Knowledge.
      const [src] = await tx
        .insert(knowledgeSources)
        .values({ tenantId, kind: "faq", title: "[demo] Preguntas frecuentes", status: "ready" })
        .returning({ id: knowledgeSources.id });
      const faq = [
        "Envíos: entregamos en 3 a 5 días hábiles en todo México. Envío gratis en compras mayores a $1,500 MXN.",
        "Cambios y devoluciones: aceptamos cambios dentro de los 15 días posteriores a la entrega con el producto sin uso.",
        "Formas de pago: tarjeta de crédito o débito, transferencia bancaria y pago en línea con enlace seguro.",
        "Horario de atención: lunes a viernes de 9:00 a 18:00 y sábados de 10:00 a 14:00.",
      ];
      await tx
        .insert(knowledgeChunks)
        .values(faq.map((content, ordinal) => ({ tenantId, sourceId: src!.id, sourceVersion: 1, ordinal, content })));
      bump("knowledge_sources", 1);
      bump("knowledge_chunks", faq.length);
    });
  } finally {
    await close();
  }
  console.log(`seed-demo: tenant ${slug} (${tenantId}) seeded`);
  console.log(JSON.stringify(counts, null, 2));
}

main().catch((err: unknown) => {
  console.error("seed-demo failed:", err instanceof Error ? err.message : err);
  process.exit(1);
});
