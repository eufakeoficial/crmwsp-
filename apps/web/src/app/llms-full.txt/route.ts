import { buildLlmsFullTxt, LLMS_HEADERS } from "../llms.txt/content";

export const dynamic = "force-static";

export function GET() {
  return new Response(buildLlmsFullTxt(), { headers: LLMS_HEADERS });
}
