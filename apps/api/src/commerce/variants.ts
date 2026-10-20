import { ConflictError, NotFoundError, type VariantInput } from "@crmwsp/contracts";
import { and, eq, productVariants, sql, stockMovements, type Transaction } from "@crmwsp/db";
import { PG_UNIQUE_VIOLATION, pgCode } from "../inbox/audit.js";
import { cleanOptions, optionKeyOf } from "./products.queries.js";

const big = (n: number | null | undefined): bigint | null => (n === null || n === undefined ? null : BigInt(n));

export interface VariantChange {
  variantId: string;
  created: boolean;
  stockDelta: number;
}

/**
 * Upserts variants of one product. Matches by `id` or, otherwise, by normalized options.
 * Manual stock changes write `stock_movements` (`manual_adjust`, or `import` when `reason` says so).
 * The caller must hold the product row lock.
 */
export async function upsertVariants(
  tx: Transaction,
  tenantId: string,
  userId: string | null,
  productId: string,
  inputs: readonly VariantInput[],
  reason: "manual_adjust" | "import" = "manual_adjust",
): Promise<VariantChange[]> {
  const existing = await tx.select().from(productVariants).where(eq(productVariants.productId, productId)).for("update");
  const byId = new Map(existing.map((v) => [v.id, v]));
  const byKey = new Map(existing.map((v) => [v.optionKey, v]));
  let nextPosition = existing.reduce((m, v) => Math.max(m, v.position), -1) + 1;
  const changes: VariantChange[] = [];

  for (const input of inputs) {
    let current = input.id ? byId.get(input.id) : undefined;
    if (input.id && !current) throw new NotFoundError();
    const options = input.options ? cleanOptions(input.options) : undefined;
    const key = options ? optionKeyOf(options) : undefined;
    if (!current && !input.id) current = byKey.get(key ?? "");

    try {
      if (!current) {
        const stock = input.stockOnHand ?? 0;
        const [row] = await tx
          .insert(productVariants)
          .values({
            tenantId,
            productId,
            sku: input.sku ?? null,
            options: options ?? {},
            optionKey: key ?? "",
            priceMinor: big(input.priceMinor),
            compareAtMinor: big(input.compareAtMinor),
            stockOnHand: stock,
            isActive: input.isActive ?? true,
            position: nextPosition++,
          })
          .returning();
        if (!row) throw new Error("insert returned no row");
        byId.set(row.id, row);
        byKey.set(row.optionKey, row);
        if (stock > 0) {
          await tx.insert(stockMovements).values({ tenantId, variantId: row.id, delta: stock, reason, createdBy: userId });
        }
        changes.push({ variantId: row.id, created: true, stockDelta: stock });
        continue;
      }

      const set: Partial<typeof productVariants.$inferInsert> = {};
      if (options !== undefined && key !== current.optionKey) {
        set.options = options;
        set.optionKey = key as string;
      }
      if (input.sku !== undefined) set.sku = input.sku;
      if (input.priceMinor !== undefined) set.priceMinor = big(input.priceMinor);
      if (input.compareAtMinor !== undefined) set.compareAtMinor = big(input.compareAtMinor);
      if (input.isActive !== undefined) set.isActive = input.isActive;
      let delta = 0;
      if (input.stockOnHand !== undefined && input.stockOnHand !== current.stockOnHand) {
        if (input.stockOnHand < current.stockReserved) {
          throw new ConflictError("Stock on hand cannot go below the reserved quantity");
        }
        delta = input.stockOnHand - current.stockOnHand;
        set.stockOnHand = input.stockOnHand;
      }
      if (Object.keys(set).length > 0) {
        await tx
          .update(productVariants)
          .set({ ...set, updatedAt: sql`now()` })
          .where(and(eq(productVariants.id, current.id)));
      }
      if (delta !== 0) {
        await tx.insert(stockMovements).values({ tenantId, variantId: current.id, delta, reason, createdBy: userId });
      }
      changes.push({ variantId: current.id, created: false, stockDelta: delta });
    } catch (err) {
      if (pgCode(err) === PG_UNIQUE_VIOLATION) throw new ConflictError("SKU or option combination already exists");
      throw err;
    }
  }
  return changes;
}
