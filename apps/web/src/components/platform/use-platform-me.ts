"use client";

import { useEffect, useState } from "react";
import { platformApi } from "@/lib/platform-api";

let cached: Promise<boolean> | null = null;

/** Is the signed-in user a platform admin? `null` while loading. Errors count as "no". */
export function usePlatformMe(): boolean | null {
  const [value, setValue] = useState<boolean | null>(null);
  useEffect(() => {
    let alive = true;
    cached ??= platformApi.me().then(
      (r) => r.isPlatformAdmin,
      () => {
        cached = null;
        return false;
      },
    );
    void cached.then((v) => alive && setValue(v));
    return () => {
      alive = false;
    };
  }, []);
  return value;
}
