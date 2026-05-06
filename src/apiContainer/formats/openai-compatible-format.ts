import { z } from "zod";
import { ReportInputViaLLMError, type LLMMessage, type LLMOutput } from "../../core.js";
import type { LLMFormat, LLMFormatRequestOptions } from "../llm-format.js";

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
  createRequestBody(
    messages: readonly LLMMessage[],
    options: LLMFormatRequestOptions,
  ): Record<string, unknown> {
    const requestBody: Record<string, unknown> = {
      model: options.model,
      messages: messages.map((message) => ({
        role: message.role,
        content: message.message,
      })),
      response_format: {
        type: "json_object",
      },
    };

    if (options.maxTokens !== undefined) {
      requestBody.max_tokens = options.maxTokens;
    }

    if (options.temperature !== undefined) {
      requestBody.temperature = options.temperature;
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
