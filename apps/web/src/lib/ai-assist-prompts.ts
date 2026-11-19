/**
 * Prompts for the "Hacerlo con IA" button. Each builder takes ONLY non-secret tenant data
 * (app name, phone, channel id) and returns neutral-Spanish text meant to be pasted
 * into an AI browser assistant. They never accept or mention secret values: the AI must stop and
 * hand control back to the user for keys, logins, captchas and payments. The webhook URL is also a
 * secret (its path token is the only auth of inbound webhooks), so it is never embedded: the AI stops
 * and the user pastes it themselves.
 */

export const GUPSHUP_CONSOLE_URL = "https://www.gupshup.io/whatsapp/dashboard";
export const GUPSHUP_WALLET_URL = "https://www.gupshup.io/developer/billing";
export const GUPSHUP_PARTNER_URL = "https://partner.gupshup.io";
export const META_WHATSAPP_MANAGER_URL = "https://business.facebook.com/wa/manage/phone-numbers/";

const RULES = [
  "Reglas:",
  "- Nunca escribas, inventes ni adivines contraseñas, claves de API ni tokens.",
  "- Cuando haga falta iniciar sesión, resolver un captcha, pegar una clave o pagar, detente y pídeme que lo haga yo. Continúa cuando te diga que terminé.",
  "- No hagas ningún pago ni aceptes cobros.",
].join("\n");

function compose(title: string, context: string[], steps: string[], check: string): string {
  const numbered = [...steps, check].map((s, i) => `${i + 1}. ${s}`).join("\n");
  return [title, "", ...context, "", RULES, "", "Pasos:", numbered].join("\n");
}

const PASTE_WEBHOOK_STEP =
  "Cuando te lo pida, pega aquí la URL de webhook que copiaste en Vende+ (botón Copiar): detente y pídeme que yo la pegue; no la escribas ni la adivines.";

function appLine(appName: string | null | undefined): string {
  return appName ? `Nombre de mi app en Gupshup: ${appName}` : "Nombre de mi app en Gupshup: (si no lo sabes, pregúntamelo)";
}

/** P1: set up the webhook (callback URL) in Gupshup. */
export function buildWebhookPrompt(input: { appName?: string | null | undefined }): string {
  return compose(
    "Ayúdame a configurar el webhook de mi app de WhatsApp en Gupshup.",
    [appLine(input.appName), "La URL de webhook es privada y no te la doy ahora: te la pediré cuando haga falta."],
    [
      `Abre ${GUPSHUP_CONSOLE_URL}. Si no he iniciado sesión, detente y pídeme que inicie sesión.`,
      "Entra a la app de WhatsApp con el nombre indicado arriba (verifica que sea la correcta) y abre su sección de Webhooks (Overview → Webhooks).",
      PASTE_WEBHOOK_STEP,
      "Agrega un webhook con esa URL exacta, sin espacios ni caracteres extra.",
      'En el formato elige "Gupshup (v2)".',
      "Marca estos eventos: Mensaje, Enviado, Entregado, Leído y Error.",
      "Deja el interruptor del webhook encendido y guarda.",
    ],
    "Recarga la página, vuelve a abrir la sección de Webhooks y confirma que la URL guardada coincide exactamente con la que pegué, que el formato es Gupshup (v2), que los cinco eventos están marcados y que el interruptor está encendido. Dime el resultado.",
  );
}

/** P2: create the app API key in Gupshup and bring the user back to paste it into Vende+. */
export function buildApiKeyPrompt(input: { appName?: string | null | undefined }): string {
  return compose(
    "Ayúdame a obtener la clave de API de mi app de WhatsApp en Gupshup.",
    [appLine(input.appName)],
    [
      `Abre ${GUPSHUP_CONSOLE_URL}. Si no he iniciado sesión, detente y pídeme que inicie sesión.`,
      "Entra a la app con el nombre indicado arriba (verifica que sea la correcta) y abre Claves de API.",
      "Genera o muestra la clave de la app. No la copies a ningún otro sitio, no la escribas en el chat y no la pegues tú.",
      "Detente y pídeme que yo copie la clave y la pegue en el formulario de Canales de Vende+. No aceptes ni uses el autocompletado del navegador en ese campo.",
      "Recuérdame que debo comprobar que el campo contiene la clave de la app y no una contraseña guardada por el navegador.",
    ],
    "Recarga la pantalla de Canales de Vende+ y confirma que el canal muestra los últimos 4 caracteres de la clave y que coinciden con los de la clave de la app en Gupshup. Dime el resultado.",
  );
}

/** P3: take the user to the Gupshup wallet to top up, without paying. */
export function buildRechargePrompt(input: { appName?: string | null | undefined }): string {
  return compose(
    "Ayúdame a llegar a la pantalla de recarga de saldo de Gupshup.",
    [appLine(input.appName)],
    [
      `Abre ${GUPSHUP_WALLET_URL}. Si no he iniciado sesión, detente y pídeme que inicie sesión.`,
      "Ubica el saldo (wallet) de mi cuenta y el botón para recargar.",
      "Abre el formulario de recarga, pero NO elijas un monto, NO escribas datos de pago y NO confirmes ningún cobro.",
      "Detente y pídeme que yo elija el monto y complete el pago. Espera a que te diga que ya pagué.",
    ],
    "Recarga la página de saldo y confirma que el saldo aumentó. Dime el valor que ves.",
  );
}

