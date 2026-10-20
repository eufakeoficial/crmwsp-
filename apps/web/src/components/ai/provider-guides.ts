import type { AiProvider } from "@/lib/ai-schemas";

export interface ProviderGuide {
  label: string;
  tagline: string;
  recommended?: boolean;
  keyUrl: string | null;
  keyLabel: string | null;
  steps: readonly string[];
  billing: string;
  costNote: string;
  cheapModels: readonly string[];
  strongModels: readonly string[];
}

const COST_NOTE = "El coste depende del volumen de conversaciones; fija un límite de gasto abajo para mantenerlo bajo control.";

export const PROVIDER_GUIDES: Readonly<Record<AiProvider, ProviderGuide>> = {
  openai: {
    label: "OpenAI",
    tagline: "Recomendado: el más probado con CRMWSP.",
    recommended: true,
    keyUrl: "https://platform.openai.com/api-keys",
    keyLabel: "platform.openai.com/api-keys",
    steps: [
      "Entra en platform.openai.com con tu cuenta (o crea una).",
      "Añade saldo o un método de pago en Billing; sin saldo la key no funcionará.",
      "En API keys pulsa «Create new secret key», ponle un nombre como «CRMWSP» y cópiala.",
      "Pégala en el campo de abajo. OpenAI solo te la muestra una vez.",
    ],
    billing: "El saldo se añade en Settings → Billing de tu cuenta de OpenAI.",
    costNote: `Los modelos pequeños suelen costar muy poco por conversación. ${COST_NOTE}`,
    cheapModels: ["gpt-4o-mini", "gpt-4.1-mini"],
    strongModels: ["gpt-4o", "gpt-4.1"],
  },
  openrouter: {
    label: "OpenRouter",
    tagline: "Un solo acceso a modelos de varios fabricantes.",
    keyUrl: "https://openrouter.ai/keys",
    keyLabel: "openrouter.ai/keys",
    steps: [
      "Entra en openrouter.ai y crea tu cuenta.",
      "Añade créditos en Credits (tarjeta); la key usa ese saldo.",
      "En Keys pulsa «Create Key», nómbrala «CRMWSP» y, si quieres, ponle un límite de crédito.",
      "Copia la key y pégala abajo. Los modelos se escriben como «fabricante/modelo».",
    ],
    billing: "Los créditos se compran en openrouter.ai/credits.",
    costNote: `El precio varía según el modelo que elijas. ${COST_NOTE}`,
    cheapModels: ["openai/gpt-4o-mini", "google/gemini-2.0-flash-001"],
    strongModels: ["openai/gpt-4o", "anthropic/claude-sonnet-4"],
  },
  deepseek: {
    label: "DeepSeek",
    tagline: "Económico; puede no ofrecer embeddings ni audio.",
    keyUrl: "https://platform.deepseek.com/api_keys",
    keyLabel: "platform.deepseek.com/api_keys",
    steps: [
      "Entra en platform.deepseek.com y crea tu cuenta.",
      "Recarga saldo en Top up; la API funciona con saldo prepagado.",
      "En API keys pulsa «Create new API key», nómbrala «CRMWSP» y cópiala.",
      "Pégala abajo y usa «Probar conexión» para ver qué funciones admite.",
    ],
    billing: "El saldo se recarga en la sección Top up de la plataforma.",
    costNote: `Suele ser de los más baratos. ${COST_NOTE}`,
    cheapModels: ["deepseek-chat"],
    strongModels: ["deepseek-reasoner", "deepseek-chat"],
  },
  custom: {
    label: "Personalizado",
    tagline: "Cualquier servicio compatible con la API de OpenAI.",
    keyUrl: null,
    keyLabel: null,
    steps: [
      "Pide a tu proveedor la URL base de su API compatible con OpenAI (suele terminar en /v1).",
      "Crea una API key en su panel y comprueba cómo se añade saldo o método de pago.",
      "Introduce la URL (https obligatorio), la key y los nombres exactos de los modelos.",
    ],
    billing: "Consulta en tu proveedor dónde se añade saldo o método de pago.",
    costNote: COST_NOTE,
    cheapModels: [],
    strongModels: [],
  },
};
