import { randomBytes } from "node:crypto";
import { Body, Controller, Get, Inject, Param, Post, Put, Req, UseGuards } from "@nestjs/common";
import {
  ConflictError,
  EncryptionNotConfiguredError,
  NotFoundError,
  ValidationError,
  createPaymentLinkRequestSchema,
  upsertMercadoPagoConnectionRequestSchema,
  upsertStripeConnectionRequestSchema,
  type MercadoPagoConnection,
  type PaymentLinkResponse,
  type StripeConnection,
} from "@crmwsp/contracts";
import { redact, type CipherBox } from "@crmwsp/crypto";
import { and, desc, eq, gt, isUuid, orders, paymentConnections, payments, sql, type Payment, type PaymentConnection, type PaymentProviderName } from "@crmwsp/db";
import { buildExternalReference, type PaymentLink, type PaymentProvider, type StripeProviderOptions } from "@crmwsp/payments";
import { generateWebhookToken } from "@crmwsp/whatsapp";
import { CurrentTenantDb, Roles } from "../auth/decorators.js";
import { TenantGuard } from "../auth/tenant.guard.js";
import { CIPHER_BOX } from "../channels/channels.constants.js";
import type { HttpRequest } from "../common/http.js";
import { parseOrThrow } from "../common/zod.js";
import type { TenantDb } from "../db/tenant-db.js";
import { writeAudit } from "../inbox/audit.js";
import type { MercadoPagoProviderFactory } from "./mercadopago-webhook.service.js";
import {
  MERCADOPAGO_ACCESS_TOKEN_PURPOSE,
  MERCADOPAGO_PROVIDER_FACTORY,
  MERCADOPAGO_WEBHOOK_SECRET_PURPOSE,
  STRIPE_PROVIDER_FACTORY,
  STRIPE_SECRET_KEY_PURPOSE,
  STRIPE_WEBHOOK_SECRET_PURPOSE,
  mercadoPagoWebhookUrlFor,
  stripeWebhookUrlFor,
} from "./payments.constants.js";

export type StripeProviderFactory = (options: StripeProviderOptions) => PaymentProvider;

function toLink(p: Payment): PaymentLinkResponse {
  return {
    paymentId: p.id,
    orderId: p.orderId,
    provider: p.provider,
    providerRef: p.providerRef,
    url: p.url,
    amountMinor: Number(p.amountMinor),
    currency: p.currency,
    status: p.status,
    expiresAt: p.expiresAt ? p.expiresAt.toISOString() : null,
  };
}

/** Mercado Pago preferences have no default expiry; ours expire like Stripe sessions (24 h). */
const MP_LINK_TTL_MS = 24 * 60 * 60 * 1000;

@Controller()
@UseGuards(TenantGuard)
export class PaymentsController {
  constructor(
    @Inject(CIPHER_BOX) private readonly cipher: CipherBox | null,
    @Inject(STRIPE_PROVIDER_FACTORY) private readonly providerFactory: StripeProviderFactory,
    @Inject(MERCADOPAGO_PROVIDER_FACTORY) private readonly mpFactory: MercadoPagoProviderFactory,
  ) {}

