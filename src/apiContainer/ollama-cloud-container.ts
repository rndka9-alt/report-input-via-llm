import { ReportInputViaLLMError, type ChatModel, type LLMMessage, type LLMOutput } from "../core.js";
import type { FetchLike } from "./fetch-like.js";
import type { LLMFormat } from "./llm-format.js";
import type { OllamaChatFormat } from "./formats/ollama-chat-format.js";

export type OllamaCloudContainerFormat = OllamaChatFormat;

export interface OllamaCloudContainerOptions {
  apiKey?: string;
  baseUrl?: string;
  fetch?: FetchLike;
  format: OllamaCloudContainerFormat;
  headers?: Record<string, string>;
  timeoutMs?: number;
}

export class OllamaCloudContainer implements ChatModel {
  private readonly apiKey: string | undefined;
  private readonly baseUrl: string;
  private readonly fetchImplementation: FetchLike;
  private readonly format: LLMFormat;
  private readonly headers: Record<string, string>;
  private readonly timeoutMs: number | undefined;

  constructor(options: OllamaCloudContainerOptions) {
    if (options.apiKey !== undefined) {
      ensureNonEmptyString(options.apiKey, "options.apiKey");
    }

    if (options.baseUrl !== undefined) {
      ensureNonEmptyString(options.baseUrl, "options.baseUrl");
    }

    this.apiKey = options.apiKey;
    this.baseUrl = options.baseUrl ?? "https://ollama.com/api";
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
        `${this.baseUrl}${this.format.requestPath ?? "/chat"}`,
        requestInit,
      );

      if (!response.ok) {
        throw new ReportInputViaLLMError(
          `Ollama Cloud API request failed. status=${response.status} ${response.statusText}, body=${await response.text()}`,
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
      body: JSON.stringify(
        this.format.createRequestBody(messages),
      ),
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
      "content-type": "application/json",
      ...this.headers,
    };

    if (this.apiKey !== undefined) {
      headers.authorization = `Bearer ${this.apiKey}`;
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
