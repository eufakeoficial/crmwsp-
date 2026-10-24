import {
  BRAND, button, callout, checks, facts, note, paragraph, pill, quote, stat, title,
  type Block, type MarketingLinks,
} from "./blocks.js";

/**
 * Vende+ WSP transactional emails. Data is display-ready: amounts and dates are already
 * formatted by the caller (es locale, tenant timezone). `sample` feeds the previews.
 * Copy is neutral Spanish (tuteo, no regional slang).
 */

export interface EmailContext {
  /** https://www.vendemas.chat (no trailing slash needed). */
  siteUrl: string;
  /** Base URL of the brand assets (logo-on-dark.png). */
  assetsUrl: string;
  /** Required for `optional` emails. */
  marketing?: MarketingLinks;
}

/** `service` always goes out; `optional` respects the recipient's notification preferences. */
export type EmailKind = "service" | "optional";

interface Built { subject: string; preheader: string; blocks: Block[] }
interface Definition<D> {
  kind: EmailKind;
  build: (data: D, ctx: EmailContext) => Built;
  sample: D;
}

const url = (base: string, path: string) => `${base.replace(/\/$/, "")}${path}`;
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
const def = <D>(d: Definition<D>) => d;
const hello = (name?: string | null) => (name ? `Hola ${name},` : "Hola,");

export const ROLE_ES: Record<string, string> = {
  owner: "propietario", admin: "administrador", agent: "agente", viewer: "solo lectura",
};

