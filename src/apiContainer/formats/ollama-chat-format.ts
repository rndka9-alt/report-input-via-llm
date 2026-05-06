import { z } from "zod";
import { ReportInputViaLLMError, type LLMMessage, type LLMOutput } from "../../core.js";
import type { LLMFormat } from "../llm-format.js";

export const ollamaCloudDeepSeekModels = {
  deepseekV4Flash: "deepseek-v4-flash:cloud",
  deepseekV4Pro: "deepseek-v4-pro:cloud",
} as const;

export type OllamaCloudDeepSeekModel =
  (typeof ollamaCloudDeepSeekModels)[keyof typeof ollamaCloudDeepSeekModels];

export interface OllamaChatFormatOptions {
  maxTokens?: number;
  model: OllamaCloudDeepSeekModel | string;
  temperature?: number;
}

const ollamaChatResponseSchema = z
  .object({
    message: z
      .object({
        content: z.string().optional(),
        thinking: z.string().optional(),
      })
      .passthrough()
      .optional(),
    response: z.string().optional(),
  })
  .passthrough();

export class OllamaChatFormat implements LLMFormat {
  readonly requestPath = "/chat";
  private readonly maxTokens: number | undefined;
  private readonly model: string;
  private readonly temperature: number | undefined;

  constructor(options: OllamaChatFormatOptions) {
    ensureNonEmptyString(options.model, "options.model");

    this.maxTokens = options.maxTokens;
    this.model = options.model;
    this.temperature = options.temperature;
  }

  createRequestBody(messages: readonly LLMMessage[]): Record<string, unknown> {
    const requestBody: Record<string, unknown> = {
      model: this.model,
      messages: messages.map((message) => ({
        role: message.role,
        content: message.message,
      })),
      stream: false,
    };
    const ollamaOptions = this.createOllamaOptions();

    if (ollamaOptions !== undefined) {
      requestBody.options = ollamaOptions;
    }

    return requestBody;
  }

  parseResponse(responseJson: unknown): LLMOutput {
    const parsedResponse = ollamaChatResponseSchema.parse(responseJson);
    const outputContent = parsedResponse.message?.content ?? parsedResponse.response;

    if (outputContent === undefined || outputContent.length === 0) {
      throw new ReportInputViaLLMError(
        "Ollama chat response must contain non-empty message.content or response.",
      );
    }

    const reasoningContent = parsedResponse.message?.thinking;

    if (reasoningContent === undefined) {
      return {
        outputContent,
        raw: responseJson,
      };
    }

    return {
      outputContent,
      reasoningContent,
      raw: responseJson,
    };
  }

  private createOllamaOptions(): Record<string, unknown> | undefined {
    const ollamaOptions: Record<string, unknown> = {};

    if (this.maxTokens !== undefined) {
      ollamaOptions.num_predict = this.maxTokens;
    }

    if (this.temperature !== undefined) {
      ollamaOptions.temperature = this.temperature;
    }

    if (Object.keys(ollamaOptions).length === 0) {
      return undefined;
    }

    return ollamaOptions;
  }
}

function ensureNonEmptyString(value: string, path: string): void {
  if (value.trim().length === 0) {
    throw new ReportInputViaLLMError(`${path} must be a non-empty string.`);
  }
}
