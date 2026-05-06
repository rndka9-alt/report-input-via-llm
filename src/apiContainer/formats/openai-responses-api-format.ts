import { z } from "zod";
import { ReportInputViaLLMError, type LLMMessage, type LLMOutput } from "../../core.js";
import type { LLMFormat } from "../llm-format.js";

export interface OpenAIResponsesAPIFormatOptions {
  maxTokens?: number;
  model: string;
  temperature?: number;
}

const responsesContentSchema = z
  .object({
    text: z.string().optional(),
    type: z.string().optional(),
  })
  .passthrough();

const responsesOutputItemSchema = z
  .object({
    content: z.array(responsesContentSchema).optional(),
    summary: z.array(responsesContentSchema).optional(),
    type: z.string().optional(),
  })
  .passthrough();

const responsesResponseSchema = z
  .object({
    output: z.array(responsesOutputItemSchema).optional(),
    output_text: z.string().optional(),
  })
  .passthrough();

export class OpenAIResponsesAPIFormat implements LLMFormat {
  readonly requestPath = "/responses";
  private readonly maxTokens: number | undefined;
  private readonly model: string;
  private readonly temperature: number | undefined;

  constructor(options: OpenAIResponsesAPIFormatOptions) {
    ensureNonEmptyString(options.model, "options.model");

    this.maxTokens = options.maxTokens;
    this.model = options.model;
    this.temperature = options.temperature;
  }

  createRequestBody(messages: readonly LLMMessage[]): Record<string, unknown> {
    const requestBody: Record<string, unknown> = {
      model: this.model,
      input: createResponsesInput(messages),
      text: {
        format: {
          type: "json_object",
        },
      },
    };
    const instructions = createResponsesInstructions(messages);

    if (instructions !== undefined) {
      requestBody.instructions = instructions;
    }

    if (this.maxTokens !== undefined) {
      requestBody.max_output_tokens = this.maxTokens;
    }

    if (this.temperature !== undefined) {
      requestBody.temperature = this.temperature;
    }

    return requestBody;
  }

  parseResponse(responseJson: unknown): LLMOutput {
    const parsedResponse = responsesResponseSchema.parse(responseJson);
    const outputText = parsedResponse.output_text ?? readOutputText(parsedResponse.output);

    if (outputText === undefined || outputText.length === 0) {
      throw new ReportInputViaLLMError(
        "OpenAI Responses API response must contain non-empty output_text or output content text.",
      );
    }

    const reasoningContent = readReasoningContent(parsedResponse.output);

    if (reasoningContent === undefined) {
      return {
        outputContent: outputText,
        raw: responseJson,
      };
    }

    return {
      outputContent: outputText,
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

function createResponsesInstructions(messages: readonly LLMMessage[]): string | undefined {
  const instructions = messages
    .filter((message) => message.role === "system")
    .map((message) => message.message)
    .join("\n\n");

  if (instructions.length === 0) {
    return undefined;
  }

  return instructions;
}

function createResponsesInput(messages: readonly LLMMessage[]): string {
  const input = messages
    .filter((message) => message.role !== "system")
    .map((message) => `${message.role}: ${message.message}`)
    .join("\n\n");

  if (input.length === 0) {
    throw new ReportInputViaLLMError("OpenAI Responses API input requires at least one non-system message.");
  }

  return input;
}

function readOutputText(output: z.infer<typeof responsesOutputItemSchema>[] | undefined): string | undefined {
  if (output === undefined) {
    return undefined;
  }

  const textValues = output.flatMap((outputItem) =>
    outputItem.content
      ?.filter((contentItem) => contentItem.type === undefined || contentItem.type === "output_text")
      .map((contentItem) => contentItem.text)
      .filter((textValue): textValue is string => textValue !== undefined) ?? [],
  );

  if (textValues.length === 0) {
    return undefined;
  }

  return textValues.join("");
}

function readReasoningContent(output: z.infer<typeof responsesOutputItemSchema>[] | undefined): string | undefined {
  if (output === undefined) {
    return undefined;
  }

  const reasoningValues = output.flatMap((outputItem) =>
    outputItem.summary
      ?.map((summaryItem) => summaryItem.text)
      .filter((textValue): textValue is string => textValue !== undefined) ?? [],
  );

  if (reasoningValues.length === 0) {
    return undefined;
  }

  return reasoningValues.join("\n");
}
