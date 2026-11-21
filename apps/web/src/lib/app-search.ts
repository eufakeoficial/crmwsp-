import type { MembershipRole } from "@crmwsp/contracts";
import { NAV_GROUPS, NAV_SECONDARY, SETTINGS_SECTIONS, collectHrefs, type NavItem } from "../components/app/nav-items";
import { canViewAi } from "../components/app/roles";

/** Who may see an entry: everybody, anyone who can view the AI, or only owner/admin. */
export type SearchAccess = "all" | "ai" | "manage";

export interface SearchEntry {
  id: string;
  label: string;
  description: string;
  href: string;
  section: string;
  keywords: readonly string[];
  access: SearchAccess;
}

export interface SearchResult {
  entry: SearchEntry;
  score: number;
}

interface Meta {
  description: string;
  keywords: string;
  access?: SearchAccess;
}

/** Curated description, Spanish synonyms and role gate per route. Keywords are space separated. */
const META: Record<string, Meta> = {
  "/app": { description: "Resumen de tu negocio y accesos rápidos", keywords: "inicio panel dashboard resumen home principal" },
  "/app/inbox": { description: "Conversaciones de WhatsApp con tus clientes", keywords: "mensaje mensajes chat chats conversacion conversaciones bandeja whatsapp responder" },
  "/app/ai/handoffs": { description: "Chats que la IA derivó a una persona", keywords: "derivados atencion humano pendientes escalados", access: "ai" },
  "/app/contacts": { description: "Tus clientes y contactos", keywords: "cliente clientes contacto lead leads prospecto prospectos agenda telefonica etiquetas" },
  "/app/pipeline": { description: "Embudo de oportunidades por etapa", keywords: "embudo oportunidades etapas funnel crm kanban leads ventas" },
  "/app/quotes": { description: "Crea y envía presupuestos a tus clientes", keywords: "presupuesto cotizacion cotizaciones proforma propuesta precio" },
  "/app/orders": { description: "Pedidos de tus clientes y su estado", keywords: "pedido compras orden ordenes cobro entrega" },
  "/app/payments/reviews": { description: "Revisa comprobantes de pago recibidos", keywords: "comprobante pago pagos transferencia deposito recibo verificar", access: "manage" },
  "/app/analytics": { description: "Ingresos, márgenes y rentabilidad", keywords: "rentabilidad ganancias margen ingresos reportes estadisticas metricas", access: "manage" },
  "/app/agenda": { description: "Citas, reservas y disponibilidad", keywords: "cita citas reserva reservas turno turnos calendario horario agendar" },
  "/app/ai": { description: "Resumen de lo que hace la IA por ti", keywords: "ia inteligencia artificial bot asistente automatico", access: "ai" },
  "/app/ai/runs": { description: "Qué respondió la IA y por qué", keywords: "historial ia respuestas bot registro actividad", access: "ai" },
  "/app/ai/playbook": { description: "Cómo vende y responde tu IA paso a paso", keywords: "guion ventas script playbook bot ia", access: "ai" },
  "/app/settings/ai": { description: "Tono, idioma, límites y respuestas cortas de la IA", keywords: "ia bot prompt instrucciones respuestas cortas tono personalidad modelo asistente", access: "ai" },
  "/app/settings/ai/simulator": { description: "Prueba cómo respondería tu IA antes de activarla", keywords: "simulador probar ia bot test ensayo simulacion", access: "ai" },
  "/app/settings/knowledge": { description: "Documentos y datos que la IA usa para responder", keywords: "conocimiento base faq preguntas frecuentes catalogo documentos entrenar ia", access: "ai" },
  "/app/settings/approvals": { description: "Acciones de la IA que requieren tu visto bueno", keywords: "aprobaciones aprobar permisos revisar ia", access: "ai" },
  "/app/broadcasts": { description: "Envía mensajes masivos a tus clientes", keywords: "campana campanas difusion masivo masivos envio promocion marketing broadcast", access: "manage" },
  "/app/templates": { description: "Plantillas aprobadas por WhatsApp", keywords: "plantilla plantillas mensajes aprobados hsm template", access: "manage" },
  "/app/channels": { description: "Conecta tu número, API key y recarga saldo", keywords: "canal canales whatsapp numero api key clave credenciales webhook saldo recargar recarga gupshup conexion token" },
  "/app/settings/whatsapp-profile": { description: "Foto, nombre y descripción de tu WhatsApp", keywords: "perfil foto logo nombre del negocio descripcion about whatsapp", access: "manage" },
  "/app/products": { description: "Productos y servicios con sus precios", keywords: "catalogo productos servicios precios stock articulos inventario" },
  "/app/team": { description: "Invita y gestiona a tu equipo", keywords: "equipo usuarios invitar miembros agentes roles permisos personal colaboradores", access: "manage" },
  "/app/settings/integrations": { description: "Conecta otras herramientas", keywords: "integraciones conectar apps zapier google calendario sheets", access: "manage" },
  "/app/settings/currency": { description: "Moneda y tipos de cambio", keywords: "moneda divisa cambio dolar euro tasa precios", access: "manage" },
  "/app/settings/plan": { description: "Tu plan, límites y consumo del mes", keywords: "plan uso limites consumo cuota creditos mensajes cupo", access: "manage" },
  "/app/settings/billing": { description: "Paga o renueva tu plan: tarjeta, USDT o QR", keywords: "suscripcion pagar pago cobro factura facturas facturacion usdt qr tarjeta renovar renovacion cancelar", access: "manage" },
  "/app/settings/templates": { description: "Plantillas de configuración para tu tipo de negocio", keywords: "plantillas de negocio rubro industria presets", access: "manage" },
  "/app/settings/developers": { description: "Claves de API para conectar tus sistemas", keywords: "api key clave claves token desarrolladores programadores webhook integracion", access: "manage" },
  "/app/settings/ads": { description: "Anuncios que llevan clientes a tu WhatsApp", keywords: "anuncios ads facebook instagram meta publicidad", access: "manage" },
  "/app/settings/owner-mode": { description: "Maneja tu negocio escribiendo desde tu WhatsApp", keywords: "control whatsapp dueno propietario comandos remoto", access: "manage" },
  "/app/settings/company": { description: "Nombre, datos fiscales y zona horaria de tu empresa", keywords: "empresa nombre de la empresa negocio razon social datos fiscales zona horaria logo", access: "manage" },
  "/app/support": { description: "Ayuda y contacto con soporte", keywords: "soporte ayuda contacto problema error tutorial" },
  "/app/onboarding": { description: "Pasos para dejar todo listo", keywords: "puesta en marcha empezar configuracion inicial checklist guia primeros pasos" },
};

