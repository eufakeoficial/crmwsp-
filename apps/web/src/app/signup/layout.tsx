import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  title: "Crear cuenta gratis",
  description: "Crea tu cuenta en Vende+ WSP, conecta tu WhatsApp y empieza a responder con IA, cotizar y cobrar con pagos verificados.",
  alternates: { canonical: "/signup" },
};

export default function SignupLayout({ children }: { children: ReactNode }) {
  return children;
}
