import { EncryptionNotConfiguredError, type UpsertCommerceConnectionRequest } from "@crmwsp/contracts";
import { redact, type CipherBox } from "@crmwsp/crypto";
import { commerceConnections, type CommerceConnection, type Transaction } from "@crmwsp/db";
import type { CommerceProvider } from "@crmwsp/integrations";
import { generateWebhookToken } from "@crmwsp/whatsapp";
import { writeAudit } from "../inbox/audit.js";
import { commerceAccessTokenPurpose, commerceWebhookSecretPurpose } from "./integrations.constants.js";
import { resolveStoreCredentials } from "./store-credentials.js";

export interface UpsertCommerceConnectionArgs {
  tenantId: string;
  /** Acting user, recorded in the audit row. */
  userId: string;
  provider: CommerceProvider;
  input: UpsertCommerceConnectionRequest;
  ip?: string | undefined;
  /** Extra non-secret audit fields (e.g. how the connection was made). */
  auditExtra?: Record<string, unknown>;
}

/**
 * BYOK upsert of a commerce connection inside the caller's tenant transaction: stores the webhook
 * secret (and store API credential) encrypted with tenant-bound AAD, keeps the webhook token on
 * update (rotating secrets must not break the configured URL) and writes the audit row.
 * Throws ValidationError for bad store credentials (before any write).
 */
export async function upsertCommerceConnection(tx: Transaction, cipher: CipherBox | null, args: UpsertCommerceConnectionArgs): Promise<CommerceConnection> {
  const { tenantId, userId, provider, input } = args;
  if (!cipher) throw new EncryptionNotConfiguredError();
  const creds = resolveStoreCredentials(provider, input);
  const webhookSecretEncrypted = cipher.encrypt(input.webhookSecret, { tenantId, purpose: commerceWebhookSecretPurpose(provider) });
  const accessTokenEncrypted = creds.accessToken
    ? cipher.encrypt(creds.accessToken, { tenantId, purpose: commerceAccessTokenPurpose(provider) })
    : undefined;
  const hint = redact(input.webhookSecret);
  const now = new Date();
  const [saved] = await tx
    .insert(commerceConnections)
    .values({
      tenantId,
      provider,
      webhookSecretEncrypted,
      accessTokenEncrypted: accessTokenEncrypted ?? null,
      secretHint: hint,
      shopDomain: creds.shopDomain ?? null,
      webhookToken: generateWebhookToken(),
      status: "active",
    })
    .onConflictDoUpdate({
      target: [commerceConnections.tenantId, commerceConnections.provider],
      // The webhook token is kept: rotating secrets must not break the configured URL.
      set: {
        webhookSecretEncrypted,
        ...(accessTokenEncrypted ? { accessTokenEncrypted } : {}),
        ...(creds.shopDomain ? { shopDomain: creds.shopDomain } : {}),
        secretHint: hint,
        status: "active",
        updatedAt: now,
      },
    })
    .returning();
  if (!saved) throw new Error("upsert returned no row");
  await writeAudit(tx, {
    tenantId,
    userId,
    entity: "commerce_connection",
    entityId: saved.id,
    action: "commerce_connection.saved",
    diff: { provider, secretHint: hint, shopDomain: saved.shopDomain, accessTokenChanged: !!accessTokenEncrypted, ...args.auditExtra },
    ip: args.ip,
  });
  return saved;
}
