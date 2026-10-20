import { renderEmail } from "@crmwsp/mailer";
import { createHash, randomBytes } from "node:crypto";

/** 32 random bytes, base64url (43 chars). Only the SHA-256 is stored. */
export function newInvitationToken(): { token: string; hash: Buffer } {
  const raw = randomBytes(32);
  return { token: raw.toString("base64url"), hash: createHash("sha256").update(raw).digest() };
}

export function hashInvitationToken(token: string): Buffer {
  return createHash("sha256").update(Buffer.from(token, "base64url")).digest();
}

export function publicWebUrl(env: NodeJS.ProcessEnv = process.env): string {
  return (
    (env["PUBLIC_WEB_URL"] ?? (env["WEB_ORIGINS"] ?? "").split(",")[0]?.trim() ?? "").replace(/\/+$/, "") ||
    "http://localhost:3000"
  );
}

/** Nest injection token for the shared `@crmwsp/mailer` instance. */
export const MAILER = Symbol("MAILER");

const ROLE_ES: Record<string, string> = { admin: "Administrador", agent: "Agente", viewer: "Lector" };

/** Spanish invitation email. The link is the only place the token ever appears. */
export function invitationEmail(input: { tenantName: string; role: string; inviterName: string | null; link: string }) {
  const who = input.inviterName ? `${input.inviterName} te ha invitado` : "Te han invitado";
  const { text, html } = renderEmail({
    title: `Únete a ${input.tenantName}`,
    body: [
      `${who} a unirte al equipo de ${input.tenantName} como ${ROLE_ES[input.role] ?? input.role}.`,
      "El enlace caduca en 7 días y solo se puede usar una vez. Si no esperabas esta invitación, ignora este correo.",
    ].join("\n\n"),
    ctaLabel: "Aceptar invitación",
    ctaUrl: input.link,
  });
  return { subject: `Invitación para unirte a ${input.tenantName}`.slice(0, 200), text, html };
}