interface ActionDef {
  id: string;
  label: string;
  description: string;
  href: string;
  section: string;
  keywords: string;
  access?: SearchAccess;
}

/** Extra entries that are an action or a place not present in the sidebar. */
const ACTIONS: readonly ActionDef[] = [
  { id: "action-simulator", label: "Simulador de la IA", description: META["/app/settings/ai/simulator"]!.description, href: "/app/settings/ai/simulator", section: "Automatizar", keywords: META["/app/settings/ai/simulator"]!.keywords, access: "ai" },
  { id: "action-invite", label: "Invitar a alguien al equipo", description: "Envía una invitación por correo", href: "/app/team", section: "Configuración", keywords: "invitar agregar usuario miembro nuevo colaborador", access: "manage" },
  { id: "action-recharge", label: "Recargar saldo de WhatsApp", description: "Revisa y recarga el saldo de tu canal", href: "/app/channels", section: "Configuración", keywords: "recargar saldo credito fondos pagar mensajes" },
  { id: "action-api-key", label: "Cambiar API key del canal", description: "Credenciales y webhook de tu número", href: "/app/channels", section: "Configuración", keywords: "api key clave credenciales webhook token" },
  { id: "action-new-quote", label: "Nuevo presupuesto", description: "Crea un presupuesto para un cliente", href: "/app/quotes", section: "Ventas", keywords: "crear presupuesto cotizar cotizacion nuevo" },
  { id: "action-pay-plan", label: "Pagar mi suscripción", description: "Tarjeta, USDT o QR", href: "/app/settings/billing", section: "Configuración", keywords: "pagar cobro factura usdt qr renovar", access: "manage" },
];

/** Lowercase, strip accents and punctuation: "Suscripción" -> "suscripcion". */
export function normalize(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9ñ\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function words(text: string): string[] {
  const n = normalize(text);
  return n === "" ? [] : n.split(" ");
}

/** Levenshtein distance, bailing out early once it exceeds `max`. */
export function editDistance(a: string, b: string, max: number): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let rowMin = i;
    for (let j = 1; j <= b.length; j++) {
      const v = Math.min(prev[j]! + 1, cur[j - 1]! + 1, prev[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1));
      cur[j] = v;
      if (v < rowMin) rowMin = v;
    }
    if (rowMin > max) return max + 1;
    prev = cur;
  }
  return prev[b.length]!;
}

