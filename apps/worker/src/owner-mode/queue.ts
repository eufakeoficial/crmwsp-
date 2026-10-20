/** Owner-mode queue (F9): one job per inbound owner WhatsApp message. Payload carries ids only. */
export const OWNER_MODE_QUEUE_NAME = "owner-mode";
export const OWNER_COMMAND_JOB = "owner-command";

export interface OwnerCommandJobData {
  tenantId: string;
  commandId: string;
}

export const OWNER_COMMAND_JOB_OPTIONS = {
  attempts: 3,
  backoff: { type: "exponential", delay: 2_000 },
  removeOnComplete: { age: 24 * 3600, count: 10_000 },
  removeOnFail: { age: 7 * 24 * 3600 },
} as const;

export const ownerCommandJobId = (commandId: string): string => `owner-cmd-${commandId}`;
