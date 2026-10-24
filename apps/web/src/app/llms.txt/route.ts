import { buildLlmsTxt, LLMS_HEADERS } from "./content";

export const dynamic = "force-static";

export function GET() {
  return new Response(buildLlmsTxt(), { headers: LLMS_HEADERS });
}
