import {
  type CreateCannedResponseRequest,
  type CreateReminderRequest,
  type CreateTagRequest,
  type InboxStatus,
  type ListInboxConversationsQuery,
  type PatchInboxSettingsRequest,
  cannedResponseListResponseSchema,
  cannedResponseSchema,
  contactPanelSchema,
  conversationNoteSchema,
  inboxConversationListResponseSchema,
  inboxConversationSchema,
  inboxCountsSchema,
  inboxSettingsSchema,
  noteListResponseSchema,
  reminderListResponseSchema,
  reminderSchema,
  tagListResponseSchema,
  tagSchema,
} from "@crmwsp/contracts";
import { z } from "zod";
import { request } from "./api";

export type InboxListParams = Partial<
  Pick<ListInboxConversationsQuery, "status" | "sort" | "assignedTo" | "tag" | "channelConnectionId" | "q" | "limit">
> & { unread?: boolean | undefined; reminders?: boolean | undefined; cursor?: string | null | undefined };

const flag = (v: boolean | undefined) => (v ? "true" : undefined);

const pausedSchema = z.object({ automationsPausedUntil: z.string().nullable() });

/** Inbox v2 endpoints (T23a): folders, assignment, notes, reminders, tags, canned responses, settings. */
export const inboxV2Api = {
  list: (p: InboxListParams = {}) =>
    request("/inbox/conversations", {
      query: {
        status: p.status,
        sort: p.sort,
        assignedTo: p.assignedTo,
        tag: p.tag,
        channelConnectionId: p.channelConnectionId,
        q: p.q,
        unread: flag(p.unread),
        reminders: flag(p.reminders),
        cursor: p.cursor ?? undefined,
        limit: p.limit,
      },
      schema: inboxConversationListResponseSchema,
    }),
  counts: () => request("/inbox/counts", { schema: inboxCountsSchema }),
  get: (id: string) => request(`/inbox/conversations/${id}`, { schema: inboxConversationSchema }),
  /** `assignee`: "me", a member id, or null to unassign. */
  assign: (id: string, assignee: string | null) =>
    request(`/inbox/conversations/${id}/assign`, { method: "POST", body: { assignee }, schema: inboxConversationSchema }),
  setStatus: (id: string, status: InboxStatus) =>
    request(`/inbox/conversations/${id}/status`, { method: "POST", body: { status }, schema: inboxConversationSchema }),
  markUnread: (id: string) => request(`/inbox/conversations/${id}/unread`, { method: "POST" }),

  notes: (id: string) => request(`/inbox/conversations/${id}/notes`, { schema: noteListResponseSchema }),
  addNote: (id: string, body: string) =>
    request(`/inbox/conversations/${id}/notes`, { method: "POST", body: { body }, schema: conversationNoteSchema }),

  reminders: () => request("/inbox/reminders", { schema: reminderListResponseSchema }),
  addReminder: (id: string, input: CreateReminderRequest) =>
    request(`/inbox/conversations/${id}/reminders`, { method: "POST", body: input, schema: reminderSchema }),

  contactPanel: (contactId: string) => request(`/inbox/contacts/${contactId}/panel`, { schema: contactPanelSchema }),
  /** minutes = null resumes automations now. */
  pauseAutomations: (contactId: string, minutes: number | null) =>
    request(`/inbox/contacts/${contactId}/pause-automations`, { method: "POST", body: { minutes }, schema: pausedSchema }),

  tags: () => request("/inbox/tags", { schema: tagListResponseSchema }),
  createTag: (input: CreateTagRequest) => request("/inbox/tags", { method: "POST", body: input, schema: tagSchema }),

  cannedResponses: (q?: string) => request("/inbox/canned-responses", { query: { q }, schema: cannedResponseListResponseSchema }),
  createCannedResponse: (input: CreateCannedResponseRequest) =>
    request("/inbox/canned-responses", { method: "POST", body: input, schema: cannedResponseSchema }),

  settings: () => request("/settings/inbox", { schema: inboxSettingsSchema }),
  patchSettings: (patch: PatchInboxSettingsRequest) =>
    request("/settings/inbox", { method: "PATCH", body: patch, schema: inboxSettingsSchema }),
};
