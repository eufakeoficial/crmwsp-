import { z } from "zod";

/** 360dialog Cloud API responses. Permissive on extra keys, strict on the fields we rely on. */

export const sendResponseSchema = z
  .object({ messages: z.array(z.object({ id: z.string().min(1).max(256) }).loose()).min(1) })
  .loose();

export const mediaUrlResponseSchema = z.object({ url: z.string().min(1).max(4096) }).loose();

export const templateSubmitResponseSchema = z
  .object({ status: z.string().optional(), name: z.string().optional() })
  .loose();

export const templateListResponseSchema = z
  .object({
    waba_templates: z.array(
      z
        .object({
          name: z.string().min(1),
          language: z.string().min(1),
          status: z.string().optional(),
          category: z.string().optional(),
          rejected_reason: z.string().optional(),
          components: z.array(z.object({ type: z.string(), text: z.string().optional() }).loose()).optional(),
        })
        .loose(),
    ),
  })
  .loose();
