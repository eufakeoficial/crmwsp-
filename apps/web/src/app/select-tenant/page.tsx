"use client";

import { useRouter } from "next/navigation";
import { AuthShell } from "@/components/AuthShell";
import { SessionProvider, useSession } from "@/components/app/SessionProvider";
import { Button } from "@/components/ui";

import { ROLE_LABELS } from "@/components/app/roles";

function TenantList() {
  const router = useRouter();
  const { me, selectTenant } = useSession();

  if (me.tenants.length === 0) {
    return <p className="text-sm">Tu cuenta no pertenece a ninguna empresa.</p>;
  }
  return (
    <ul className="space-y-2">
      {me.tenants.map((t) => (
        <li key={t.id}>
          <Button
            variant="outline"
            className="w-full justify-between"
            onClick={() => {
              selectTenant(t.id);
              router.replace("/app/inbox");
            }}
          >
            <span>{t.name}</span>
            <span className="text-xs font-normal text-muted">{ROLE_LABELS[t.role]}</span>
          </Button>
        </li>
      ))}
    </ul>
  );
}

export default function SelectTenantPage() {
  return (
    <SessionProvider requireTenant={false}>
      <AuthShell title="Elige una empresa" subtitle="Tu cuenta pertenece a varias empresas.">
        <TenantList />
      </AuthShell>
    </SessionProvider>
  );
}
