import type { Metadata } from "next";
import { cookies } from "next/headers";
import Link from "next/link";
import { SiteFooter } from "@/components/site/SiteFooter";
import { SiteHeader } from "@/components/site/SiteHeader";

export const metadata: Metadata = {
  title: "Vende+ Connector para WooCommerce",
  description: "Plugin gratuito de WordPress que conecta tu tienda WooCommerce con Vende+ mediante un código de conexión de un solo uso.",
  alternates: { canonical: "/integraciones/woocommerce" },
};

// Keep in sync with SESSION_COOKIE in apps/api/src/auth/session-token.ts (presence check only).
const SESSION_COOKIE = "__Host-crmwsp_session";

const STEPS = [
  "Descarga el plugin e instálalo en WordPress desde Plugins → Añadir nuevo → Subir plugin.",
  "En Vende+, ve a Configuración → Integraciones → WooCommerce y pulsa «Generar código de conexión».",
  "En WordPress, abre WooCommerce → Vende+, pega el código y pulsa «Conectar».",
];

/** Public page for the WordPress plugin: what it does, how to install it and where to download it. */
export default async function WooCommercePluginPage() {
  const hasSession = (await cookies()).has(SESSION_COOKIE);
  return (
    <>
      <SiteHeader hasSession={hasSession} />
      <main className="container-page flex flex-col gap-10 py-[clamp(40px,6vw,80px)]">
        <section className="flex max-w-3xl flex-col gap-4">
          <p className="m-0 text-sm font-bold text-royal">Plugin de WordPress</p>
          <h1 className="m-0 text-[clamp(32px,5vw,52px)] leading-tight">Vende+ Connector para WooCommerce</h1>
          <p className="m-0 text-lg text-muted">
            Conecta tu tienda WooCommerce con Vende+, el CRM de WhatsApp con IA, sin copiar claves a mano. Generas un código en Vende+, lo pegas en el plugin y listo.
          </p>
          <div className="flex flex-wrap gap-3">
            <a href="/downloads/vendemas-connector.zip" download className="inline-flex h-11 items-center rounded-full bg-ink px-6 font-bold text-white no-underline hover:bg-royal">
              Descargar plugin (.zip)
            </a>
            <Link href="/signup" className="inline-flex h-11 items-center rounded-full border border-line px-6 font-bold text-ink no-underline hover:border-ink">
              Crear cuenta en Vende+
            </Link>
          </div>
          <p className="m-0 text-sm text-muted">Gratuito, licencia GPLv2. Requiere WordPress 6.2+, PHP 7.4+ y WooCommerce.</p>
        </section>

        <section className="flex max-w-3xl flex-col gap-3">
          <h2 className="m-0 text-2xl">Cómo se instala</h2>
          <ol className="m-0 flex list-decimal flex-col gap-2 pl-5">
            {STEPS.map((s) => (
              <li key={s}>{s}</li>
            ))}
          </ol>
        </section>

        <section className="flex max-w-3xl flex-col gap-3">
          <h2 className="m-0 text-2xl">Qué hace el plugin</h2>
          <ul className="m-0 flex list-disc flex-col gap-2 pl-5">
            <li>Crea una clave de API REST de WooCommerce de solo lectura para que Vende+ consulte tu catálogo.</li>
            <li>Registra webhooks de pedidos y productos para que tu asistente de IA conozca el estado de cada compra.</li>
            <li>No envía ningún dato hasta que tú pegas el código y pulsas «Conectar». Al desconectar, borra la clave y los webhooks.</li>
            <li>El código caduca a los 15 minutos y sirve una sola vez. Puedes revocar la conexión desde Vende+ cuando quieras.</li>
          </ul>
        </section>
      </main>
      <SiteFooter />
    </>
  );
}
