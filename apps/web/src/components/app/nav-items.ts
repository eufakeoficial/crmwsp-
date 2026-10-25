import { AlertCircle, BookOpen, Bot, CalendarDays, Target, Coins, Megaphone, ClipboardCheck, Code2, CreditCard, Receipt, Contact, Gauge, Inbox, Kanban, FileText, LifeBuoy, MessageSquareText, Rocket, Package, Plug, Settings, Users2, Workflow, LayoutTemplate, ShoppingBag, Smartphone, Sparkles, TrendingUp, Users, type LucideIcon } from "lucide-react";

export interface NavItem {
  key: string;
  label: string;
  href: string;
  icon: LucideIcon;
  children?: readonly NavItem[];
}

/** Top-level entry: a plain link (`href`) or a disclosure group (`children`); both may coexist (Inbox, IA). */
export interface NavGroup {
  key: string;
  label: string;
  icon: LucideIcon;
  href?: string;
  children?: readonly NavItem[];
}

/** Subsections of Configuración, shown as sidebar sub-links and as tabs. */
export const SETTINGS_SECTIONS: readonly NavItem[] = [
  { key: "settings-ai", label: "IA", href: "/app/settings/ai", icon: Sparkles },
  { key: "settings-integrations", label: "Integraciones", href: "/app/settings/integrations", icon: Plug },
  { key: "settings-knowledge", label: "Conocimiento", href: "/app/settings/knowledge", icon: BookOpen },
  { key: "settings-approvals", label: "Aprobaciones de IA", href: "/app/settings/approvals", icon: ClipboardCheck },
  { key: "settings-templates", label: "Plantillas de negocio", href: "/app/settings/templates", icon: LayoutTemplate },
  { key: "settings-currency", label: "Moneda", href: "/app/settings/currency", icon: Coins },
  { key: "settings-plan", label: "Plan y uso", href: "/app/settings/plan", icon: CreditCard },
  { key: "settings-ads", label: "Anuncios", href: "/app/settings/ads", icon: Megaphone },
  { key: "settings-developers", label: "Claves de API", href: "/app/settings/developers", icon: Code2 },
  { key: "settings-owner-mode", label: "Control por WhatsApp", href: "/app/settings/owner-mode", icon: Smartphone },
];

/** Subsections of IA, shown as sidebar sub-links. */
export const AI_CHILDREN: readonly NavItem[] = [
  { key: "ai-runs", label: "Historial de la IA", href: "/app/ai/runs", icon: Bot },
  { key: "ai-handoffs", label: "Necesitan atención", href: "/app/ai/handoffs", icon: AlertCircle },
  { key: "ai-playbook", label: "Guion de ventas", href: "/app/ai/playbook", icon: Target },
];

/** Tabs of the IA pages: the overview plus its subsections. */
export const AI_SECTIONS: readonly NavItem[] = [{ key: "ai-overview", label: "Resumen", href: "/app/ai", icon: Sparkles }, ...AI_CHILDREN];

/** IA sub-links in the sidebar; "Necesitan atención" lives under Inbox there, but stays in AI_SECTIONS tabs. */
const AI_NAV_CHILDREN: readonly NavItem[] = AI_CHILDREN.filter((i) => i.key !== "ai-handoffs");

