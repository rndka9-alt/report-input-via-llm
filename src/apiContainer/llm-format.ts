import type { LLMMessage, LLMOutput } from "../core.js";

export interface LLMFormat {
  requestPath?: string;
  createRequestBody(messages: readonly LLMMessage[]): Record<string, unknown>;
  parseResponse(responseJson: unknown): LLMOutput;
}
