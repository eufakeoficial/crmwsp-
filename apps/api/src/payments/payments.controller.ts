import { Body, Controller, Get, Inject, Param, Post, Put, Req, UseGuards } from "@nestjs/common";
import {
  ConflictError,
  EncryptionNotConfiguredError,
  NotFoundError,
  ValidationError,
  createPaymentLinkRequestSchema,
  upsertStripeConnectionRequestSchema,
  type PaymentLinkResponse,
  type StripeConnection,
} from "@crmwsp/contracts";
import { redact, type CipherBox } from "@crmwsp/crypto";
import { and, desc, eq, gt, isUuid, orders, paymentConnections, payments, sql, type Payment, type PaymentConnection } from "@crmwsp/db";
import type { PaymentProvider, StripeProviderOptions } from "@crmwsp/payments";
import { generateWebhookToken } from "@crmwsp/whatsapp";
import { CurrentTenantDb, Roles } from "../auth/decorators.js";
import { TenantGuard } from "../auth/tenant.guard.js";
import { CIPHER_BOX } from "../channels/channels.constants.js";
import type { HttpRequest } from "../common/http.js";
import { parseOrThrow } from "../common/zod.js";
import type { TenantDb } from "../db/tenant-db.js";
import { writeAudit } from "../inbox/audit.js";
import {
  STRIPE_PROVIDER_FACTORY,
  STRIPE_SECRET_KEY_PURPOSE,
  STRIPE_WEBHOOK_SECRET_PURPOSE,
  stripeWebhookUrlFor,
} from "./payments.constants.js";

export type StripeProviderFactory = (options: StripeProviderOptions) => PaymentProvider;

function toLink(p: Payment): PaymentLinkResponse {
  return {
    paymentId: p.id,
    orderId: p.orderId,
    provider: "stripe",
    providerRef: p.providerRef,
    url: p.url,
    amountMinor: Number(p.amountMinor),
    currency: p.currency,
    status: p.status,
    expiresAt: p.expiresAt ? p.expiresAt.toISOString() : null,
  };
}

@Controller()
@UseGuards(TenantGuard)
export class PaymentsController {
  constructor(
    @Inject(CIPHER_BOX) private readonly cipher: CipherBox | null,
    @Inject(STRIPE_PROVIDER_FACTORY) private readonly providerFactory: StripeProviderFactory,
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
    const secretKeyEncrypted = this.cipher.encrypt(input.secretKey, { tenantId: db.tenantId, purpose: STRIPE_SECRET_KEY_PURPOSE });
    const webhookSecretEncrypted = this.cipher.encrypt(input.webhookSecret, {
      tenantId: db.tenantId,
      purpose: STRIPE_WEBHOOK_SECRET_PURPOSE,
    });
    const hint = redact(input.secretKey);
    const row = await db.run(async (tx) => {
      const now = new Date();
      const [saved] = await tx
        .insert(paymentConnections)
        .values({
          tenantId: db.tenantId,
          provider: "stripe",
          secretKeyEncrypted,
          webhookSecretEncrypted,
          secretKeyHint: hint,
          webhookToken: generateWebhookToken(),
          status: "active",
        })
        .onConflictDoUpdate({
          target: [paymentConnections.tenantId, paymentConnections.provider],
          // The webhook token is kept: rotating secrets must not break the configured endpoint URL.
          set: { secretKeyEncrypted, webhookSecretEncrypted, secretKeyHint: hint, status: "active", updatedAt: now },
        })
        .returning();
      if (!saved) throw new Error("upsert returned no row");
      await writeAudit(tx, {
        tenantId: db.tenantId,
        userId: db.userId,
        entity: "payment_connection",
        entityId: saved.id,
        action: "payment_connection.saved",
        diff: { provider: "stripe", secretKeyHint: hint },
        ip: req.ip,
      });
      return saved;
    });
    return this.toConnection(row);
  }

  /**
   * Creates (or reuses) a Stripe Checkout link for a `pending_payment` order. The amount is the
   * order total on the server. The order becomes `paid` only through the verified webhook.
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
            eq(payments.provider, "stripe"),
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
        .where(and(eq(paymentConnections.provider, "stripe"), eq(paymentConnections.status, "active")));
      return { order: o, existing, conn };
    });
    if (pre.existing) return toLink(pre.existing);
    if (!pre.conn) throw new ConflictError("Stripe is not configured for this workspace");

    const amountMinor = Number(pre.order.totalMinor);
    if (!Number.isSafeInteger(amountMinor)) throw new ValidationError("Order total out of range");
    const ctx = (purpose: string) => ({ tenantId: db.tenantId, purpose });
    const defaultSuccessUrl = process.env["STRIPE_DEFAULT_SUCCESS_URL"];
    const provider = this.providerFactory({
      secretKey: cipher.decrypt(pre.conn.secretKeyEncrypted, ctx(STRIPE_SECRET_KEY_PURPOSE)),
      webhookSecret: cipher.decrypt(pre.conn.webhookSecretEncrypted, ctx(STRIPE_WEBHOOK_SECRET_PURPOSE)),
      ...(defaultSuccessUrl ? { defaultSuccessUrl } : {}),
    });
    // Network call outside any DB transaction. Stripe idempotency key = (ref, amount, currency),
    // so a retry returns the same Checkout Session.
    const link = await provider.createPaymentLink({
      amountMinor,
      currency: pre.order.currency,
      description: `Pedido ${pre.order.number}`,
      reference: { tenantId: db.tenantId, kind: "order", id },
      ...(input.successUrl ? { successUrl: input.successUrl } : {}),
    });

    return db.run(async (tx) => {
      // Re-check under lock: the order may have changed while Stripe was called.
      const [o] = await tx.select().from(orders).where(eq(orders.id, id)).for("update");
      if (!o || o.status !== "pending_payment" || o.totalMinor !== pre.order.totalMinor || o.currency !== pre.order.currency) {
        throw new ConflictError("The order changed while creating the payment link");
      }
      await tx
        .insert(payments)
        .values({
          tenantId: db.tenantId,
          orderId: id,
          provider: "stripe",
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
        .where(and(eq(payments.provider, "stripe"), eq(payments.providerRef, link.providerRef)));
      if (!p || p.orderId !== id) throw new ConflictError("Payment reference belongs to another order");
      await writeAudit(tx, {
        tenantId: db.tenantId,
        userId: db.userId,
        entity: "order",
        entityId: id,
        action: "order.payment_link_created",
        diff: { provider: "stripe", paymentId: p.id, amountMinor: o.totalMinor.toString(), currency: o.currency },
        ip: req.ip,
      });
      return toLink(p);
    });
  }
}
