import type { ReactNode } from "react";
import { AppShell } from "@/components/app/AppShell";
import { SessionProvider } from "@/components/app/SessionProvider";

export default function AppLayout({ children }: { children: ReactNode }) {
  return (
    <SessionProvider>
      <AppShell>{children}</AppShell>
    </SessionProvider>
  );
}
