import { AlertCircle, BookOpen, Bot, CalendarDays, Target, Coins, Megaphone, ClipboardCheck, Code2, CreditCard, Receipt, Contact, Gauge, Inbox, Kanban, FileText, LifeBuoy, MessageSquareText, Package, Plug, Settings, LayoutTemplate, ShoppingBag, Smartphone, Sparkles, TrendingUp, Users, type LucideIcon } from "lucide-react";

export interface NavItem {
  key: string;
  label: string;
  href: string;
  icon: LucideIcon;
  children?: readonly NavItem[];
}

/** Subsections of Configuración, shown as sidebar sub-links and as tabs. */
export const SETTINGS_SECTIONS: readonly NavItem[] = [
  { key: "settings-ai", label: "IA", href: "/app/settings/ai", icon: Sparkles },
  { key: "settings-integrations", label: "Integraciones", href: "/app/settings/integrations", icon: Plug },
  { key: "settings-knowledge", label: "Conocimiento", href: "/app/settings/knowledge", icon: BookOpen },
  { key: "settings-approvals", label: "Aprobaciones", href: "/app/settings/approvals", icon: ClipboardCheck },
  { key: "settings-templates", label: "Plantillas", href: "/app/settings/templates", icon: LayoutTemplate },
  { key: "settings-currency", label: "Moneda", href: "/app/settings/currency", icon: Coins },
  { key: "settings-plan", label: "Plan y uso", href: "/app/settings/plan", icon: CreditCard },
  { key: "settings-ads", label: "Anuncios", href: "/app/settings/ads", icon: Megaphone },
  { key: "settings-developers", label: "Desarrolladores", href: "/app/settings/developers", icon: Code2 },
  { key: "settings-owner-mode", label: "Modo dueño", href: "/app/settings/owner-mode", icon: Smartphone },
];

/** Subsections of IA, shown as sidebar sub-links. */
export const AI_CHILDREN: readonly NavItem[] = [
  { key: "ai-runs", label: "Ejecuciones", href: "/app/ai/runs", icon: Bot },
  { key: "ai-handoffs", label: "Necesitan atención", href: "/app/ai/handoffs", icon: AlertCircle },
  { key: "ai-playbook", label: "Playbook de ventas", href: "/app/ai/playbook", icon: Target },
];

/** Tabs of the IA pages: the overview plus its subsections. */
export const AI_SECTIONS: readonly NavItem[] = [{ key: "ai-overview", label: "Resumen", href: "/app/ai", icon: Sparkles }, ...AI_CHILDREN];

/** Daily items, always visible. */
export const NAV_MAIN: readonly NavItem[] = [
  { key: "home", label: "Inicio", href: "/app", icon: Gauge },
  { key: "inbox", label: "Inbox", href: "/app/inbox", icon: Inbox },
  { key: "contacts", label: "Contactos", href: "/app/contacts", icon: Contact },
  { key: "pipeline", label: "Pipeline", href: "/app/pipeline", icon: Kanban },
  { key: "quotes", label: "Presupuestos", href: "/app/quotes", icon: FileText },
  { key: "orders", label: "Pedidos", href: "/app/orders", icon: ShoppingBag },
  { key: "agenda", label: "Agenda", href: "/app/agenda", icon: CalendarDays },
  { key: "ai", label: "IA", href: "/app/ai", icon: Sparkles, children: AI_CHILDREN },
];

/** Less frequent pages, grouped under a collapsible "Más" (collapsed unless the active route is inside). */
export const NAV_MORE: readonly NavItem[] = [
  { key: "payment-reviews", label: "Comprobantes", href: "/app/payments/reviews", icon: Receipt },
  { key: "analytics", label: "Rentabilidad", href: "/app/analytics", icon: TrendingUp },
  { key: "broadcasts", label: "Campañas", href: "/app/broadcasts", icon: Megaphone },
  { key: "products", label: "Productos", href: "/app/products", icon: Package },
  { key: "channels", label: "Canales", href: "/app/channels", icon: Plug },
  { key: "wa-templates", label: "Plantillas de WhatsApp", href: "/app/templates", icon: MessageSquareText },
  { key: "team", label: "Equipo", href: "/app/team", icon: Users },
];

export const NAV_SECONDARY: readonly NavItem[] = [
  { key: "settings", label: "Configuración", href: "/app/settings", icon: Settings, children: SETTINGS_SECTIONS },
  { key: "support", label: "Soporte", href: "/app/support", icon: LifeBuoy },
];

/** Active item from the path: `/app` only matches exactly, the rest match by prefix. */
export function isActive(pathname: string, href: string): boolean {
  return href === "/app" ? pathname === "/app" : pathname === href || pathname.startsWith(`${href}/`);
}

/** True when the path belongs to any page inside the "Más" group. */
export function isMoreActive(pathname: string): boolean {
  return NAV_MORE.some((i) => isActive(pathname, i.href));
}