export const EMAIL_TEMPLATES = {
  "bienvenida-verificacion": def<{ name: string; verifyUrl: string; hours: number }>({
    kind: "service",
    build: (d) => ({
      subject: `Confirma tu cuenta en ${BRAND.name}`,
      preheader: "Un clic para activar tu cuenta y empezar a vender por WhatsApp.",
      blocks: [
        pill("Bienvenida", "lime"), title(`Te damos la bienvenida a ${BRAND.name}`),
        paragraph(`${hello(d.name)} tu cuenta está creada. Confirma tu correo para activarla.`),
        button("Confirmar mi cuenta", d.verifyUrl),
        paragraph(["El enlace vence en ", { b: plural(d.hours, "hora", "horas") }, " y solo se puede usar una vez."]),
        checks([
          [{ b: "Conecta tu WhatsApp" }, " para recibir a tus clientes en un solo lugar."],
          [{ b: "Carga tu catálogo" }, " para que la IA responda con precios y datos reales."],
          [{ b: "Invita a tu equipo" }, " y reparte las conversaciones."],
        ]),
        note(`Si no creaste una cuenta en ${BRAND.name}, ignora este correo.`),
      ],
    }),
    sample: { name: "Camila", verifyUrl: "https://www.vendemas.chat/verify/abc123", hours: 24 },
  }),

  bienvenida: def<{ name: string | null; tenantName: string; appUrl: string }>({
    kind: "service",
    build: (d) => ({
      subject: `Te damos la bienvenida a ${BRAND.name}`,
      preheader: "Tu cuenta está lista. Estos son los primeros pasos para vender por WhatsApp.",
      blocks: [
        pill("Bienvenida", "lime"), title(`Te damos la bienvenida a ${BRAND.name}`),
        paragraph(`${hello(d.name)} creaste la cuenta de ${d.tenantName}. Estos son los primeros pasos:`),
        checks([
          [{ b: "Conecta tu WhatsApp" }, " para recibir a tus clientes en un solo lugar y empezar tu prueba gratis."],
          [{ b: "Carga tu catálogo" }, " para que la IA responda con precios y datos reales."],
          [{ b: "Invita a tu equipo" }, " y reparte las conversaciones."],
        ]),
        button("Abrir mi panel", d.appUrl),
        note(`Si no creaste una cuenta en ${BRAND.name}, ignora este correo.`),
      ],
    }),
    sample: { name: "Camila", tenantName: "Clínica Aurora", appUrl: "https://www.vendemas.chat/app" },
  }),

  "invitacion-equipo": def<{ tenantName: string; role: string; inviterName: string | null; link: string; days: number }>({
    kind: "service",
    build: (d) => ({
      subject: `Invitación para unirte a ${d.tenantName}`.slice(0, 200),
      preheader: `${d.inviterName ?? "Te"} invitó a ${d.tenantName} en ${BRAND.name}.`,
      blocks: [
        pill("Equipo"), title(`Únete a ${d.tenantName}`),
        paragraph(`${d.inviterName ? `${d.inviterName} te ha invitado` : "Te han invitado"} a unirte al equipo de ${d.tenantName} como ${ROLE_ES[d.role] ?? d.role}.`),
        button("Aceptar invitación", d.link),
        paragraph(["El enlace caduca en ", { b: plural(d.days, "día", "días") }, " y solo se puede usar una vez."]),
        note("Si no esperabas esta invitación, ignora este correo."),
      ],
    }),
    sample: { tenantName: "Clínica Aurora", role: "agent", inviterName: "Laura Pérez", link: "https://www.vendemas.chat/invite/tok_123", days: 7 },
  }),

  "recuperar-contrasena": def<{ name: string; resetUrl: string; minutes: number }>({
    kind: "service",
    build: (d) => ({
      subject: "Restablece tu contraseña",
      preheader: `Pediste cambiar tu contraseña. El enlace vence en ${d.minutes} minutos.`,
      blocks: [
        pill("Seguridad"), title("Restablece tu contraseña"),
        paragraph(`${hello(d.name)} recibimos una solicitud para cambiar tu contraseña.`),
        button("Crear contraseña nueva", d.resetUrl),
        paragraph(["El enlace vence en ", { b: plural(d.minutes, "minuto", "minutos") }, " y solo se puede usar una vez."]),
        note("Si no fuiste tú, ignora este correo: tu contraseña no cambiará."),
      ],
    }),
    sample: { name: "Camila", resetUrl: "https://www.vendemas.chat/reset/abc123", minutes: 30 },
  }),

  "recordatorio-conecta-whatsapp": def<{ tenantName: string; days: number; connectUrl: string }>({
    kind: "service",
    build: (d, ctx) => {
      const left = plural(d.days, "día", "días");
      return {
        subject: `Conecta tu WhatsApp: te quedan ${left} para empezar tu prueba`,
        preheader: `${d.tenantName} aún no tiene un número conectado.`,
        blocks: [
          pill("Te quedan " + left, "amber"), title("Conecta tu WhatsApp para empezar"),
          paragraph(`${d.tenantName} todavía no tiene un número de WhatsApp conectado. Conéctalo para empezar tus 7 días de prueba gratuita.`),
          button("Conectar WhatsApp", d.connectUrl),
          callout("Si no lo conectas a tiempo, la cuenta pasará a solo lectura. Tus datos se conservan.", "warn"),
          note(["¿Necesitas ayuda? Escribe desde ", { a: "tu panel", href: url(ctx.siteUrl, "/app") }, "."]),
        ],
      };
    },
    sample: { tenantName: "Clínica Aurora", days: 2, connectUrl: "https://www.vendemas.chat/app/channels" },
  }),

  "prueba-iniciada": def<{ tenantName: string; endsAt: string; days: number; appUrl: string }>({
    kind: "service",
    build: (d) => ({
      subject: `Tu prueba gratis de ${BRAND.name} ya empezó`,
      preheader: `Tienes ${d.days} días con todo incluido, hasta el ${d.endsAt}.`,
      blocks: [
        pill("Prueba gratis", "lime"), title("Tu prueba gratis ya empezó"),
        paragraph(`Conectaste WhatsApp en ${d.tenantName}. Desde hoy tienes acceso completo durante ${plural(d.days, "día", "días")}.`),
        facts([["Cuenta", d.tenantName], ["Termina el", d.endsAt], ["Costo", "Sin costo"]]),
        button("Abrir mi panel", d.appUrl),
        note("No necesitas tarjeta para probar. Te avisaremos antes de que termine."),
      ],
    }),
    sample: { tenantName: "Clínica Aurora", endsAt: "31 de octubre de 2026", days: 7, appUrl: "https://www.vendemas.chat/app" },
  }),

  "prueba-por-terminar": def<{ tenantName: string; daysLeft: number; endsAt: string; plansUrl: string }>({
    kind: "service",
    build: (d) => ({
      subject: `Tu prueba gratis termina en ${plural(d.daysLeft, "día", "días")}`,
      preheader: `Elige un plan antes del ${d.endsAt} para no perder el acceso.`,
      blocks: [
        pill("Prueba por terminar", "amber"), title(`Te quedan ${plural(d.daysLeft, "día", "días")} de prueba`),
        paragraph(`La prueba de ${d.tenantName} termina el ${d.endsAt}. Elige un plan para seguir atendiendo a tus clientes sin interrupciones.`),
        button("Elegir mi plan", d.plansUrl),
        callout("Si no eliges un plan, la cuenta pasará a solo lectura: verás tu información pero no podrás responder ni usar la IA.", "info"),
      ],
    }),
    sample: { tenantName: "Clínica Aurora", daysLeft: 2, endsAt: "31 de octubre de 2026", plansUrl: "https://www.vendemas.chat/app/settings" },
  }),

  "prueba-terminada": def<{ tenantName: string; plansUrl: string }>({
    kind: "service",
    build: (d) => ({
      subject: "Tu prueba gratis terminó",
      preheader: "Tu cuenta está en solo lectura. Elige un plan para reactivarla.",
      blocks: [
        pill("Prueba terminada", "red"), title("Tu prueba gratis terminó"),
        paragraph(`La prueba de ${d.tenantName} ya terminó. Tu cuenta está en modo solo lectura: tus conversaciones, contactos y catálogo siguen guardados.`),
        button("Elegir un plan", d.plansUrl),
        note("Al activar un plan, la cuenta vuelve a funcionar de inmediato."),
      ],
    }),
    sample: { tenantName: "Clínica Aurora", plansUrl: "https://www.vendemas.chat/app/settings" },
  }),

  "pago-confirmado": def<{
    tenantName: string; plan: string; cycle: "mensual" | "anual" | null; periodStart: string; periodEnd: string;
    amount: string; reference: string; coupon: boolean; appUrl: string;
  }>({
    kind: "service",
    build: (d) => {
      const planLabel = d.cycle ? `${d.plan} ${d.cycle}` : d.plan;
      return d.coupon
        ? {
          subject: `Cupón aplicado: plan ${planLabel}`,
          preheader: `Tu plan está activo hasta el ${d.periodEnd}, sin costo.`,
          blocks: [
            pill("Cupón aplicado", "green"), title("Activamos tu plan"),
            paragraph(`Canjeaste un cupón y la suscripción de ${d.tenantName} quedó activa sin costo.`),
            facts([["Plan", planLabel], ["Período", `${d.periodStart} al ${d.periodEnd}`], ["Monto", "Sin costo (cupón)"], ["Referencia", d.reference]]),
            button("Ir a mi panel", d.appUrl),
          ],
        }
        : {
          subject: `Pago confirmado: plan ${planLabel}`,
          preheader: `Recibimos ${d.amount}. Tu plan está activo hasta el ${d.periodEnd}.`,
          blocks: [
            pill("Pago confirmado", "green"), title("Recibimos tu pago"),
            paragraph(`Gracias. La suscripción de ${d.tenantName} está al día.`),
            stat(d.amount, `Plan ${planLabel}`),
            facts([["Plan", planLabel], ["Período", `${d.periodStart} al ${d.periodEnd}`], ["Monto", d.amount], ["Referencia", d.reference]]),
            button("Ir a mi panel", d.appUrl),
            note("Guarda este correo como comprobante de tu pago."),
          ],
        };
    },
    // Real list prices (packages/billing PLANS): Start 49 / Pro 89 USD monthly, 490 / 890 annual.
    sample: {
      tenantName: "Clínica Aurora", plan: "Pro", cycle: "mensual", periodStart: "1 de noviembre de 2026", periodEnd: "1 de diciembre de 2026",
      amount: "89,00 USD", reference: "NP-8841-2207", coupon: false, appUrl: "https://www.vendemas.chat/app",
    },
  }),

  "pago-por-vencer": def<{ tenantName: string; plan: string; dueDate: string; daysLeft: number; amount: string; payUrl: string }>({
    kind: "service",
    build: (d) => ({
      subject: `Tu plan ${d.plan} vence en ${plural(d.daysLeft, "día", "días")}`,
      preheader: `Renueva antes del ${d.dueDate} para no perder el acceso.`,
      blocks: [
        pill("Pago por vencer", "amber"), title("Tu suscripción está por vencer"),
        paragraph(`El plan ${d.plan} de ${d.tenantName} vence el ${d.dueDate}. Renueva ahora para evitar interrupciones.`),
        facts([["Plan", d.plan], ["Vence el", d.dueDate], ["Monto a pagar", d.amount]]),
        button("Pagar ahora", d.payUrl),
        callout("Si el pago no llega a tiempo, la cuenta pasará a solo lectura hasta que se regularice.", "warn"),
      ],
    }),
    sample: { tenantName: "Clínica Aurora", plan: "Pro", dueDate: "1 de diciembre de 2026", daysLeft: 3, amount: "89,00 USD", payUrl: "https://www.vendemas.chat/app/settings" },
  }),

  "cuenta-solo-lectura": def<{ tenantName: string; since: string; payUrl: string }>({
    kind: "service",
    build: (d) => ({
      subject: `${d.tenantName} está en modo solo lectura`,
      preheader: "No pudimos confirmar tu pago. Regulariza para reactivar la cuenta.",
      blocks: [
        pill("Solo lectura", "red"), title("Tu cuenta está en solo lectura"),
        paragraph(`Desde el ${d.since} no pudimos confirmar el pago de ${d.tenantName}. Puedes ver tu información, pero no enviar mensajes ni usar la IA.`),
        button("Regularizar mi pago", d.payUrl, "danger"),
        note("En cuanto confirmemos el pago, la cuenta se reactiva automáticamente. Tus datos están a salvo."),
      ],
    }),
    sample: { tenantName: "Clínica Aurora", since: "1 de diciembre de 2026", payUrl: "https://www.vendemas.chat/app/settings" },
  }),

  "referido-recompensa": def<{ name: string | null; referredName: string; reward: string; detail: string; appUrl: string }>({
    kind: "service",
    build: (d) => ({
      subject: `Ganaste ${d.reward} por tu referido`,
      preheader: `${d.referredName} hizo su primer pago. Tu recompensa ya está disponible.`,
      blocks: [
        pill("Recompensa", "lime"), title("Ganaste una recompensa"),
        paragraph(`${hello(d.name)} ${d.referredName} se suscribió con tu enlace y realizó su primer pago.`),
        stat(d.reward, "Recompensa obtenida"),
        paragraph(d.detail),
        button("Ver mis referidos", d.appUrl, "lime"),
        note("Comparte tu enlace con más negocios para seguir sumando."),
      ],
    }),
    sample: { name: "Camila", referredName: "Tienda Mirador", reward: "1 mes gratis", detail: "Se aplicará automáticamente a tu próxima renovación.", appUrl: "https://www.vendemas.chat/app/settings" },
  }),

  "ticket-respuesta": def<{ name: string; ticketRef: string; ticketSubject: string; agentName: string; excerpt: string; ticketUrl: string }>({
    kind: "service",
    build: (d) => ({
      subject: `Respuesta a tu consulta ${d.ticketRef}: ${d.ticketSubject}`.slice(0, 200),
      preheader: `${d.agentName} respondió a tu ticket de soporte.`,
      blocks: [
        pill("Soporte"), title("Tienes una respuesta nueva"),
        paragraph(`${hello(d.name)} nuestro equipo respondió a tu consulta ${d.ticketRef}: ${d.ticketSubject}.`),
        quote(d.agentName, d.excerpt),
        button("Ver y responder", d.ticketUrl),
        note("Para responder, usa el botón: este correo no admite respuestas."),
      ],
    }),
    sample: { name: "Camila", ticketRef: "#1042", ticketSubject: "No llegan mis mensajes", agentName: "Equipo de soporte", excerpt: "Revisamos tu canal y encontramos que la sesión había expirado.\nYa la renovamos; prueba enviando un mensaje de nuevo.", ticketUrl: "https://www.vendemas.chat/app" },
  }),

  "cuenta-aprobada": def<{ name: string | null; tenantName: string; appUrl: string }>({
    kind: "service",
    build: (d) => ({
      subject: `Tu cuenta ${d.tenantName} está aprobada`,
      preheader: "Ya puedes conectar tus canales y usar la IA.",
      blocks: [
        pill("Cuenta aprobada", "green"), title("Cuenta aprobada"),
        paragraph(`${hello(d.name)} hemos revisado y aprobado la cuenta de ${d.tenantName}. Ya puedes conectar tus canales y usar la IA.`),
        button("Entrar al panel", d.appUrl),
      ],
    }),
    sample: { name: "Camila", tenantName: "Clínica Aurora", appUrl: "https://www.vendemas.chat/app" },
  }),

  "cuenta-rechazada": def<{ name: string | null; tenantName: string; reason: string | null }>({
    kind: "service",
    build: (d) => ({
      subject: `Tu solicitud para ${d.tenantName} no fue aprobada`,
      preheader: "Revisamos tu cuenta y por ahora no podemos aprobarla.",
      blocks: [
        pill("Solicitud", "red"), title("Solicitud no aprobada"),
        paragraph(`${hello(d.name)} tras revisar la cuenta de ${d.tenantName}, no podemos aprobarla por ahora.`),
        ...(d.reason ? [callout([{ b: "Motivo: " }, d.reason], "danger")] : []),
        note("Si crees que es un error, contáctanos desde tu panel para que lo revisemos."),
      ],
    }),
    sample: { name: "Camila", tenantName: "Clínica Aurora", reason: "No pudimos verificar los datos del negocio." },
  }),

  "cuenta-suspendida": def<{ name: string | null; tenantName: string; reason: string | null }>({
    kind: "service",
    build: (d) => ({
      subject: `La cuenta ${d.tenantName} está suspendida`,
      preheader: "Mientras siga suspendida no se procesan mensajes ni se usa la IA.",
      blocks: [
        pill("Cuenta suspendida", "red"), title("Cuenta suspendida"),
        paragraph(`${hello(d.name)} hemos suspendido la cuenta de ${d.tenantName}. Mientras siga suspendida no se procesan mensajes ni se usa la IA.`),
        ...(d.reason ? [callout([{ b: "Motivo: " }, d.reason], "danger")] : []),
        note("Contáctanos desde tu panel para regularizarla."),
      ],
    }),
    sample: { name: "Camila", tenantName: "Clínica Aurora", reason: null },
  }),

  "notificacion-generica": def<{ title: string; body: string; appUrl: string }>({
    kind: "service",
    build: (d) => ({
      subject: d.title.slice(0, 200),
      preheader: d.body.split("\n")[0]?.slice(0, 110) ?? d.title,
      blocks: [
        pill("Aviso"), title(d.title),
        ...d.body.split(/\n{2,}/).map((p) => paragraph(p)),
        button("Abrir Vende+ WSP", d.appUrl),
      ],
    }),
    sample: { title: "Pedido pagado", body: "El pedido #208 fue pagado y está listo para preparar.", appUrl: "https://www.vendemas.chat/app" },
  }),
};

export type EmailKey = keyof typeof EMAIL_TEMPLATES;
export type EmailData<K extends EmailKey> = (typeof EMAIL_TEMPLATES)[K]["sample"];
