import { ReportInputViaLLMError, type ChatModel, type LLMMessage, type LLMOutput } from "../core.js";
import type { FetchLike } from "./fetch-like.js";
import type { AnthropicMessagesAPIFormat } from "./formats/anthropic-messages-api-format.js";

export type AnthropicContainerFormat = AnthropicMessagesAPIFormat;

export interface AnthropicContainerOptions {
  apiKey?: string;
  anthropicVersion?: string;
  baseUrl?: string;
  fetch?: FetchLike;
  format: AnthropicContainerFormat;
  headers?: Record<string, string>;
  timeoutMs?: number;
}

export class AnthropicContainer implements ChatModel {
  private readonly anthropicVersion: string;
  private readonly apiKey: string | undefined;
  private readonly baseUrl: string;
  private readonly fetchImplementation: FetchLike;
  private readonly format: AnthropicContainerFormat;
  private readonly headers: Record<string, string>;
  private readonly timeoutMs: number | undefined;

  constructor(options: AnthropicContainerOptions) {
    if (options.apiKey !== undefined) {
      ensureNonEmptyString(options.apiKey, "options.apiKey");
    }

    if (options.anthropicVersion !== undefined) {
      ensureNonEmptyString(options.anthropicVersion, "options.anthropicVersion");
    }

    if (options.baseUrl !== undefined) {
      ensureNonEmptyString(options.baseUrl, "options.baseUrl");
    }

    this.anthropicVersion = options.anthropicVersion ?? "2023-06-01";
    this.apiKey = options.apiKey;
    this.baseUrl = options.baseUrl ?? "https://api.anthropic.com";
    this.fetchImplementation = options.fetch ?? fetch;
    this.format = options.format;
    this.headers = options.headers ?? {};
    this.timeoutMs = options.timeoutMs;
  }

  async chat(messages: readonly LLMMessage[]): Promise<LLMOutput> {
    const abortController = this.createAbortController();
    const requestInit = this.createRequestInit(messages, abortController);

    try {
      const response = await this.fetchImplementation(
        `${this.baseUrl}${this.format.requestPath}`,
        requestInit,
      );

      if (!response.ok) {
        throw new ReportInputViaLLMError(
          `Anthropic API request failed. status=${response.status} ${response.statusText}, body=${await response.text()}`,
        );
      }

      return this.format.parseResponse(await response.json());
    } finally {
      if (abortController !== undefined) {
        clearTimeout(abortController.timeoutId);
      }
    }
  }

  private createRequestInit(
    messages: readonly LLMMessage[],
    abortController: TimedAbortController | undefined,
  ): {
    body: string;
    headers: Record<string, string>;
    method: string;
    signal?: AbortSignal;
  } {
    const requestInit = {
      body: JSON.stringify(this.format.createRequestBody(messages)),
      headers: this.createHeaders(),
      method: "POST",
    };

    if (abortController === undefined) {
      return requestInit;
    }

    return {
      ...requestInit,
      signal: abortController.controller.signal,
    };
  }

  private createHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      "anthropic-version": this.anthropicVersion,
      "content-type": "application/json",
      ...this.headers,
    };

    if (this.apiKey !== undefined) {
      headers["x-api-key"] = this.apiKey;
    }

    return headers;
  }

  private createAbortController(): TimedAbortController | undefined {
    if (this.timeoutMs === undefined) {
      return undefined;
    }

    const abortController = new AbortController();
    const timeoutId = setTimeout(() => {
      abortController.abort();
    }, this.timeoutMs);

    return {
      controller: abortController,
      timeoutId,
    };
  }
}

interface TimedAbortController {
  controller: AbortController;
  timeoutId: ReturnType<typeof setTimeout>;
}

function ensureNonEmptyString(value: string, path: string): void {
  if (value.trim().length === 0) {
    throw new ReportInputViaLLMError(`${path} must be a non-empty string.`);
  }
}
