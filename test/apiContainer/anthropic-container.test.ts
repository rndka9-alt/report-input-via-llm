import { describe, expect, it } from "vitest";
import {
  AnthropicContainer,
  AnthropicMessagesAPIFormat,
  ReportInputViaLLMError,
  type FetchLike,
} from "../../src/index.js";

describe("AnthropicContainer", () => {
  it("calls Anthropic Messages API with system prompt split from messages", async () => {
    const calls: unknown[] = [];
    const fetchImplementation: FetchLike = async (input, init) => {
      calls.push({ input, init });

      return {
        ok: true,
        status: 200,
        statusText: "OK",
        async json() {
          return {
            content: [
              {
                type: "thinking",
                thinking: "checked",
              },
              {
                type: "text",
                text: "{\"verdict\":\"pass\"}",
              },
            ],
          };
        },
        async text() {
          return "";
        },
      };
    };
    const model = new AnthropicContainer({
      apiKey: "anthropic-key",
      fetch: fetchImplementation,
      format: new AnthropicMessagesAPIFormat({
        maxTokens: 256,
        model: "claude-test",
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
        input: "https://api.anthropic.com/v1/messages",
        init: {
          body: JSON.stringify({
            max_tokens: 256,
            messages: [
              {
                role: "user",
                content: "User input",
              },
            ],
            model: "claude-test",
            system: "System prompt",
            temperature: 0,
          }),
          headers: {
            "anthropic-version": "2023-06-01",
            "content-type": "application/json",
            "x-api-key": "anthropic-key",
          },
          method: "POST",
        },
      },
    ]);
  });

  it("throws with status details when Anthropic rejects the request", async () => {
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
    const model = new AnthropicContainer({
      fetch: fetchImplementation,
      format: new AnthropicMessagesAPIFormat({
        maxTokens: 256,
        model: "claude-test",
      }),
    });

    await expect(model.chat([{ role: "user", message: "hello" }])).rejects.toThrow(
      "Anthropic API request failed. status=401 Unauthorized, body=bad key",
    );
  });

  it("throws when Anthropic output has no text content", async () => {
    const fetchImplementation: FetchLike = async () => ({
      ok: true,
      status: 200,
      statusText: "OK",
      async json() {
        return {
          content: [
            {
              type: "tool_use",
            },
          ],
        };
      },
      async text() {
        return "";
      },
    });
    const model = new AnthropicContainer({
      fetch: fetchImplementation,
      format: new AnthropicMessagesAPIFormat({
        maxTokens: 256,
        model: "claude-test",
      }),
    });

    await expect(model.chat([{ role: "user", message: "hello" }])).rejects.toThrow(
      ReportInputViaLLMError,
    );
  });
});
