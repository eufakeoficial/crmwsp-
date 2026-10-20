import {
  type ConversationStatus,
  type CreateGupshupChannelRequest,
  type UpdateConversationRequest,
  attachmentUrlResponseSchema,
  channelListResponseSchema,
  channelSchema,
  contactListResponseSchema,
  contactSchema,
  conversationListResponseSchema,
  conversationSchema,
  messageListResponseSchema,
  messageSchema,
} from "@crmwsp/contracts";
import { request } from "./api";

export type AssigneeFilter = "me" | "unassigned" | undefined;

export interface ListConversationsParams {
  status?: ConversationStatus | undefined;
  assignedTo?: AssigneeFilter;
  cursor?: string | null | undefined;
  limit?: number | undefined;
}

/** Client-generated idempotency key for a message send. */
export function newClientMessageId(): string {
  return crypto.randomUUID();
}

export const channelsApi = {
  list: () => request("/channels", { schema: channelListResponseSchema }),
  createGupshup: (input: CreateGupshupChannelRequest) =>
    request("/channels/gupshup", { method: "POST", body: input, schema: channelSchema }),
  rotateWebhookToken: (id: string) =>
    request(`/channels/${id}/rotate-webhook-token`, { method: "POST", schema: channelSchema }),
  setStatus: (id: string, status: "active" | "disabled") =>
    request(`/channels/${id}`, { method: "PATCH", body: { status }, schema: channelSchema }),
};

export const conversationsApi = {
  list: ({ status, assignedTo, cursor, limit }: ListConversationsParams = {}) =>
    request("/conversations", {
      query: { status, assignedTo, cursor: cursor ?? undefined, limit },
      schema: conversationListResponseSchema,
    }),
  get: (id: string) => request(`/conversations/${id}`, { schema: conversationSchema }),
  messages: (id: string, params: { before?: string | null | undefined; limit?: number | undefined } = {}) =>
    request(`/conversations/${id}/messages`, {
      query: { before: params.before ?? undefined, limit: params.limit },
      schema: messageListResponseSchema,
    }),
  markRead: (id: string) => request(`/conversations/${id}/read`, { method: "POST" }),
  /** `lockVersion` is mandatory: a stale value answers 409. */
  update: (id: string, patch: Omit<UpdateConversationRequest, "lockVersion">, lockVersion: number) =>
    request(`/conversations/${id}`, {
      method: "PATCH",
      body: { ...patch, lockVersion },
      schema: conversationSchema,
    }),
  /** 202 with the queued message. Pass the same clientMessageId on retries. */
  send: (id: string, text: string, clientMessageId: string = newClientMessageId()) =>
    request(`/conversations/${id}/messages`, {
      method: "POST",
      body: { text, clientMessageId },
      schema: messageSchema,
    }),
  /** 202 with the queued template message (works outside the 24 h window). */
  sendTemplate: (id: string, templateId: string, params: string[]) =>
    request(`/conversations/${id}/template-messages`, {
      method: "POST",
      body: { templateId, params },
      schema: messageSchema,
    }),
};

export const contactsApi = {
  list: (params: { q?: string | undefined; limit?: number | undefined } = {}) =>
    request("/contacts", { query: params, schema: contactListResponseSchema }),
  get: (id: string) => request(`/contacts/${id}`, { schema: contactSchema }),
};

export const attachmentsApi = {
  /** Short-lived signed URL (about 5 minutes); fetch it lazily, do not cache it long. */
  url: (id: string) => request(`/attachments/${id}/url`, { schema: attachmentUrlResponseSchema }),
};
