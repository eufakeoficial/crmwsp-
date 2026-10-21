import type { AgentConfig, AiConnection, KnowledgeSource, OwnerModeStatus, PlaybookResponse, VoiceSettingsDto } from "@crmwsp/contracts";

/** Raw answers used to mark each capability; `undefined` = unavailable (error or no permission). */
export interface AiCapabilityData {
  connection: AiConnection | null | undefined;
  sources: KnowledgeSource[] | undefined;
  voice: VoiceSettingsDto | undefined;
  owner: OwnerModeStatus | undefined;
  agent: AgentConfig | undefined;
  playbook: PlaybookResponse | undefined;
}

export type CapabilityKey =
  | "mode"
  | "knowledge"
  | "handoff"
  | "runs"
  | "attention"
  | "playbook"
  | "simulator"
  | "budget"
  | "voice"
  | "improve"
  | "orders"
  | "approvals"
  | "owner";

export interface AiCapability {
  key: CapabilityKey;
  title: string;
  /** One plain-Spanish line. */
  text: string;
  /** Route that exists in the app (nav-items or an app route). */
  href: string;
  linkLabel: string;
}

/**
 * Every AI capability that exists in the code today, each with the page where it is used or set up.
 * Routes: /app/ai/* (ai section), /app/settings/* (settings), /app/inbox (composer and order cards).
 */
export const AI_CAPABILITIES: readonly AiCapability[] = [
  { key: "mode", title: "Modo asistente o automático", text: "Elige si la IA redacta borradores para que tú envíes o responde sola dentro de tus reglas.", href: "/app/settings/ai", linkLabel: "Elegir modo" },
  { key: "knowledge", title: "Conocimiento y catálogo con citas", text: "Responde con tu catálogo y tus FAQ y cita la fuente de cada precio, stock o plazo.", href: "/app/settings/knowledge", linkLabel: "Gestionar conocimiento" },
  { key: "handoff", title: "Derivación a una persona", text: "Si no tiene una fuente o no está segura, pasa la conversación a tu equipo en vez de inventar.", href: "/app/ai/handoffs", linkLabel: "Ver derivaciones" },
  { key: "attention", title: "Conversaciones que necesitan atención", text: "Lista de chats que la IA derivó y que nadie ha respondido todavía.", href: "/app/ai/handoffs", linkLabel: "Ver pendientes" },
  { key: "runs", title: "Ejecuciones", text: "Historial de lo que hizo la IA: qué respondió, en qué fuentes se apoyó y por qué derivó.", href: "/app/ai/runs", linkLabel: "Ver ejecuciones" },
  { key: "playbook", title: "Playbook de ventas", text: "Etapas del embudo, respuestas a objeciones, estilo de cierre y seguimiento, siempre con técnicas honestas.", href: "/app/ai/playbook", linkLabel: "Configurar playbook" },
  { key: "approvals", title: "Aprobaciones", text: "Descuentos, presupuestos grandes y otras acciones esperan tu visto bueno antes de ejecutarse.", href: "/app/settings/approvals", linkLabel: "Ver aprobaciones" },
  { key: "simulator", title: "Simulador", text: "Prueba el bot con conversaciones de ejemplo antes de activarlo con clientes reales.", href: "/app/settings/ai/simulator", linkLabel: "Probar la IA" },
  { key: "budget", title: "Presupuesto y consumo de IA", text: "Pon un tope mensual a tu proveedor de IA y consulta cuánto llevas gastado.", href: "/app/settings/ai", linkLabel: "Ver consumo" },
  { key: "voice", title: "Respuestas por voz (ElevenLabs)", text: "Contesta con notas de voz naturales usando tu propia cuenta de ElevenLabs.", href: "/app/settings/ai#voz", linkLabel: "Configurar voz" },
  { key: "improve", title: "Mejorar texto", text: "Reescribe tu mensaje en tono profesional, amable o más corto antes de enviarlo desde el inbox.", href: "/app/inbox", linkLabel: "Ir al inbox" },
  { key: "orders", title: "Pedidos desde audio, foto o PDF", text: "Convierte lo que envía el cliente en un pedido listo para que lo revises.", href: "/app/inbox", linkLabel: "Ver pedidos pendientes" },
  { key: "owner", title: "Modo dueño por WhatsApp", text: "Consulta ventas y gestiona el CRM escribiendo desde tu propio WhatsApp.", href: "/app/settings/owner-mode", linkLabel: "Configurar modo dueño" },
];

/**
 * Status per capability from data already loaded by the hub: `true` = activo, `false` = inactivo,
 * `null` = nothing to configure (history or inbox tools), so no chip is shown.
 */
export function computeCapabilityStatus(d: AiCapabilityData): Record<CapabilityKey, boolean | null> {
  const connected = Boolean(d.connection);
  return {
    mode: connected && (d.agent === undefined || d.agent.aiModeDefault !== "off"),
    knowledge: (d.sources?.length ?? 0) > 0,
    handoff: connected,
    attention: null,
    runs: null,
    playbook: d.playbook ? d.playbook.enabled : false,
    approvals: connected,
    simulator: connected,
    budget: d.connection?.monthlyBudgetMinor != null,
    voice: Boolean(d.voice?.hasApiKey && d.voice.voiceId),
    improve: connected,
    orders: connected,
    owner: d.owner?.phone?.status === "verified",
  };
}
