/** Small TTL cache with a size cap: expired entries are pruned on write and the oldest are dropped past the cap. */
export class TtlCache<V> {
  private readonly entries = new Map<string, { at: number; value: V }>();

  constructor(
    private readonly ttlMs: number,
    private readonly maxEntries = 1000,
  ) {}

  get(key: string, now = Date.now()): V | undefined {
    const hit = this.entries.get(key);
    return hit && now - hit.at < this.ttlMs ? hit.value : undefined;
  }

  set(key: string, value: V, now = Date.now()): void {
    for (const [k, e] of this.entries) if (now - e.at >= this.ttlMs) this.entries.delete(k);
    this.entries.delete(key); // re-insert so Map order stays oldest-first
    this.entries.set(key, { at: now, value });
    while (this.entries.size > this.maxEntries) {
      const oldest = this.entries.keys().next().value as string;
      this.entries.delete(oldest);
    }
  }

  delete(key: string): void {
    this.entries.delete(key);
  }

  get size(): number {
    return this.entries.size;
  }
}
