/* global self */
// Minimal service worker: makes the app installable. It deliberately caches
// nothing: the panel is authenticated and tenant-scoped, so stale or shared
// cached responses would be a data-leak risk.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));
self.addEventListener("fetch", () => {});
