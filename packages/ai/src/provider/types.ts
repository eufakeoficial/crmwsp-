import type { z } from "zod";

export type ChatRole = "system" | "user" | "assistant";
export interface ChatMessage {
  role: ChatRole;
  content: string;
}

export interface ResponseFormat<T> {
  name: string;
  /** JSON Schema sent to the provider (must satisfy OpenAI strict-mode rules). */
  jsonSchema: Record<string, unknown>;
  /** Zod schema used to validate the model output. Always applied. */
  schema: z.ZodType<T>;
}

export interface ChatRequest<T = unknown> {
  model: string;
  messages: ChatMessage[];
  responseFormat?: ResponseFormat<T>;
  temperature?: number;
  maxTokens?: number;
}

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
}

export interface ChatResult<T = unknown> {
  content: string;
  parsed?: T;
  usage: TokenUsage;
  model: string;
  finishReason: string;
  /** How structured output was obtained, when requested. */
  structuredMode?: "json_schema" | "json_object";
}

export interface EmbedRequest {
  model: string;
  input: string[];
}
export interface EmbedResult {
  vectors: number[][];
  dims: number;
  usage: { inputTokens: number };
}

export interface TranscribeRequest {
  model: string;
  audio: Uint8Array;
  mimeType: string;
}
export interface TranscribeResult {
  text: string;
  durationSeconds?: number;
}

export interface ConnectionTestRequest {
  modelCheap: string;
  modelStrong: string;
  /** Defaults to `text-embedding-3-small`. */
  modelEmbedding?: string;
  /** Defaults to `whisper-1`. */
  modelTranscription?: string;
}
export interface ConnectionTestResult {
  ok: boolean;
  capabilities: { structuredOutput: boolean; embeddings: boolean; transcription: boolean };
  latencyMs: number;
  error?: string;
}

/** Provider-agnostic LLM port (ADR 0008). */
export interface LLMProvider {
  readonly name: string;
  chat<T = unknown>(req: ChatRequest<T>): Promise<ChatResult<T>>;
  embed(req: EmbedRequest): Promise<EmbedResult>;
  transcribe(req: TranscribeRequest): Promise<TranscribeResult>;
  testConnection(req: ConnectionTestRequest): Promise<ConnectionTestResult>;
}
