"use client";

import { useEffect, useState } from "react";
import { useSession } from "@/components/app/SessionProvider";
import { platformApi } from "@/lib/platform-api";
import { createPlatformMeCache } from "@/lib/platform-me-cache";

const cache = createPlatformMeCache(() => platformApi.me().then((r) => r.isPlatformAdmin));

/** Is the signed-in user a platform admin? `null` while loading. Errors count as "no". */
export function usePlatformMe(): boolean | null {
  const userId = useSession().me.user.id;
  const [state, setState] = useState<{ userId: string; value: boolean } | null>(null);
  useEffect(() => {
    let alive = true;
    void cache.load(userId).then((value) => alive && setState({ userId, value }));
    return () => {
      alive = false;
    };
  }, [userId]);
  if (state?.userId === userId) return state.value;
  return cache.peek(userId);
}
