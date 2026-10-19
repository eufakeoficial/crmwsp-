import { Contact, Gauge, Inbox, Kanban, FileText, Plug, Settings, Users, type LucideIcon } from "lucide-react";

export interface NavItem {
  key: string;
  label: string;
  href: string;
  icon: LucideIcon;
}

export const NAV_MAIN: readonly NavItem[] = [
  { key: "home", label: "Inicio", href: "/app", icon: Gauge },
  { key: "inbox", label: "Inbox", href: "/app/inbox", icon: Inbox },
  { key: "contacts", label: "Contactos", href: "/app/contacts", icon: Contact },
  { key: "pipeline", label: "Pipeline", href: "/app/pipeline", icon: Kanban },
  { key: "quotes", label: "Presupuestos", href: "/app/quotes", icon: FileText },
  { key: "channels", label: "Canales", href: "/app/channels", icon: Plug },
  { key: "team", label: "Equipo", href: "/app/team", icon: Users },
];

export const NAV_SECONDARY: readonly NavItem[] = [
  { key: "settings", label: "Configuración", href: "/app/settings", icon: Settings },
];

/** Active item from the path: `/app` only matches exactly, the rest match by prefix. */
export function isActive(pathname: string, href: string): boolean {
  return href === "/app" ? pathname === "/app" : pathname === href || pathname.startsWith(`${href}/`);
}