/** P4: get the Gupshup partner App ID and partner token. */
export function buildPartnerCredentialsPrompt(input: { appName?: string | null | undefined }): string {
  return compose(
    "Ayúdame a conseguir el ID de app y el Token de Partner de Gupshup.",
    [appLine(input.appName)],
    [
      `Abre ${GUPSHUP_PARTNER_URL}. Si no he iniciado sesión, detente y pídeme que inicie sesión (si pide captcha, también es cosa mía).`,
      "Abre la app con el nombre indicado arriba (verifica que sea la correcta) y localiza su ID de app. Léemelo en el chat: no es secreto.",
      "En el mismo portal, ubica dónde se genera o se copia el Token de Partner. Detente y explícame dónde está para que yo lo copie.",
      "No copies el token en el chat. Yo lo pegaré en Vende+ (Canales → Configurar plantillas).",
    ],
    "Recarga Vende+ cuando te diga que los pegué y confirma que el canal aparece con las plantillas configuradas. Dime el resultado.",
  );
}

/** P5: request a display-name change (Meta approves it). */
export function buildDisplayNamePrompt(input: { phone: string; displayName?: string | null | undefined }): string {
  const wanted = input.displayName ? `Nombre que quiero mostrar: ${input.displayName}` : "Nombre que quiero mostrar: (pregúntamelo antes de enviar)";
  return compose(
    "Ayúdame a pedir el cambio del nombre visible de mi WhatsApp Business.",
    [`Número: ${input.phone}`, wanted],
    [
      `Abre ${META_WHATSAPP_MANAGER_URL}. Si no he iniciado sesión en Facebook, detente y pídeme que inicie sesión.`,
      "Elige la cuenta de WhatsApp Business y el número indicado arriba.",
      "Abre la edición del nombre para mostrar y escribe el nombre indicado. Debe corresponder a mi marca real y no estar todo en mayúsculas.",
      "Envía la solicitud a revisión. Recuérdame que Meta debe aprobarla y que puede tardar de unas horas a 2 días.",
    ],
    "Recarga la página y confirma que la solicitud aparece como pendiente de revisión con el nombre correcto. Dime el estado que ves.",
  );
}

/** P6: complete the WhatsApp profile (photo, description) when the API does not cover it. */
export function buildProfilePrompt(input: { phone: string; appName?: string | null | undefined }): string {
  return compose(
    "Ayúdame a completar el perfil de mi WhatsApp Business (foto y descripción).",
    [`Número: ${input.phone}`, appLine(input.appName)],
    [
      `Abre ${META_WHATSAPP_MANAGER_URL}. Si no he iniciado sesión en Facebook, detente y pídeme que inicie sesión.`,
      "Elige el número indicado arriba y abre su perfil.",
      "Pregúntame qué descripción quiero y pídeme que suba yo la foto de perfil (tú no tienes acceso a mis archivos).",
      "Guarda los cambios cuando yo confirme.",
    ],
    "Recarga el perfil y confirma que la foto y la descripción guardadas son las que elegí. Dime el resultado.",
  );
}

/** P7: verify the whole channel (right app, key hint, webhook match, test send). */
export function buildVerifyChannelPrompt(input: { appName?: string | null | undefined; phone: string; apiKeyHint?: string | null | undefined }): string {
  const hint = input.apiKeyHint
    ? `Últimos caracteres de la clave que muestra Vende+: ${input.apiKeyHint}`
    : "Vende+ no muestra los últimos caracteres de la clave: pídeme que los revise yo.";
  return compose(
    "Ayúdame a verificar que mi canal de WhatsApp está bien conectado entre Gupshup y Vende+.",
    [`Número: ${input.phone}`, appLine(input.appName), hint],
    [
      `Abre ${GUPSHUP_CONSOLE_URL}. Si no he iniciado sesión, detente y pídeme que inicie sesión.`,
      "Confirma que existe una app con el nombre indicado y que está en la cuenta correcta; si hay varias parecidas, dime cuál es cuál.",
      "En Claves de API, compara solo los últimos 4 caracteres con los indicados arriba. No me muestres ni copies la clave completa.",
      PASTE_WEBHOOK_STEP,
      "En Webhooks, confirma que la URL guardada coincide exactamente con la que pegué, que el formato es Gupshup (v2), que los eventos Mensaje, Enviado, Entregado, Leído y Error están marcados y que el interruptor está encendido. Corrige lo que no coincida.",
      "Pídeme que envíe un mensaje de WhatsApp de prueba a este número y espera a que te diga que lo envié.",
    ],
    "Recarga Vende+ (Inbox y Canales) y confirma que el mensaje de prueba apareció en el Inbox y que el canal muestra actividad reciente. Dame un resumen con lo que está bien y lo que falta.",
  );
}
