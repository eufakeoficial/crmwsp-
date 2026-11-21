"use client";

import Script from "next/script";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useSyncExternalStore } from "react";
import { getConsentSnapshot, getServerConsentSnapshot, subscribeConsent } from "@/lib/consent";
import { META_PIXEL_ID, POSTHOG_HOST, POSTHOG_KEY, flushMeta, metaPixelSnippet, setPostHog, trackMeta, trackPostHog } from "@/lib/tracking";

/**
 * Loads Meta Pixel and PostHog only after the visitor accepted cookies and only when the matching
 * NEXT_PUBLIC_* variable is set. Renders nothing otherwise, so there is zero cost without consent.
 */
export function Tracking() {
  const consent = useSyncExternalStore(subscribeConsent, getConsentSnapshot, getServerConsentSnapshot);
  const pathname = usePathname();
  const first = useRef(true);
  const accepted = consent === "accepted";

  // PostHog: dynamic import so the SDK never ships in the initial bundle.
  useEffect(() => {
    const key = POSTHOG_KEY;
    if (!accepted || !key) return;
    let cancelled = false;
    void import("posthog-js").then(({ default: posthog }) => {
      if (cancelled) return;
      posthog.init(key, {
        api_host: POSTHOG_HOST,
        capture_pageview: false, // sent manually on route changes below
        autocapture: false,
        disable_session_recording: true,
        session_recording: { maskAllInputs: true },
        person_profiles: "identified_only",
      });
      posthog.opt_in_capturing();
      setPostHog(posthog);
    }).catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [accepted]);

  // Page views on first load after consent and on every client-side navigation.
  useEffect(() => {
    if (!accepted) return;
    if (first.current) first.current = false;
    else trackMeta("PageView");
    trackPostHog("$pageview", { $current_url: window.location.href });
    if (pathname === "/signup") trackMeta("Lead");
  }, [accepted, pathname]);

  if (!accepted || !META_PIXEL_ID) return null;
  return (
    <Script id="meta-pixel" strategy="lazyOnload" onReady={flushMeta}>
      {`${metaPixelSnippet(META_PIXEL_ID)}fbq('track','PageView');`}
    </Script>
  );
}
