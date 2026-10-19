import type { ReactNode } from "react";
import { Card } from "@/components/ui";

export function PageHeader({ title }: { title: string }) {
  return <h1 className="mb-6 text-2xl font-semibold">{title}</h1>;
}

export function EmptyState({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <Card className="flex flex-col items-center py-12 text-center">
      <p className="text-lg font-medium">{title}</p>
      {children ? <p className="mt-2 max-w-md text-sm text-zinc-600 dark:text-zinc-400">{children}</p> : null}
    </Card>
  );
}
