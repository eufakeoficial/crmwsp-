import { Injectable } from "@nestjs/common";
import { OpenAICompatibleProvider, type LLMProvider, type LookupFn } from "@crmwsp/ai";

export interface LlmProviderParams {
  baseUrl: string;
  apiKey: string;
  /** False when the connection test found no json_schema support (forces the json_object fallback). */
  supportsJsonSchema?: boolean;
}

/**
 * Builds the LLM provider for a stored connection. Injectable so tests can
 * replace the HTTP layer: set `fetchImpl` / `lookup` on the instance
 * (`app.get(LlmProviderFactory)`); production leaves both undefined.
 */
@Injectable()
export class LlmProviderFactory {
  fetchImpl: typeof globalThis.fetch | undefined;
  lookup: LookupFn | undefined;

  create(params: LlmProviderParams): LLMProvider {
    return new OpenAICompatibleProvider({
      baseUrl: params.baseUrl,
      apiKey: params.apiKey,
      ...(params.supportsJsonSchema === false ? { supportsJsonSchema: false } : {}),
      ...(this.fetchImpl ? { fetch: this.fetchImpl } : {}),
      ...(this.lookup ? { lookup: this.lookup } : {}),
    });
  }
}
