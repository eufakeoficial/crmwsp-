import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  title: "Recuperar contraseña",
  robots: { index: false, follow: true },
};

export default function ForgotPasswordLayout({ children }: { children: ReactNode }) {
  return children;
}
