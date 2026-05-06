import { ReportInputViaLLMError, type ChatModel, type LLMMessage, type LLMOutput } from "../core.js";
import type { FetchLike } from "./fetch-like.js";
import type { LLMFormat } from "./llm-format.js";
import { OpenAICompatibleFormat } from "./formats/openai-compatible-format.js";

export interface OpenAIContainerOptions {
  apiKey?: string;
  baseUrl?: string;
  fetch?: FetchLike;
  format?: LLMFormat;
  headers?: Record<string, string>;
  maxTokens?: number;
  model: string;
  temperature?: number;
  timeoutMs?: number;
}

export class OpenAIContainer implements ChatModel {
  private readonly apiKey: string | undefined;
  private readonly baseUrl: string;
  private readonly fetchImplementation: FetchLike;
  private readonly format: LLMFormat;
  private readonly headers: Record<string, string>;
  private readonly maxTokens: number | undefined;
  private readonly model: string;
  private readonly temperature: number | undefined;
  private readonly timeoutMs: number | undefined;

  constructor(options: OpenAIContainerOptions) {
    ensureNonEmptyString(options.model, "options.model");

    if (options.apiKey !== undefined) {
      ensureNonEmptyString(options.apiKey, "options.apiKey");
    }

    if (options.baseUrl !== undefined) {
      ensureNonEmptyString(options.baseUrl, "options.baseUrl");
    }

    this.apiKey = options.apiKey;
    this.baseUrl = options.baseUrl ?? "https://api.openai.com/v1";
    this.fetchImplementation = options.fetch ?? fetch;
    this.format = options.format ?? new OpenAICompatibleFormat();
    this.headers = options.headers ?? {};
    this.maxTokens = options.maxTokens;
    this.model = options.model;
    this.temperature = options.temperature;
    this.timeoutMs = options.timeoutMs;
  }

  async chat(messages: readonly LLMMessage[]): Promise<LLMOutput> {
    const abortController = this.createAbortController();
    const requestInit = this.createRequestInit(messages, abortController);

    try {
      const response = await this.fetchImplementation(
        `${this.baseUrl}/chat/completions`,
        requestInit,
      );

      if (!response.ok) {
        throw new ReportInputViaLLMError(
          `OpenAI API request failed. status=${response.status} ${response.statusText}, body=${await response.text()}`,
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
        this.format.createRequestBody(messages, this.createFormatRequestOptions()),
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

  private createFormatRequestOptions(): {
    maxTokens?: number;
    model: string;
    temperature?: number;
  } {
    const options = {
      model: this.model,
    };

    if (this.maxTokens !== undefined && this.temperature !== undefined) {
      return {
        ...options,
        maxTokens: this.maxTokens,
        temperature: this.temperature,
      };
    }

    if (this.maxTokens !== undefined) {
      return {
        ...options,
        maxTokens: this.maxTokens,
      };
    }

    if (this.temperature !== undefined) {
      return {
        ...options,
        temperature: this.temperature,
      };
    }

    return options;
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
