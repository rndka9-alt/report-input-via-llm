import { z } from "zod";
import { ReportInputViaLLMError, type LLMMessage, type LLMOutput } from "../../core.js";
import type { LLMFormat } from "../llm-format.js";

export interface AnthropicMessagesAPIFormatOptions {
  maxTokens: number;
  model: string;
  temperature?: number;
  thinking?: Record<string, unknown>;
  topK?: number;
  topP?: number;
}

const anthropicContentBlockSchema = z
  .object({
    text: z.string().optional(),
    thinking: z.string().optional(),
    type: z.string(),
  })
  .passthrough();

const anthropicMessageResponseSchema = z
  .object({
    content: z.array(anthropicContentBlockSchema).min(1),
  })
  .passthrough();

export class AnthropicMessagesAPIFormat implements LLMFormat {
  readonly requestPath = "/v1/messages";
  private readonly maxTokens: number;
  private readonly model: string;
  private readonly temperature: number | undefined;
  private readonly thinking: Record<string, unknown> | undefined;
  private readonly topK: number | undefined;
  private readonly topP: number | undefined;

  constructor(options: AnthropicMessagesAPIFormatOptions) {
    ensureNonEmptyString(options.model, "options.model");

    this.maxTokens = options.maxTokens;
    this.model = options.model;
    this.temperature = options.temperature;
    this.thinking = options.thinking;
    this.topK = options.topK;
    this.topP = options.topP;
  }

  createRequestBody(messages: readonly LLMMessage[]): Record<string, unknown> {
    const requestBody: Record<string, unknown> = {
      max_tokens: this.maxTokens,
      messages: createAnthropicMessages(messages),
      model: this.model,
    };
    const systemPrompt = createSystemPrompt(messages);

    if (systemPrompt !== undefined) {
      requestBody.system = systemPrompt;
    }

    if (this.temperature !== undefined) {
      requestBody.temperature = this.temperature;
    }

    if (this.thinking !== undefined) {
      requestBody.thinking = this.thinking;
    }

    if (this.topK !== undefined) {
      requestBody.top_k = this.topK;
    }

    if (this.topP !== undefined) {
      requestBody.top_p = this.topP;
    }

    return requestBody;
  }

  parseResponse(responseJson: unknown): LLMOutput {
    const parsedResponse = anthropicMessageResponseSchema.parse(responseJson);
    const outputContent = parsedResponse.content
      .filter((contentBlock) => contentBlock.type === "text")
      .map((contentBlock) => contentBlock.text)
      .filter((textValue): textValue is string => textValue !== undefined)
      .join("");

    if (outputContent.length === 0) {
      throw new ReportInputViaLLMError("Anthropic Messages API response must contain text content.");
    }

    const reasoningContent = parsedResponse.content
      .filter((contentBlock) => contentBlock.type === "thinking")
      .map((contentBlock) => contentBlock.thinking)
      .filter((thinkingValue): thinkingValue is string => thinkingValue !== undefined)
      .join("\n");

    if (reasoningContent.length === 0) {
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

function createSystemPrompt(messages: readonly LLMMessage[]): string | undefined {
  const systemPrompt = messages
    .filter((message) => message.role === "system")
    .map((message) => message.message)
    .join("\n\n");

  if (systemPrompt.length === 0) {
    return undefined;
  }

  return systemPrompt;
}

function createAnthropicMessages(messages: readonly LLMMessage[]): { content: string; role: "user" | "assistant" }[] {
  const anthropicMessages = messages
    .filter(isAnthropicMessage)
    .map((message) => ({
      role: message.role,
      content: message.message,
    }));

  if (anthropicMessages.length === 0) {
    throw new ReportInputViaLLMError("Anthropic Messages API requires at least one non-system message.");
  }

  return anthropicMessages;
}

function isAnthropicMessage(
  message: LLMMessage,
): message is LLMMessage & { role: "user" | "assistant" } {
  return message.role === "user" || message.role === "assistant";
}

function ensureNonEmptyString(value: string, path: string): void {
  if (value.trim().length === 0) {
    throw new ReportInputViaLLMError(`${path} must be a non-empty string.`);
  }
}