  private toConnection(row: PaymentConnection): StripeConnection {
    return {
      provider: "stripe",
      status: row.status,
      secretKeyHint: row.secretKeyHint,
      webhookUrl: stripeWebhookUrlFor(row.webhookToken),
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  private toMpConnection(row: PaymentConnection): MercadoPagoConnection {
    return {
      provider: "mercadopago",
      status: row.status,
      secretKeyHint: row.secretKeyHint,
      webhookUrl: mercadoPagoWebhookUrlFor(row.webhookToken),
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  @Get("payments/stripe/connection")
  @Roles("owner", "admin")
  async getStripe(@CurrentTenantDb() db: TenantDb): Promise<StripeConnection> {
    const [row] = await db.run((tx) => tx.select().from(paymentConnections).where(eq(paymentConnections.provider, "stripe")));
    if (!row) throw new NotFoundError();
    return this.toConnection(row);
  }

  /** BYOK: stores the Stripe secret key and webhook secret encrypted (tenant-bound AAD). */
  @Put("payments/stripe/connection")
  @Roles("owner", "admin")
  async putStripe(@CurrentTenantDb() db: TenantDb, @Body() body: unknown, @Req() req: HttpRequest): Promise<StripeConnection> {
    const input = parseOrThrow(upsertStripeConnectionRequestSchema, body);
    if (!this.cipher) throw new EncryptionNotConfiguredError();
    const row = await this.saveConnection(db, req, "stripe", {
      secretKeyEncrypted: this.cipher.encrypt(input.secretKey, { tenantId: db.tenantId, purpose: STRIPE_SECRET_KEY_PURPOSE }),
      webhookSecretEncrypted: this.cipher.encrypt(input.webhookSecret, { tenantId: db.tenantId, purpose: STRIPE_WEBHOOK_SECRET_PURPOSE }),
      hint: redact(input.secretKey),
    });
    return this.toConnection(row);
  }

  @Get("payments/mercadopago/connection")
  @Roles("owner", "admin")
  async getMercadoPago(@CurrentTenantDb() db: TenantDb): Promise<MercadoPagoConnection> {
    const [row] = await db.run((tx) => tx.select().from(paymentConnections).where(eq(paymentConnections.provider, "mercadopago")));
    if (!row) throw new NotFoundError();
    return this.toMpConnection(row);
  }

  /** BYOK: Mercado Pago access token + webhook signature secret, encrypted (tenant-bound AAD). */
  @Put("payments/mercadopago/connection")
  @Roles("owner", "admin")
  async putMercadoPago(@CurrentTenantDb() db: TenantDb, @Body() body: unknown, @Req() req: HttpRequest): Promise<MercadoPagoConnection> {
    const input = parseOrThrow(upsertMercadoPagoConnectionRequestSchema, body);
    if (!this.cipher) throw new EncryptionNotConfiguredError();
    const row = await this.saveConnection(db, req, "mercadopago", {
      secretKeyEncrypted: this.cipher.encrypt(input.accessToken, { tenantId: db.tenantId, purpose: MERCADOPAGO_ACCESS_TOKEN_PURPOSE }),
      webhookSecretEncrypted: this.cipher.encrypt(input.webhookSecret, { tenantId: db.tenantId, purpose: MERCADOPAGO_WEBHOOK_SECRET_PURPOSE }),
      hint: redact(input.accessToken),
    });
    return this.toMpConnection(row);
  }

  private async saveConnection(
    db: TenantDb,
    req: HttpRequest,
    provider: PaymentProviderName,
    s: { secretKeyEncrypted: Buffer; webhookSecretEncrypted: Buffer; hint: string },
  ): Promise<PaymentConnection> {
    return db.run(async (tx) => {
      const now = new Date();
      const [saved] = await tx
        .insert(paymentConnections)
        .values({
          tenantId: db.tenantId,
          provider,
          secretKeyEncrypted: s.secretKeyEncrypted,
          webhookSecretEncrypted: s.webhookSecretEncrypted,
          secretKeyHint: s.hint,
          webhookToken: generateWebhookToken(),
          status: "active",
        })
        .onConflictDoUpdate({
          target: [paymentConnections.tenantId, paymentConnections.provider],
          // The webhook token is kept: rotating secrets must not break the configured endpoint URL.
          set: { secretKeyEncrypted: s.secretKeyEncrypted, webhookSecretEncrypted: s.webhookSecretEncrypted, secretKeyHint: s.hint, status: "active", updatedAt: now },
        })
        .returning();
      if (!saved) throw new Error("upsert returned no row");
      await writeAudit(tx, {
        tenantId: db.tenantId,
        userId: db.userId,
        entity: "payment_connection",
        entityId: saved.id,
        action: "payment_connection.saved",
        diff: { provider, secretKeyHint: s.hint },
        ip: req.ip,
      });
      return saved;
    });
  }

  /**
   * Creates (or reuses) a hosted payment link (Stripe Checkout or Mercado Pago preference) for a
   * `pending_payment` order. The amount is the order total on the server. The order becomes
   * `paid` only through the verified webhook.
   */
  @Post("orders/:id/payment-link")
  @Roles("owner", "admin", "agent")
  async createLink(
    @CurrentTenantDb() db: TenantDb,
    @Param("id") id: string,
    @Body() body: unknown,
    @Req() req: HttpRequest,
  ): Promise<PaymentLinkResponse> {
    if (!isUuid(id)) throw new NotFoundError();
    const input = parseOrThrow(createPaymentLinkRequestSchema, body ?? {});
    const providerName: PaymentProviderName = input.provider ?? "stripe";
    if (!this.cipher) throw new EncryptionNotConfiguredError();
    const cipher = this.cipher;

    const pre = await db.run(async (tx) => {
      const [o] = await tx.select().from(orders).where(eq(orders.id, id));
      if (!o) throw new NotFoundError();
      if (o.status !== "pending_payment") throw new ConflictError(`Cannot create a payment link for an order that is ${o.status}`);
      if (o.totalMinor <= 0n) throw new ValidationError("Order total must be positive");
      const [existing] = await tx
        .select()
        .from(payments)
        .where(
          and(
            eq(payments.orderId, id),
            eq(payments.provider, providerName),
            eq(payments.status, "pending"),
            eq(payments.amountMinor, o.totalMinor),
            eq(payments.currency, o.currency),
            gt(payments.expiresAt, sql`now() + interval '5 minutes'`),
          ),
        )
        .orderBy(desc(payments.createdAt))
        .limit(1);
      const [conn] = await tx
        .select()
        .from(paymentConnections)
        .where(and(eq(paymentConnections.provider, providerName), eq(paymentConnections.status, "active")));
      return { order: o, existing, conn };
    });
    if (pre.existing) return toLink(pre.existing);
    const label = providerName === "stripe" ? "Stripe" : "Mercado Pago";
    if (!pre.conn) throw new ConflictError(`${label} is not configured for this workspace`);

    const amountMinor = Number(pre.order.totalMinor);
    if (!Number.isSafeInteger(amountMinor)) throw new ValidationError("Order total out of range");
    const ctx = (purpose: string) => ({ tenantId: db.tenantId, purpose });
    const reference = { tenantId: db.tenantId, kind: "order" as const, id };
    const description = `Pedido ${pre.order.number}`;
    let link: PaymentLink;
    let extra: Record<string, unknown> = {};
    // Network call outside any DB transaction.
    if (providerName === "stripe") {
      const defaultSuccessUrl = process.env["STRIPE_DEFAULT_SUCCESS_URL"];
      const provider = this.providerFactory({
        secretKey: cipher.decrypt(pre.conn.secretKeyEncrypted, ctx(STRIPE_SECRET_KEY_PURPOSE)),
        webhookSecret: cipher.decrypt(pre.conn.webhookSecretEncrypted, ctx(STRIPE_WEBHOOK_SECRET_PURPOSE)),
        ...(defaultSuccessUrl ? { defaultSuccessUrl } : {}),
      });
      // Stripe idempotency key = (ref, amount, currency), so a retry returns the same Checkout Session.
      link = await provider.createPaymentLink({
        amountMinor,
        currency: pre.order.currency,
        description,
        reference,
        ...(input.successUrl ? { successUrl: input.successUrl } : {}),
      });
    } else {
      const mp = this.mpFactory(cipher.decrypt(pre.conn.secretKeyEncrypted, ctx(MERCADOPAGO_ACCESS_TOKEN_PURPOSE)));
      // Our attempt reference: links the MP payment back to this order AND this payments row.
      const externalReference = buildExternalReference(reference, randomBytes(12).toString("hex"));
      const r = await mp.createPaymentLink({
        amountMinor,
        currency: pre.order.currency,
        description,
        reference,
        externalReference,
        notificationUrl: mercadoPagoWebhookUrlFor(pre.conn.webhookToken),
        expiresAt: new Date(Date.now() + MP_LINK_TTL_MS),
        ...(input.successUrl ? { successUrl: input.successUrl } : {}),
      });
      link = r;
      extra = { preferenceId: r.preferenceId };
    }

    return db.run(async (tx) => {
      // Re-check under lock: the order may have changed while the provider was called.
      const [o] = await tx.select().from(orders).where(eq(orders.id, id)).for("update");
      if (!o || o.status !== "pending_payment" || o.totalMinor !== pre.order.totalMinor || o.currency !== pre.order.currency) {
        throw new ConflictError("The order changed while creating the payment link");
      }
      await tx
        .insert(payments)
        .values({
          tenantId: db.tenantId,
          orderId: id,
          provider: providerName,
          providerRef: link.providerRef,
          url: link.url,
          amountMinor: o.totalMinor,
          currency: o.currency,
          status: "pending",
          expiresAt: link.expiresAt ?? null,
        })
        .onConflictDoNothing({ target: [payments.tenantId, payments.provider, payments.providerRef] });
      const [p] = await tx
        .select()
        .from(payments)
        .where(and(eq(payments.provider, providerName), eq(payments.providerRef, link.providerRef)));
      if (!p || p.orderId !== id) throw new ConflictError("Payment reference belongs to another order");
      await writeAudit(tx, {
        tenantId: db.tenantId,
        userId: db.userId,
        entity: "order",
        entityId: id,
        action: "order.payment_link_created",
        diff: { provider: providerName, paymentId: p.id, amountMinor: o.totalMinor.toString(), currency: o.currency, ...extra },
        ip: req.ip,
      });
      return toLink(p);
    });
  }
}
