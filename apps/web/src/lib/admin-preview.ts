import { notFound } from "next/navigation";

/**
 * There is no platform superadmin role yet: the backoffice preview is only reachable
 * outside production or when the server env ENABLE_ADMIN_PREVIEW=1. Called from both the
 * admin layout and page, because Next renders them in parallel.
 */
export function assertAdminPreviewEnabled(): void {
  if (process.env.NODE_ENV !== "production" || process.env["ENABLE_ADMIN_PREVIEW"] === "1") return;
  notFound();
}
