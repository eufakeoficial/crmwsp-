import { Lock } from "lucide-react";
import Link from "next/link";
import { Card, buttonClasses } from "@/components/ui";

export const GUPSHUP_PARTNER_PORTAL_URL = "https://partner.gupshup.io";

/** Shown when the channel has no Gupshup Partner "ID de app" + "Token de Partner" yet. */
export function MissingCredentialsCard({ phone }: { phone: string }) {
  return (
    <Card className="flex flex-col items-start gap-3">
      <p className="m-0 flex items-center gap-2 font-bold"><Lock aria-hidden className="size-4" />Falta conectar el perfil de {phone}</p>
      <p className="m-0 text-sm text-muted">
        Para editar el perfil desde aquí necesitamos el <b>ID de app</b> y el <b>Token de Partner</b> de tu cuenta de Gupshup. Se usan solo para enviar los cambios a WhatsApp.
      </p>
      <ol className="m-0 flex list-decimal flex-col gap-1 pl-5 text-sm">
        <li>
          Entra al{" "}
          <a href={GUPSHUP_PARTNER_PORTAL_URL} target="_blank" rel="noopener noreferrer" className="font-bold underline">
            portal de Gupshup Partner
          </a>{" "}
          e inicia sesión.
        </li>
        <li>Abre la app de tu número y copia el <b>ID de app</b>.</li>
        <li>En la misma app, genera o copia el <b>Token de Partner</b>.</li>
        <li>Vuelve a Canales y pégalos en «Configurar plantillas» de tu número.</li>
      </ol>
      <Link href="/app/channels" className={buttonClasses("accent", "mt-1", "sm")}>Ir a Canales</Link>
    </Card>
  );
}
