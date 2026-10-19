import { z } from "zod";
import { isoDateTimeSchema, tenantIdSchema, uuidSchema } from "./common.js";

/** Builds the envelope schema shared by every domain event. */
export const domainEventSchema = <const T extends string, P extends z.ZodType>(
  type: T,
  payloadSchema: P,
) =>
  z.object({
    id: uuidSchema,
    type: z.literal(type),
    tenantId: tenantIdSchema,
    occurredAt: isoDateTimeSchema,
    payload: payloadSchema,
  });
