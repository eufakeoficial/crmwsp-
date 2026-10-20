import { describe, expect, it, vi } from "vitest";
import { createPlatformMeCache } from "./platform-me-cache";

describe("createPlatformMeCache", () => {
  it("caches true per user", async () => {
    const fetchMe = vi.fn().mockResolvedValue(true);
    const c = createPlatformMeCache(fetchMe);
    expect(await c.load("u1")).toBe(true);
    expect(await c.load("u1")).toBe(true);
    expect(c.peek("u1")).toBe(true);
    expect(fetchMe).toHaveBeenCalledTimes(1);
  });
  it("never caches false or errors, so a later grant is seen", async () => {
    const fetchMe = vi.fn().mockResolvedValueOnce(false).mockRejectedValueOnce(new Error("x")).mockResolvedValueOnce(true);
    const c = createPlatformMeCache(fetchMe);
    expect(await c.load("u1")).toBe(false);
    expect(c.peek("u1")).toBeNull();
    expect(await c.load("u1")).toBe(false);
    expect(await c.load("u1")).toBe(true);
    expect(fetchMe).toHaveBeenCalledTimes(3);
  });
  it("refetches when the user changes", async () => {
    const fetchMe = vi.fn().mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    const c = createPlatformMeCache(fetchMe);
    expect(await c.load("admin")).toBe(true);
    expect(c.peek("other")).toBeNull();
    expect(await c.load("other")).toBe(false);
    expect(fetchMe).toHaveBeenCalledTimes(2);
  });
  it("dedupes concurrent loads", async () => {
    const fetchMe = vi.fn().mockResolvedValue(true);
    const c = createPlatformMeCache(fetchMe);
    await Promise.all([c.load("u1"), c.load("u1")]);
    expect(fetchMe).toHaveBeenCalledTimes(1);
  });
});
