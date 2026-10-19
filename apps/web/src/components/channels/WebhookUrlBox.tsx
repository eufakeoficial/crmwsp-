"use client";

import { Copy } from "lucide-react";
import { Button } from "@/components/ui";
import { useToast } from "@/lib/hooks/use-toast";
import { Toast } from "@/components/ui";

/** Read-only webhook URL with a "Copiar" button. */
export function WebhookUrlBox({ url }: { url: string }) {
  const { message, show } = useToast();
  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      show("URL copiada");
    } catch {
      show("No se pudo copiar: selecciónala y cópiala a mano");
    }
  }
  return (
    <div className="flex flex-col gap-2">
      <code data-testid="webhook-url" className="block rounded-2xl bg-paper px-3 py-2.5 text-[13px] break-all">{url}</code>
      <Button size="sm" variant="outline" className="self-start" onClick={copy}>
        <Copy aria-hidden className="size-4" />Copiar
      </Button>
      <Toast message={message} />
    </div>
  );
}
