import { ValidationError } from "@crmwsp/contracts";
import { formatMinor, normalizeCurrency } from "./currency.js";
import type { PaymentReference } from "./types.js";

export interface ManualTransferConfig {
  method: "bank_transfer" | "qr";
  accountHolder: string;
  /** Public bank details; not secret. */
  iban?: string;
  bic?: string;
  /** For `qr` (Bizum, local QR...): https URL of the QR image. */
  qrImageUrl?: string;
  notes?: string;
  locale?: string;
}

export interface PaymentInstructions {
  /** Concept the payer must write, so the owner can match the transfer. */
  concept: string;
  text: string;
  qrImageUrl?: string;
}

export interface ManualConfirmationInput {
  reference: PaymentReference;
  amountMinor: number;
  currency: string;
  /** User id of the human who checked the bank statement. */
  confirmedBy: string;
  /** Mandatory justification, e.g. "Seen in BBVA statement 2026-10-20, ref PED-1A2B3C4D". */
  reason: string;
  confirmedAt?: Date;
}

/** Owner-confirmed payment. Shaped like a reconciliation: never derived from a receipt image. */
export interface ManualPaymentConfirmation extends ManualConfirmationInput {
  verifiedBy: "reconciliation";
  confirmedAt: Date;
}

/**
 * Manual transfer/QR payments. It creates no link and has no webhook, hence it does not
 * implement `PaymentProvider`. The API enforces who may confirm; this only models the data
 * (a human, a reason, verifiedBy = reconciliation). A receipt photo alone never marks `paid`.
 */
export class ManualTransferProvider {
  readonly name = "manual_transfer";
  readonly supportsWebhook = false;
  readonly #config: ManualTransferConfig;

  constructor(config: ManualTransferConfig) {
    if (!config.accountHolder.trim()) throw new ValidationError("accountHolder is required");
    if (config.method === "bank_transfer" && !config.iban) throw new ValidationError("iban is required for bank transfers");
    if (config.method === "qr") {
      if (!config.qrImageUrl || !/^https:\/\//.test(config.qrImageUrl)) throw new ValidationError("qrImageUrl must be https");
    }
    this.#config = { ...config };
  }

  /** Short, human-typable concept derived from the reference (PED-/PRE- + 8 chars of the id). */
  static concept(ref: PaymentReference): string {
    const prefix = ref.kind === "order" ? "PED" : "PRE";
    return `${prefix}-${ref.id.replace(/[^A-Za-z0-9]/g, "").slice(0, 8).toUpperCase()}`;
  }

  getInstructions(input: { amountMinor: number; currency: string; reference: PaymentReference }): PaymentInstructions {
    const c = this.#config;
    const currency = normalizeCurrency(input.currency);
    if (!Number.isSafeInteger(input.amountMinor) || input.amountMinor <= 0) {
      throw new ValidationError("amountMinor must be a positive integer");
    }
    const concept = ManualTransferProvider.concept(input.reference);
    const lines = [`Importe: ${formatMinor(input.amountMinor, currency, c.locale)}`, `Titular: ${c.accountHolder}`];
    if (c.method === "bank_transfer") {
      lines.push(`IBAN: ${c.iban}`);
      if (c.bic) lines.push(`BIC: ${c.bic}`);
    } else {
      lines.push("Pago por QR: escanea el código adjunto.");
    }
    lines.push(`Concepto: ${concept}`);
    if (c.notes) lines.push(c.notes);
    return { concept, text: lines.join("\n"), ...(c.qrImageUrl && c.method === "qr" ? { qrImageUrl: c.qrImageUrl } : {}) };
  }

  /** Builds the confirmation record. Requires a human and a reason. */
  confirm(input: ManualConfirmationInput): ManualPaymentConfirmation {
    if (!input.confirmedBy.trim()) throw new ValidationError("confirmedBy is required");
    if (input.reason.trim().length < 5) throw new ValidationError("A reason (min 5 chars) is required to confirm manually");
    if (!Number.isSafeInteger(input.amountMinor) || input.amountMinor <= 0) {
      throw new ValidationError("amountMinor must be a positive integer");
    }
    return {
      ...input,
      currency: normalizeCurrency(input.currency),
      reason: input.reason.trim(),
      verifiedBy: "reconciliation",
      confirmedAt: input.confirmedAt ?? new Date(),
    };
  }
}
