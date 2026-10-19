import type { ReactNode } from "react";
import { SessionProvider } from "@/components/app/SessionProvider";

export default function AppLayout({ children }: { children: ReactNode }) {
  return <SessionProvider>{children}</SessionProvider>;
}
