import { Dialog360Provider } from "./dialog360/provider.js";
import { GupshupProvider } from "./gupshup/provider.js";
import type { WhatsAppProvider } from "./provider.js";
import { RoutingWhatsAppProvider } from "./router.js";

/** Production provider: Gupshup and 360dialog behind one router keyed by the channel's BSP. */
export function createDefaultWhatsAppProvider(): WhatsAppProvider {
  return new RoutingWhatsAppProvider({ gupshup: new GupshupProvider(), "360dialog": new Dialog360Provider() });
}
