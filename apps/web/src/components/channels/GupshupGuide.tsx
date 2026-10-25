"use client";

import { ExternalLink, Plug } from "lucide-react";
import type { ReactNode } from "react";
import { Accordion, type AccordionItem, Alert, Button, Card } from "@/components/ui";
import { GUPSHUP_SIGNUP_URL } from "./ConnectChannelPanel";

interface GuideStep {
  title: string;
  body: ReactNode;
}

// UI paths below were checked against docs.gupshup.io / support.gupshup.io. Anything not documented is phrased generically.
const STEPS: GuideStep[] = [
  {
    title: "Antes de empezar: prepara tu número",
    body: (
      <ul className="m-0 flex list-disc flex-col gap-1 pl-5">
        <li>Usa un número que pueda recibir un SMS o una llamada: Meta te enviará un código de verificación.</li>
        <li>Si ese número ya está registrado en la app normal de WhatsApp o WhatsApp Business, tendrás que eliminar esa cuenta antes (Ajustes → Cuenta → Eliminar cuenta). Un número no puede estar en la app y en la API a la vez.</li>
        <li>Ten a mano los datos de tu empresa (nombre legal, sitio web o página) y acceso a tu cuenta de Facebook. Meta puede pedir la verificación de empresa antes de poner tu app en vivo.</li>
      </ul>
    ),
  },
  {
    title: "Crea tu cuenta en Gupshup",
    body: (
      <>
        <p className="m-0">Regístrate con tu correo o con una cuenta de Google, Facebook o GitHub. Cada correo sirve para una sola cuenta. Si te llega un código por correo, escríbelo para continuar.</p>
        <a
          href={GUPSHUP_SIGNUP_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-2 self-start rounded-full bg-ink px-5 py-2.5 text-sm font-extrabold text-white no-underline"
        >
          <ExternalLink aria-hidden className="size-4" />Crear cuenta en Gupshup<span className="sr-only"> (se abre en otra pestaña)</span>
        </a>
      </>
    ),
  },
  {
    title: "Crea la app de WhatsApp",
    body: (
      <ol className="m-0 flex list-decimal flex-col gap-1 pl-5">
        <li>Dentro de Gupshup, abre el menú <b>Dashboard</b> y elige <b>WhatsApp</b>.</li>
        <li>Pulsa <b>Create your first app</b> (o <b>Create App</b> y luego <b>Access API</b> si ya tienes otras).</li>
        <li>Escribe un nombre: mínimo 6 caracteres, sin espacios ni símbolos, y único en Gupshup. Por ejemplo <code>MiEmpresaApp</code>. Es solo para ti: no se muestra a tus clientes.</li>
        <li>Envía el formulario y pulsa <b>Go to Dashboard</b>.</li>
      </ol>
    ),
  },
  {
    title: "Registra y verifica tu número con Meta",
    body: (
      <ol className="m-0 flex list-decimal flex-col gap-1 pl-5">
        <li>En el dashboard de WhatsApp, elige tu app y pulsa <b>Go Live</b> (si ya habías empezado, puede decir <b>Complete FB Registration</b>).</li>
        <li>Inicia sesión con Facebook y elige o crea tu cuenta de Meta Business. Si alguien de tu empresa ya tiene una verificada, pídele que te agregue como administrador.</li>
        <li>Escribe el número de WhatsApp Business y confirma el código que Meta envía por SMS o llamada (OTP).</li>
        <li>Indica el nombre para mostrar y la categoría de tu negocio. Meta revisa el nombre: debe corresponder a tu marca real.</li>
        <li>Confirma el número y pulsa <b>Go to dashboard</b>. Si Meta pide verificación de empresa, sigue sus pasos; puede tardar de unas horas a varios días.</li>
      </ol>
    ),
  },
  {
    title: "Copia tus datos de Gupshup",
    body: (
      <>
        <p className="m-0">Abre los detalles de tu app en Gupshup y copia estos valores en el formulario de CRMWSP:</p>
        <ul className="m-0 flex list-disc flex-col gap-1 pl-5">
          <li><b>Nombre de la app:</b> el que escribiste al crearla (por ejemplo <code>MiEmpresaApp</code>).</li>
          <li><b>API key:</b> en los detalles de tu app busca la clave de API (&quot;API key&quot;). Se guarda cifrada en CRMWSP.</li>
          <li><b>ID de app (opcional):</b> el identificador de tu app; en la sección de tu app busca &quot;App ID&quot;.</li>
          <li><b>Token de Partner (opcional):</b> en los detalles de tu app busca el token de la app (&quot;App token&quot;). Junto con el ID de app permite crear y sincronizar plantillas; completa los dos o ninguno.</li>
        </ul>
        <p className="m-0 text-muted">Los nombres exactos de los menús pueden cambiar. Si no ves un dato, busca en los ajustes o detalles de tu app, o consulta el soporte de Gupshup.</p>
      </>
    ),
  },
  {
    title: "Conecta el canal y pega la URL de webhook",
    body: (
      <ol className="m-0 flex list-decimal flex-col gap-1 pl-5">
        <li>Pulsa el botón de abajo, llena el formulario de CRMWSP y conecta el canal. Te mostraremos la URL de webhook y podrás copiarla.</li>
        <li>En Gupshup, en el dashboard de WhatsApp pulsa <b>Overview</b> junto a tu app y abre la pestaña <b>Webhooks</b>.</li>
        <li>Pega la URL en <b>Callback URL</b> y pulsa <b>Add Webhook</b>. Si te deja elegir eventos, deja activos los mensajes entrantes y los estados.</li>
        <li>Envía un mensaje de prueba al número: debería aparecer en tu Inbox.</li>
      </ol>
    ),
  },
];

const FAQ: AccordionItem[] = [
  {
    question: "Me dice que el número ya está en WhatsApp",
    answer:
      "Un número no puede estar a la vez en la app de WhatsApp (normal o Business) y en la API. Guarda tus chats si los necesitas, elimina la cuenta desde la app (Ajustes → Cuenta → Eliminar cuenta) y vuelve a registrar el número. También puedes usar otro número nuevo.",
  },
  {
    question: "No me llega el código (OTP)",
    answer:
      "Verifica que el número reciba SMS o llamadas, espera unos minutos y pide el código por llamada si la opción aparece. Si falla varias veces, Meta puede bloquear los intentos por un tiempo: espera e inténtalo de nuevo.",
  },
  {
    question: "Meta pide verificación de empresa",
    answer:
      "Es habitual antes de poner la app en vivo. Se hace en tu cuenta de Meta Business con datos y documentos de tu empresa y puede tardar de horas a varios días. Mientras tanto puedes dejar lista la configuración en CRMWSP.",
  },
  {
    question: "¿Cuánto cuesta y cómo cargo saldo?",
    answer:
      "Gupshup y Meta cobran por separado de CRMWSP, según su tarifa vigente y el tipo de conversación o mensaje. Revisa los precios y cómo recargar créditos o saldo en tu cuenta de Gupshup antes de enviar mensajes en volumen.",
  },
  {
    question: "¿Por qué no puedo escribirle a un cliente?",
    answer:
      "WhatsApp solo permite responder libremente dentro de las 24 horas posteriores al último mensaje del cliente. Fuera de esa ventana debes usar una plantilla aprobada por Meta.",
  },
  {
    question: "¿Cómo se aprueban las plantillas?",
    answer:
      "Creas la plantilla (desde CRMWSP si cargaste el ID de app y el token de Partner, o desde Gupshup) y Meta la revisa; suele tardar de minutos a horas. Si la rechazan, ajusta el texto, evita contenido engañoso y vuelve a enviarla.",
  },
  {
    question: "No me llegan mensajes al Inbox",
    answer:
      "Confirma que pegaste la URL completa en Callback URL y que la agregaste con Add Webhook. Si rotaste el token del webhook, la URL anterior dejó de funcionar: pega la nueva.",
  },
];

/** Beginner-friendly walkthrough for creating a Gupshup account and WhatsApp app. */
export function GupshupGuide({ onConnect, canConnect }: { onConnect: () => void; canConnect: boolean }) {
  return (
    <div className="flex flex-col gap-5" data-testid="gupshup-guide">
      <Card className="flex flex-col gap-2">
        <h2 className="m-0 text-xl font-extrabold">Guía paso a paso</h2>
        <p className="m-0 text-sm text-muted">
          Para quien nunca ha usado Gupshup ni la API de WhatsApp Business. Puede tomar desde unos 20 minutos hasta un par de días, según la verificación de Meta.
        </p>
      </Card>
      <Card>
        <ol className="m-0 flex list-none flex-col gap-6 p-0">
          {STEPS.map((step, i) => (
            <li key={step.title} className="flex items-start gap-3">
              <span aria-hidden className="grid size-7 flex-none place-items-center rounded-full bg-lime text-[13px] font-extrabold text-ink">{i + 1}</span>
              <div className="flex min-w-0 flex-1 flex-col gap-2 pt-0.5 text-sm">
                <h3 className="m-0 text-base font-bold"><span className="sr-only">Paso {i + 1}: </span>{step.title}</h3>
                {step.body}
              </div>
            </li>
          ))}
        </ol>
      </Card>
      <Card>
        <h2 className="m-0 mb-2 text-xl font-extrabold">Preguntas frecuentes</h2>
        <Accordion items={FAQ} initialOpen={-1} />
      </Card>
      {canConnect ? (
        <Card className="flex flex-col items-start gap-3">
          <b>¿Ya tienes tu app lista?</b>
          <Button variant="whatsapp" onClick={onConnect}>
            <Plug aria-hidden className="size-5" />Abrir el formulario de conexión
          </Button>
        </Card>
      ) : (
        <Alert>Solo un administrador puede conectar canales, y el correo del propietario debe estar verificado. Comparte esta guía con quien administre la cuenta.</Alert>
      )}
    </div>
  );
}
