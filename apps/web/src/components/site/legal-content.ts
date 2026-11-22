import type { LegalSection } from "./LegalPage";

export const LEGAL_UPDATED = "22 de noviembre de 2026";
export const CONTACT_EMAIL = "contacto@vendemas.chat";

export const TERMS_INTRO =
  "Estos términos regulan el uso de Vende+ WSP, un CRM para WhatsApp con inteligencia artificial. Al crear una cuenta o usar el servicio aceptas estas condiciones.";

export const TERMS_SECTIONS: readonly LegalSection[] = [
  {
    title: "El servicio",
    paragraphs: [
      "Vende+ WSP ofrece una bandeja compartida para conversaciones de WhatsApp, un asistente de IA que responde con la información que cargas (catálogo y fuentes), presupuestos, pedidos y seguimiento. La conexión con WhatsApp se hace mediante proveedores oficiales de la API de WhatsApp Business.",
      "Las funciones marcadas como próximamente no forman parte del servicio contratado hasta que se publiquen.",
    ],
  },
  {
    title: "Tu cuenta y el uso aceptable",
    paragraphs: [
      "Eres responsable de la actividad de tu cuenta y de las personas a las que das acceso. Debes mantener tus credenciales en reserva.",
      "Te comprometes a cumplir las políticas de WhatsApp y de Meta, a escribir solo a contactos que hayan dado su consentimiento o te hayan escrito primero, y a no usar el servicio para spam, fraude, contenido ilegal o engañoso.",
      "Podemos limitar o suspender cuentas que incumplan estas reglas o pongan en riesgo el servicio o a otros clientes.",
    ],
  },
  {
    title: "Planes, precios y pagos",
    paragraphs: [
      "Los planes y precios vigentes, en dólares estadounidenses (USD), se muestran en la página de precios. Los mensajes de WhatsApp se pagan a la tarifa de Meta, sin recargo de Vende+ WSP.",
      "Pagando con criptomonedas, cada pago cubre un periodo fijo (30 días, o 365 en el plan anual) y no se renueva solo. Un pago se considera recibido cuando el proveedor de pagos lo confirma; una captura de comprobante no activa el plan.",
      "Los impuestos que correspondan en tu país son tu responsabilidad, salvo que se indique lo contrario.",
    ],
  },
  {
    title: "Prueba gratis y fin del servicio",
    paragraphs: [
      "Ofrecemos un periodo de configuración y un periodo de prueba gratis según se describe en la página de precios. Terminada la prueba o el periodo pagado, hay unos días de gracia y luego la cuenta pasa a solo lectura.",
      `Puedes dejar de usar el servicio en cualquier momento. Para eliminar tus datos escríbenos a ${CONTACT_EMAIL}.`,
    ],
  },
  {
    title: "Inteligencia artificial",
    paragraphs: [
      "El asistente de IA puede equivocarse. Tú decides qué automatizas y eres responsable de revisar las respuestas, los precios y los plazos que se comunican a tus clientes.",
      "Si conectas tu propia clave de un proveedor de IA, el costo de ese consumo lo factura directamente ese proveedor.",
    ],
  },
  {
    title: "Disponibilidad y responsabilidad",
    paragraphs: [
      "Trabajamos para que el servicio esté disponible de forma continua, pero no garantizamos que funcione sin interrupciones ni errores. Los servicios de terceros (WhatsApp, proveedores de IA y de pagos) pueden fallar o cambiar sus condiciones.",
      "En la medida que la ley lo permita, nuestra responsabilidad se limita al importe que hayas pagado por el servicio en los últimos 12 meses.",
    ],
  },
  {
    title: "Cambios y contacto",
    paragraphs: [
      "Podemos actualizar estos términos; publicaremos la nueva versión en esta página con su fecha. Si sigues usando el servicio después del cambio, lo aceptas.",
      `Para cualquier consulta escríbenos a ${CONTACT_EMAIL}.`,
    ],
  },
];

export const PRIVACY_INTRO =
  "Esta política explica qué datos trata Vende+ WSP, para qué y con quién los comparte. Sobre los datos de tu cuenta somos el responsable; sobre los datos de tus propios contactos y conversaciones actuamos por cuenta tuya como encargados del tratamiento.";

export const PRIVACY_SECTIONS: readonly LegalSection[] = [
  {
    title: "Qué datos tratamos",
    paragraphs: [
      "Datos de tu cuenta: nombre, correo electrónico, empresa y rol dentro del equipo.",
      "Datos de tu actividad: los contactos, conversaciones de WhatsApp, presupuestos, pedidos y archivos que gestionas con el servicio.",
      "Datos de pago: referencias y estados de los cobros que confirma el proveedor de pagos. No almacenamos los datos completos de tu tarjeta.",
      "Datos de uso: registros técnicos y, solo si lo aceptas en el aviso de cookies, estadísticas de uso y medición de campañas.",
    ],
  },
  {
    title: "Para qué los usamos",
    paragraphs: [
      "Para prestar el servicio (recibir y enviar mensajes, generar respuestas con IA, emitir presupuestos), para la seguridad y prevención de fraude, para el soporte y para cumplir obligaciones legales.",
      "No vendemos tus datos ni los de tus contactos.",
    ],
  },
  {
    title: "Con quién los compartimos",
    paragraphs: [
      "Con proveedores que hacen posible el servicio: el proveedor oficial de la API de WhatsApp, el proveedor de IA que uses (por defecto OpenAI, o el que conectes con tu propia clave), los proveedores de pago y la infraestructura de alojamiento.",
      "Cada proveedor trata los datos según sus propias condiciones. Las claves y credenciales que guardas se almacenan cifradas.",
    ],
  },
  {
    title: "Separación entre empresas y seguridad",
    paragraphs: [
      "Cada empresa trabaja en un espacio aislado: los datos de una no son visibles para otra. Aplicamos controles de acceso por rol y registramos acciones sensibles.",
    ],
  },
  {
    title: "Cookies y analítica",
    paragraphs: [
      "Usamos cookies necesarias para iniciar sesión y mantener tu cuenta. Las cookies de analítica y de medición de campañas solo se activan si las aceptas en el aviso de cookies, y puedes cambiar tu decisión cuando quieras.",
    ],
  },
  {
    title: "Conservación y tus derechos",
    paragraphs: [
      "Conservamos los datos mientras tu cuenta exista y el tiempo necesario para cumplir obligaciones legales.",
      `Puedes pedir acceso, corrección o eliminación de tus datos, y oponerte a ciertos usos, escribiendo a ${CONTACT_EMAIL}. Si eres cliente de una empresa que usa Vende+ WSP, dirige tu solicitud a esa empresa.`,
    ],
  },
  {
    title: "Cambios y contacto",
    paragraphs: [
      `Si actualizamos esta política publicaremos la nueva versión aquí con su fecha. Para cualquier consulta escríbenos a ${CONTACT_EMAIL}.`,
    ],
  },
];
