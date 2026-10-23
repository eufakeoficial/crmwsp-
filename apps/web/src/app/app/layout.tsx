import type { Metadata } from "next";
import type { ReactNode } from "react";
import { SessionProvider } from "@/components/app/SessionProvider";

// Logged-in panel and platform admin (nested layouts inherit this): never indexed.
export const metadata: Metadata = {
  title: { absolute: "Panel | Vende+ WSP" },
  robots: { index: false, follow: false, nocache: true },
};

export default function AppLayout({ children }: { children: ReactNode }) {
  return <SessionProvider>{children}</SessionProvider>;
}
