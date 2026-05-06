import type { LLMMessage } from "../core.js";
import { OpenAIContainer } from "./openai-container.js";
import type { FetchLike } from "./fetch-like.js";
import type { OpenAIContainerFormat } from "./openai-container.js";

export type VercelAIGatewayContainerFormat = OpenAIContainerFormat;

export interface VercelAIGatewayContainerOptions {
  apiKey?: string;
  fetch?: FetchLike;
  format: VercelAIGatewayContainerFormat;
  headers?: Record<string, string>;
  providerOptions?: Record<string, unknown>;
  timeoutMs?: number;
}

export class VercelAIGatewayContainer extends OpenAIContainer {
  private readonly providerOptions: Record<string, unknown> | undefined;

  constructor(options: VercelAIGatewayContainerOptions) {
    super(createOpenAIContainerOptions(options));

    this.providerOptions = options.providerOptions;
  }

  protected override createRequestBody(messages: readonly LLMMessage[]): Record<string, unknown> {
    const requestBody = super.createRequestBody(messages);

    if (this.providerOptions === undefined) {
      return requestBody;
    }

    return {
      ...requestBody,
      providerOptions: this.providerOptions,
    };
  }
}

function createOpenAIContainerOptions(
  options: VercelAIGatewayContainerOptions,
): ConstructorParameters<typeof OpenAIContainer>[0] {
  const openAIOptions: ConstructorParameters<typeof OpenAIContainer>[0] = {
    baseUrl: "https://ai-gateway.vercel.sh/v1",
    format: options.format,
  };

  if (options.apiKey !== undefined) {
    openAIOptions.apiKey = options.apiKey;
  }

  if (options.fetch !== undefined) {
    openAIOptions.fetch = options.fetch;
  }

  if (options.headers !== undefined) {
    openAIOptions.headers = options.headers;
  }

  if (options.timeoutMs !== undefined) {
    openAIOptions.timeoutMs = options.timeoutMs;
  }

  return openAIOptions;
}
