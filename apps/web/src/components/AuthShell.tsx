import type { ReactNode } from "react";
import { Card } from "./ui";

export function AuthShell({ title, subtitle, children }: { title: string; subtitle?: string; children: ReactNode }) {
  return (
    <main className="flex min-h-screen items-center justify-center px-4 py-8">
      <div className="w-full max-w-md space-y-6">
        <p className="text-center text-xl font-semibold tracking-wide">CRMWSP</p>
        <Card>
          <h1 className="text-lg font-semibold">{title}</h1>
          {subtitle ? <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">{subtitle}</p> : null}
          <div className="mt-6">{children}</div>
        </Card>
      </div>
    </main>
  );
}
