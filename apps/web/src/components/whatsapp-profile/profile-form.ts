import type { UpdateWhatsappProfileRequest, WhatsappProfile, WhatsappProfileVertical } from "@crmwsp/contracts";

export const VERTICAL_LABELS: Record<WhatsappProfileVertical, string> = {
  AUTO: "Automotriz",
  BEAUTY: "Belleza y cuidado personal",
  APPAREL: "Ropa y accesorios",
  EDU: "Educación",
  ENTERTAIN: "Entretenimiento",
  EVENT_PLAN: "Eventos",
  FINANCE: "Finanzas",
  GROCERY: "Alimentos y abarrotes",
  GOVT: "Gobierno",
  HOTEL: "Hotel y alojamiento",
  HEALTH: "Salud",
  NONPROFIT: "Organización sin fines de lucro",
  PROF_SERVICES: "Servicios profesionales",
  RETAIL: "Comercio minorista",
  TRAVEL: "Viajes y transporte",
  RESTAURANT: "Restaurante",
  OTHER: "Otro",
};

export interface ProfileForm {
  about: string;
  description: string;
  address: string;
  email: string;
  website1: string;
  website2: string;
  vertical: string;
}

export function toForm(p: WhatsappProfile): ProfileForm {
  return {
    about: p.about ?? "",
    description: p.description ?? "",
    address: p.address ?? "",
    email: p.email ?? "",
    website1: p.website1 ?? "",
    website2: p.website2 ?? "",
    vertical: p.vertical && p.vertical in VERTICAL_LABELS ? p.vertical : "",
  };
}

/** Only the fields that changed and are not empty (Gupshup cannot clear a field with an empty value). */
export function buildUpdate(original: WhatsappProfile, form: ProfileForm): Partial<UpdateWhatsappProfileRequest> {
  const before = toForm(original);
  const out: Record<string, string> = {};
  for (const key of Object.keys(form) as Array<keyof ProfileForm>) {
    const value = form[key].trim();
    if (value !== "" && value !== before[key].trim()) out[key] = value;
  }
  return out as Partial<UpdateWhatsappProfileRequest>;
}
