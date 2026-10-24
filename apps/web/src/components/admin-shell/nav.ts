import { Building2, ChartColumn, CreditCard, History, House, LifeBuoy, Mail, MessageSquareText, Plug, Receipt, Settings, UserCheck, Users, type LucideIcon } from "lucide-react";

export interface AdminNavItem {
  key: string;
  label: string;
  href: string;
  icon: LucideIcon;
}

export interface AdminNavGroup {
  id: string;
  /** Empty = untitled group, always open. */
  title: string;
  items: readonly AdminNavItem[];
}

export const ADMIN_BASE = "/app/admin";

/** SaaS backoffice menu (ADR 0011). Every item has a page; unknown routes are a real 404. */
export const ADMIN_NAV: readonly AdminNavGroup[] = [
  { id: "home", title: "", items: [{ key: "home", label: "Inicio", href: ADMIN_BASE, icon: House }] },
  {
    id: "platform",
    title: "PLATAFORMA",
    items: [
      { key: "tenants", label: "Empresas", href: `${ADMIN_BASE}/tenants`, icon: Building2 },
      { key: "approvals", label: "Aprobaciones", href: `${ADMIN_BASE}/approvals`, icon: UserCheck },
      { key: "users", label: "Usuarios", href: `${ADMIN_BASE}/users`, icon: Users },
      { key: "channels", label: "Canales BSP", href: `${ADMIN_BASE}/channels`, icon: Plug },
    ],
  },
  {
    id: "billing",
    title: "FACTURACIÓN",
    items: [
      { key: "payments", label: "Pagos", href: `${ADMIN_BASE}/payments`, icon: Receipt },
      { key: "plans", label: "Planes", href: `${ADMIN_BASE}/plans`, icon: CreditCard },
      { key: "usage", label: "Uso y consumo", href: `${ADMIN_BASE}/usage`, icon: ChartColumn },
    ],
  },
  {
    id: "support",
    title: "SOPORTE",
    items: [
      { key: "support", label: "Tickets", href: `${ADMIN_BASE}/support`, icon: LifeBuoy },
      { key: "email", label: "Correo", href: `${ADMIN_BASE}/email`, icon: Mail },
      { key: "canned", label: "Respuestas rápidas", href: `${ADMIN_BASE}/canned`, icon: MessageSquareText },
      { key: "audit", label: "Registro de actividad", href: `${ADMIN_BASE}/audit`, icon: History },
    ],
  },
  { id: "system", title: "SISTEMA", items: [{ key: "settings", label: "Configuración", href: `${ADMIN_BASE}/settings`, icon: Settings }] },
];

export const ADMIN_ITEMS: readonly AdminNavItem[] = ADMIN_NAV.flatMap((g) => g.items);

/** Active item: the longest matching href (so `/app/admin/tenants/1` activates "Empresas"). */
export function resolveActiveKey(pathname: string): string | null {
  const path = pathname.replace(/\/+$/, "") || "/";
  let best: AdminNavItem | null = null;
  for (const item of ADMIN_ITEMS) {
    const ok = item.href === ADMIN_BASE ? path === ADMIN_BASE : path === item.href || path.startsWith(`${item.href}/`);
    if (ok && (!best || item.href.length > best.href.length)) best = item;
  }
  return best?.key ?? null;
}

/** Accent-insensitive lowercase, for search. */
export function fold(text: string): string {
  return text.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

export function searchNav(query: string): readonly AdminNavItem[] {
  const needle = fold(query.trim());
  return ADMIN_ITEMS.filter((i) => needle === "" || fold(i.label).includes(needle));
}
