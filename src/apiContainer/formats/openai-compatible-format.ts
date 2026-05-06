import { z } from "zod";
import { ReportInputViaLLMError, type LLMMessage, type LLMOutput } from "../../core.js";
import type { LLMFormat } from "../llm-format.js";

export interface OpenAICompatibleFormatOptions {
  maxTokens?: number;
  model: string;
  temperature?: number;
}

const chatCompletionResponseSchema = z
  .object({
    choices: z
      .array(
        z
          .object({
            message: z
              .object({
                content: z.string().nullable().optional(),
                reasoning_content: z.string().optional(),
              })
              .passthrough(),
          })
          .passthrough(),
      )
      .min(1),
  })
  .passthrough();

export class OpenAICompatibleFormat implements LLMFormat {
  readonly requestPath = "/chat/completions";
  private readonly maxTokens: number | undefined;
  private readonly model: string;
  private readonly temperature: number | undefined;

  constructor(options: OpenAICompatibleFormatOptions) {
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
      response_format: {
        type: "json_object",
      },
    };

    if (this.maxTokens !== undefined) {
      requestBody.max_tokens = this.maxTokens;
    }

    if (this.temperature !== undefined) {
      requestBody.temperature = this.temperature;
    }

    return requestBody;
  }

  parseResponse(responseJson: unknown): LLMOutput {
    const parsedResponse = chatCompletionResponseSchema.parse(responseJson);
    const firstChoice = parsedResponse.choices[0];

    if (firstChoice === undefined) {
      throw new ReportInputViaLLMError("OpenAI-compatible chat response has no choices.");
    }

    const outputContent = firstChoice.message.content;

    if (outputContent === undefined || outputContent === null || outputContent.length === 0) {
      throw new ReportInputViaLLMError(
        "OpenAI-compatible chat response message.content must be a non-empty string.",
      );
    }

    const reasoningContent = firstChoice.message.reasoning_content;

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
}

function ensureNonEmptyString(value: string, path: string): void {
  if (value.trim().length === 0) {
    throw new ReportInputViaLLMError(`${path} must be a non-empty string.`);
  }
}