/** Single source of truth of the main navigation: 7 top-level entries. */
export const NAV_GROUPS: readonly NavGroup[] = [
  { key: "home", label: "Inicio", href: "/app", icon: Gauge },
  {
    key: "inbox",
    label: "Inbox",
    href: "/app/inbox",
    icon: Inbox,
    children: [{ key: "ai-handoffs", label: "Necesitan atención", href: "/app/ai/handoffs", icon: AlertCircle }],
  },
  {
    key: "clients",
    label: "Clientes",
    icon: Users2,
    children: [
      { key: "contacts", label: "Contactos", href: "/app/contacts", icon: Contact },
      { key: "pipeline", label: "Pipeline", href: "/app/pipeline", icon: Kanban },
    ],
  },
  {
    key: "sales",
    label: "Ventas",
    icon: ShoppingBag,
    children: [
      { key: "quotes", label: "Presupuestos", href: "/app/quotes", icon: FileText },
      { key: "orders", label: "Pedidos", href: "/app/orders", icon: ShoppingBag },
      { key: "payment-reviews", label: "Comprobantes", href: "/app/payments/reviews", icon: Receipt },
      { key: "analytics", label: "Rentabilidad", href: "/app/analytics", icon: TrendingUp },
    ],
  },
  { key: "agenda", label: "Agenda", href: "/app/agenda", icon: CalendarDays },
  {
    key: "automate",
    label: "Automatizar",
    icon: Workflow,
    children: [
      { key: "ai", label: "IA", href: "/app/ai", icon: Sparkles, children: AI_NAV_CHILDREN },
      { key: "settings-ai", label: "Ajustes de la IA", href: "/app/settings/ai", icon: Sparkles },
      { key: "settings-knowledge", label: "Conocimiento", href: "/app/settings/knowledge", icon: BookOpen },
      { key: "settings-approvals", label: "Aprobaciones de IA", href: "/app/settings/approvals", icon: ClipboardCheck },
      { key: "broadcasts", label: "Campañas", href: "/app/broadcasts", icon: Megaphone },
      { key: "wa-templates", label: "Plantillas de WhatsApp", href: "/app/templates", icon: MessageSquareText },
    ],
  },
  {
    key: "settings",
    label: "Configuración",
    icon: Settings,
    children: [
      { key: "channels", label: "WhatsApp", href: "/app/channels", icon: Plug },
      { key: "products", label: "Catálogo", href: "/app/products", icon: Package },
      { key: "team", label: "Equipo", href: "/app/team", icon: Users },
      { key: "settings-integrations", label: "Integraciones", href: "/app/settings/integrations", icon: Plug },
      { key: "settings-currency", label: "Moneda", href: "/app/settings/currency", icon: Coins },
      { key: "settings-plan", label: "Plan y uso", href: "/app/settings/plan", icon: CreditCard },
      { key: "settings-templates", label: "Plantillas de negocio", href: "/app/settings/templates", icon: LayoutTemplate },
      { key: "settings-developers", label: "Claves de API", href: "/app/settings/developers", icon: Code2 },
      { key: "settings-ads", label: "Anuncios", href: "/app/settings/ads", icon: Megaphone },
      { key: "settings-owner-mode", label: "Control por WhatsApp", href: "/app/settings/owner-mode", icon: Smartphone },
    ],
  },
];

/** Footer entries below the groups. */
export const NAV_SECONDARY: readonly NavItem[] = [
  { key: "support", label: "Soporte", href: "/app/support", icon: LifeBuoy },
  { key: "onboarding", label: "Puesta en marcha", href: "/app/onboarding", icon: Rocket },
];

/** Active item from the path: `/app` only matches exactly, the rest match by prefix. */
export function isActive(pathname: string, href: string): boolean {
  return href === "/app" ? pathname === "/app" : pathname === href || pathname.startsWith(`${href}/`);
}

type Linkable = { href?: string | undefined; children?: readonly NavItem[] | undefined };

/** Every href inside an entry, itself included. */
export function collectHrefs(entry: Linkable): string[] {
  return [...(entry.href ? [entry.href] : []), ...(entry.children ?? []).flatMap(collectHrefs)];
}

/** The one href that is "the current page": the longest nav href matching the path (avoids double highlight). */
export function getActiveHref(pathname: string): string | null {
  const all = [...NAV_GROUPS, ...NAV_SECONDARY].flatMap(collectHrefs).filter((h) => isActive(pathname, h));
  return all.sort((a, b) => b.length - a.length)[0] ?? null;
}

/** True when the active page lives anywhere inside the entry (used to auto-expand groups). */
export function containsActive(entry: Linkable, activeHref: string | null): boolean {
  return activeHref !== null && collectHrefs(entry).includes(activeHref);
}

/** First reachable href of a group (rail icons link here). */
export function groupHref(group: NavGroup): string {
  return collectHrefs(group)[0] ?? "/app";
}
