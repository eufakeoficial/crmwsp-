import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  title: "Ingresar",
  description: "Ingresa a tu cuenta de Vende+ WSP para atender WhatsApp con tu equipo y la IA.",
  alternates: { canonical: "/login" },
};

export default function LoginLayout({ children }: { children: ReactNode }) {
  return children;
}
