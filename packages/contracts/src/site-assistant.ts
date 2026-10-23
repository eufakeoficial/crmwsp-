import { z } from "zod";

/** Public landing assistant (POST /public/assistant). Stateless: the client sends the visible transcript. */

export const SITE_ASSISTANT_MAX_MESSAGES = 12;
export const SITE_ASSISTANT_MAX_CHARS = 500;
export const SITE_ASSISTANT_MAX_REPLY = 600;

/** Closed set: the model only picks a kind; label and href are resolved server side. */
export const SITE_ASSISTANT_ACTION_KINDS = ["signup", "whatsapp", "faq", "how_it_works", "pricing"] as const;
export const siteAssistantActionKindSchema = z.enum(SITE_ASSISTANT_ACTION_KINDS);
export type SiteAssistantActionKind = z.infer<typeof siteAssistantActionKindSchema>;

export const siteAssistantMessageSchema = z.object({
  role: z.enum(["user", "assistant"]),
  content: z.string().trim().min(1).max(SITE_ASSISTANT_MAX_CHARS),
});
export type SiteAssistantMessage = z.infer<typeof siteAssistantMessageSchema>;

export const siteAssistantRequestSchema = z
  .object({ messages: z.array(siteAssistantMessageSchema).min(1).max(SITE_ASSISTANT_MAX_MESSAGES) })
  .strict()
  .refine((r) => r.messages[r.messages.length - 1]?.role === "user", { message: "Last message must be from the user", path: ["messages"] });
export type SiteAssistantRequest = z.infer<typeof siteAssistantRequestSchema>;

/** Only same-site paths/anchors or wa.me links: a reply can never point the visitor elsewhere. */
const safeHref = z
  .string()
  .max(200)
  .refine((h) => /^\/(?!\/)[\w\-/#?=&.]*$/.test(h) || /^#[\w-]+$/.test(h) || /^https:\/\/wa\.me\/\d{6,15}(\?[\w%=&.+-]*)?$/.test(h), { message: "Unsafe href" });

export const siteAssistantActionSchema = z.object({
  kind: siteAssistantActionKindSchema,
  label: z.string().min(1).max(40),
  href: safeHref,
});
export type SiteAssistantAction = z.infer<typeof siteAssistantActionSchema>;

export const siteAssistantResponseSchema = z.object({
  reply: z.string().min(1).max(SITE_ASSISTANT_MAX_REPLY),
  action: siteAssistantActionSchema.nullable(),
  source: z.enum(["ai", "local"]),
});
export type SiteAssistantResponse = z.infer<typeof siteAssistantResponseSchema>;
