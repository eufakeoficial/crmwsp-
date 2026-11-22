import { describe, expect, it } from "vitest";
import { TtlCache } from "./wallet-cache.js";

describe("TtlCache", () => {
  it("returns fresh values and hides expired ones", () => {
    const c = new TtlCache<number>(100);
    c.set("a", 1, 0);
    expect(c.get("a", 99)).toBe(1);
    expect(c.get("a", 100)).toBeUndefined();
  });

  it("prunes expired entries on write", () => {
    const c = new TtlCache<number>(100);
    c.set("a", 1, 0);
    c.set("b", 2, 50);
    c.set("c", 3, 120);
    expect(c.size).toBe(2); // "a" expired and was dropped
    expect(c.get("a", 120)).toBeUndefined();
  });

  it("caps the size dropping the oldest", () => {
    const c = new TtlCache<number>(1_000_000, 3);
    for (let i = 0; i < 5; i++) c.set(`k${i}`, i, i);
    expect(c.size).toBe(3);
    expect(c.get("k0", 10)).toBeUndefined();
    expect(c.get("k1", 10)).toBeUndefined();
    expect(c.get("k4", 10)).toBe(4);
  });

  it("refreshing a key makes it the newest", () => {
    const c = new TtlCache<number>(1_000_000, 2);
    c.set("a", 1, 0);
    c.set("b", 2, 1);
    c.set("a", 3, 2);
    c.set("c", 4, 3);
    expect(c.get("b", 4)).toBeUndefined();
    expect(c.get("a", 4)).toBe(3);
  });
});