/** Match score of one query token against one field word (0 = no match). */
function tokenVsWord(token: string, word: string): number {
  if (token === word) return 10;
  if (word.startsWith(token)) return token.length >= 2 ? 8 : 4;
  if (token.length >= 3 && word.includes(token)) return 5;
  if (token.length >= 4) {
    const max = token.length >= 8 ? 2 : 1;
    const d = Math.min(editDistance(token, word, max), editDistance(token, word.slice(0, token.length), max) + 1);
    if (d <= max) return 6 - d;
  }
  return 0;
}

const WEIGHT = { label: 3, keywords: 2, section: 1, description: 1 } as const;

interface Indexed {
  entry: SearchEntry;
  fields: { weight: number; words: string[] }[];
  label: string;
}

function indexEntry(entry: SearchEntry): Indexed {
  return {
    entry,
    label: normalize(entry.label),
    fields: [
      { weight: WEIGHT.label, words: words(entry.label) },
      { weight: WEIGHT.keywords, words: entry.keywords.flatMap(words) },
      { weight: WEIGHT.section, words: words(entry.section) },
      { weight: WEIGHT.description, words: words(entry.description) },
    ],
  };
}

function scoreEntry(item: Indexed, tokens: string[], phrase: string): number {
  let total = 0;
  for (const token of tokens) {
    let best = 0;
    for (const field of item.fields) {
      for (const word of field.words) {
        const s = tokenVsWord(token, word) * field.weight;
        if (s > best) best = s;
      }
    }
    if (best === 0) return 0;
    total += best;
  }
  if (item.label === phrase) total += 40;
  else if (item.label.startsWith(phrase)) total += 20;
  return total;
}

/** Whether the role may see an entry; mirrors the page-level gates (roles.ts). */
export function canAccess(role: MembershipRole | undefined, access: SearchAccess): boolean {
  if (access === "all") return true;
  if (access === "ai") return canViewAi(role);
  return role === "owner" || role === "admin";
}

function fromNav(item: { label: string; href: string }, section: string): SearchEntry {
  const meta = META[item.href];
  return {
    id: item.href,
    label: item.label,
    description: meta?.description ?? "",
    href: item.href,
    section,
    keywords: meta ? meta.keywords.split(" ") : [],
    access: meta?.access ?? "all",
  };
}

/** Builds the full index: nav items (deduped by href) plus curated actions. */
export function buildSearchIndex(): SearchEntry[] {
  const seen = new Set<string>();
  const out: SearchEntry[] = [];
  const add = (e: SearchEntry) => {
    if (seen.has(e.id)) return;
    seen.add(e.id);
    out.push(e);
  };
  const walk = (items: readonly NavItem[], section: string) =>
    items.forEach((i) => {
      add(fromNav(i, section));
      if (i.children) walk(i.children, section);
    });
  for (const g of NAV_GROUPS) {
    if (g.href) add(fromNav({ label: g.label, href: g.href }, g.label));
    walk(g.children ?? [], g.label);
  }
  walk(NAV_SECONDARY, "Ayuda");
  walk(SETTINGS_SECTIONS, "Configuración");
  for (const a of ACTIONS) add({ ...a, keywords: a.keywords.split(" "), access: a.access ?? "all" });
  return out;
}

const INDEX = buildSearchIndex().map(indexEntry);

/** Fixed starter set for an empty query. */
const SUGGESTED = ["/app/inbox", "/app/contacts", "/app/quotes", "/app/agenda", "/app/settings/billing", "/app/channels"];

/** Entries shown with an empty query: the user's recent pages first, then the starter set. */
export function suggestedEntries(role: MembershipRole | undefined, recentHrefs: readonly string[] = [], limit = 6): SearchEntry[] {
  const visible = INDEX.filter((i) => canAccess(role, i.entry.access)).map((i) => i.entry);
  const ordered = [...recentHrefs, ...SUGGESTED].map((h) => visible.find((e) => e.id === h)).filter((e): e is SearchEntry => e !== undefined);
  return [...new Set(ordered)].slice(0, limit);
}

/** Ranks entries for a query, best first; empty query returns no results (use suggestedEntries). */
export function searchApp(query: string, role: MembershipRole | undefined, limit = 12): SearchResult[] {
  const tokens = words(query);
  if (tokens.length === 0) return [];
  const phrase = tokens.join(" ");
  return INDEX.filter((i) => canAccess(role, i.entry.access))
    .map((i) => ({ entry: i.entry, score: scoreEntry(i, tokens, phrase) }))
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score || a.entry.label.localeCompare(b.entry.label, "es"))
    .slice(0, limit);
}

/** Every route reachable from the nav, to test that the index covers it. */
export function navHrefs(): string[] {
  return [...NAV_GROUPS, ...NAV_SECONDARY].flatMap(collectHrefs);
}
