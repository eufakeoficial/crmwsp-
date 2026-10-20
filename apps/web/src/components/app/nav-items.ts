import { BookOpen, Megaphone, ClipboardCheck, Code2, CreditCard, Receipt, Contact, Gauge, Inbox, Kanban, FileText, Package, Plug, Settings, LayoutTemplate, ShoppingBag, Sparkles, Users, type LucideIcon } from "lucide-react";

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
  { key: "settings-plan", label: "Plan y uso", href: "/app/settings/plan", icon: CreditCard },
  { key: "settings-ads", label: "Anuncios", href: "/app/settings/ads", icon: Megaphone },
  { key: "settings-developers", label: "Desarrolladores", href: "/app/settings/developers", icon: Code2 },
];

export const NAV_MAIN: readonly NavItem[] = [
  { key: "home", label: "Inicio", href: "/app", icon: Gauge },
  { key: "inbox", label: "Inbox", href: "/app/inbox", icon: Inbox },
  { key: "contacts", label: "Contactos", href: "/app/contacts", icon: Contact },
  { key: "pipeline", label: "Pipeline", href: "/app/pipeline", icon: Kanban },
  { key: "quotes", label: "Presupuestos", href: "/app/quotes", icon: FileText },
  { key: "orders", label: "Pedidos", href: "/app/orders", icon: ShoppingBag },
  { key: "payment-reviews", label: "Comprobantes", href: "/app/payments/reviews", icon: Receipt },
  { key: "broadcasts", label: "Campañas", href: "/app/broadcasts", icon: Megaphone },
  { key: "products", label: "Productos", href: "/app/products", icon: Package },
  { key: "channels", label: "Canales", href: "/app/channels", icon: Plug },
  { key: "team", label: "Equipo", href: "/app/team", icon: Users },
];

export const NAV_SECONDARY: readonly NavItem[] = [
  { key: "settings", label: "Configuración", href: "/app/settings", icon: Settings, children: SETTINGS_SECTIONS },
];

/** Active item from the path: `/app` only matches exactly, the rest match by prefix. */
export function isActive(pathname: string, href: string): boolean {
  return href === "/app" ? pathname === "/app" : pathname === href || pathname.startsWith(`${href}/`);
}
