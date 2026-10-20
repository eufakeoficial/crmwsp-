import { notificationListSchema } from "@crmwsp/contracts";
import { z } from "zod";
import { request } from "./api";

const unreadSchema = z.object({ unreadCount: z.number().int().nonnegative() });

export const notificationsApi = {
  list: (q: { limit?: number; unreadOnly?: boolean } = {}) =>
    request("/notifications", {
      query: { limit: q.limit, unreadOnly: q.unreadOnly ? "true" : undefined },
      schema: notificationListSchema,
    }),
  unreadCount: () => request("/notifications/unread-count", { schema: unreadSchema }),
  markRead: (ids: string[]) => request("/notifications/read", { method: "POST", body: { ids }, schema: unreadSchema }),
  markAllRead: () => request("/notifications/read", { method: "POST", body: { all: true }, schema: unreadSchema }),
};
