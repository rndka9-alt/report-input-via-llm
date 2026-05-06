import { describe, expect, it } from "vitest";
import {
  OllamaCloudContainer,
  OllamaChatFormat,
  ollamaCloudDeepSeekModels,
  ReportInputViaLLMError,
  type FetchLike,
} from "../../src/index.js";

describe("OllamaCloudContainer", () => {
  it("calls Ollama Cloud /api/chat with DeepSeek V4 cloud models", async () => {
    const calls: unknown[] = [];
    const fetchImplementation: FetchLike = async (input, init) => {
      calls.push({ input, init });

      return {
        ok: true,
        status: 200,
        statusText: "OK",
        async json() {
          return {
            message: {
              content: "{\"verdict\":\"pass\"}",
              thinking: "checked",
            },
          };
        },
        async text() {
          return "";
        },
      };
    };
    const model = new OllamaCloudContainer({
      apiKey: "ollama-key",
      fetch: fetchImplementation,
      format: new OllamaChatFormat({
        maxTokens: 128,
        model: ollamaCloudDeepSeekModels.deepseekV4Flash,
        temperature: 0,
      }),
    });

    const output = await model.chat([
      {
        role: "system",
        message: "System prompt",
      },
      {
        role: "user",
        message: "User input",
      },
    ]);

    expect(output.outputContent).toBe("{\"verdict\":\"pass\"}");
    expect(output.reasoningContent).toBe("checked");
    expect(calls).toEqual([
      {
        input: "https://ollama.com/api/chat",
        init: {
          body: JSON.stringify({
            model: "deepseek-v4-flash:cloud",
            messages: [
              {
                role: "system",
                content: "System prompt",
              },
              {
                role: "user",
                content: "User input",
              },
            ],
            stream: false,
            options: {
              num_predict: 128,
              temperature: 0,
            },
          }),
          headers: {
            "content-type": "application/json",
            authorization: "Bearer ollama-key",
          },
          method: "POST",
        },
      },
    ]);
  });

  it("exposes the DeepSeek V4 Pro cloud model id", () => {
    expect(ollamaCloudDeepSeekModels.deepseekV4Pro).toBe("deepseek-v4-pro:cloud");
  });

  it("throws with status details when Ollama Cloud rejects the request", async () => {
    const fetchImplementation: FetchLike = async () => ({
      ok: false,
      status: 401,
      statusText: "Unauthorized",
      async json() {
        return {};
      },
      async text() {
        return "bad key";
      },
    });
    const model = new OllamaCloudContainer({
      fetch: fetchImplementation,
      format: new OllamaChatFormat({
        model: ollamaCloudDeepSeekModels.deepseekV4Pro,
      }),
    });

    await expect(model.chat([])).rejects.toThrow(
      "Ollama Cloud API request failed. status=401 Unauthorized, body=bad key",
    );
  });

  it("throws when Ollama Cloud output has no content", async () => {
    const fetchImplementation: FetchLike = async () => ({
      ok: true,
      status: 200,
      statusText: "OK",
      async json() {
        return {};
      },
      async text() {
        return "";
      },
    });
    const model = new OllamaCloudContainer({
      fetch: fetchImplementation,
      format: new OllamaChatFormat({
        model: ollamaCloudDeepSeekModels.deepseekV4Flash,
      }),
    });

    await expect(model.chat([])).rejects.toThrow(ReportInputViaLLMError);
  });
});
