import type { LLMMessage, LLMOutput } from "../core.js";

export interface LLMFormatRequestOptions {
  maxTokens?: number;
  model: string;
  temperature?: number;
}

export interface LLMFormat {
  createRequestBody(
    messages: readonly LLMMessage[],
    options: LLMFormatRequestOptions,
  ): Record<string, unknown>;
  parseResponse(responseJson: unknown): LLMOutput;
}
