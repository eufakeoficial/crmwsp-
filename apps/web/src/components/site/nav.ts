export interface SiteNavItem {
  href: string;
  label: string;
}

/** Placeholder anchors for the future landing. */
export const SITE_NAV: readonly SiteNavItem[] = [
  { href: "/#beneficios", label: "Beneficios" },
  { href: "/#preguntas", label: "Preguntas" },
];

export interface FooterColumn {
  title: string;
  links: readonly SiteNavItem[];
}

export const FOOTER_COLUMNS: readonly FooterColumn[] = [
  { title: "Producto", links: [{ href: "/#beneficios", label: "Beneficios" }, { href: "/#preguntas", label: "Preguntas frecuentes" }, { href: "/signup", label: "Crear cuenta" }] },
  { title: "Cuenta", links: [{ href: "/login", label: "Ingresar" }, { href: "/signup", label: "Registrar mi empresa" }] },
  { title: "CRMWSP", links: [{ href: "#", label: "Nosotros" }, { href: "#", label: "Contacto" }, { href: "#", label: "Términos y privacidad" }] },
];
