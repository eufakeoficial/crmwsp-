export interface SiteNavItem {
  href: string;
  label: string;
}

/** Landing anchors, listed in page order so the menu scrolls top to bottom. */
export const SITE_NAV: readonly SiteNavItem[] = [
  { href: "/#demo-venta", label: "Demo" },
  { href: "/#beneficios", label: "Beneficios" },
  { href: "/#como-funciona", label: "Cómo funciona" },
  { href: "/#precios", label: "Precios" },
  { href: "/#preguntas", label: "Preguntas" },
];

export interface FooterColumn {
  title: string;
  links: readonly SiteNavItem[];
}

export const FOOTER_COLUMNS: readonly FooterColumn[] = [
  { title: "Producto", links: [{ href: "/#beneficios", label: "Beneficios" }, { href: "/#preguntas", label: "Preguntas frecuentes" }, { href: "/signup", label: "Crear cuenta" }] },
  { title: "Cuenta", links: [{ href: "/login", label: "Ingresar" }, { href: "/signup", label: "Registrar mi empresa" }] },
  { title: "Vende+ WSP", links: [{ href: "#", label: "Nosotros" }, { href: "#", label: "Contacto" }, { href: "#", label: "Términos y privacidad" }] },
];
