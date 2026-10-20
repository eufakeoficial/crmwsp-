export * from "./schema/index.js";
export { createDb } from "./client.js";
export type { CreateDbOptions, Database, DbHandle, Schema, Transaction } from "./client.js";
export { dangerouslyWithoutTenant, isUuid, withTenant } from "./with-tenant.js";
export type { WithTenantOptions } from "./with-tenant.js";
export { searchChunks, searchChunksText } from "./knowledge-search.js";
export type { ChunkHit, SearchChunksParams, SearchChunksTextParams } from "./knowledge-search.js";
// Query operators re-exported so consumers (e.g. the CJS API) share this
// package's drizzle-orm instance and types instead of resolving their own.
export { and, asc, desc, eq, gt, ilike, inArray, isNull, lt, ne, or, sql } from "drizzle-orm";
export { computeLineTotal, divRoundHalfEven } from "./line-total.js";
export { consumeUsage, readPlanUsage } from "./plan-usage.js";
export type { CounterKey, PlanUsageSnapshot } from "./plan-usage.js";
export { enqueueWebhookEvent } from "./webhook-events.js";
export type { OutboundWebhookEventType } from "./webhook-events.js";
export type { SQL } from "drizzle-orm";
export { not, exists } from "drizzle-orm";
export { renderSql } from "./render-sql.js";
export { readBudget, type BudgetState } from "./ai-budget.js";
export {
  decideAiActionAsUser,
  findVerifiedOwner,
  hashOwnerSecret,
  isTenantAiPaused,
  newOwnerSalt,
  newOwnerSecret,
  ownerSecretMatches,
  setTenantAiPaused,
} from "./owner-mode.js";
export type { AiActionDecisionResult, VerifiedOwner } from "./owner-mode.js";
