import { Injectable } from "@nestjs/common";
import { OpenAICompatibleProvider, type LLMProvider, type LookupFn } from "@crmwsp/ai";

export interface LlmProviderParams {
  baseUrl: string;
  apiKey: string;
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
      ...(this.fetchImpl ? { fetch: this.fetchImpl } : {}),
      ...(this.lookup ? { lookup: this.lookup } : {}),
    });
  }
}
