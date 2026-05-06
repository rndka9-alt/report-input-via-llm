import { describe, expect, it } from "vitest";
import {
  OpenAIContainer,
  ReportInputViaLLMError,
  type FetchLike,
  type LLMFormat,
} from "../../src/index.js";

describe("OpenAIContainer", () => {
  it("injects OpenAI API headers and delegates request body creation to the format", async () => {
    const calls: unknown[] = [];
    const fetchImplementation: FetchLike = async (input, init) => {
      calls.push({ input, init });

      return {
        ok: true,
        status: 200,
        statusText: "OK",
        async json() {
          return {
            choices: [
              {
                message: {
                  content: "{\"verdict\":\"pass\"}",
                  reasoning_content: "checked",
                },
              },
            ],
          };
        },
        async text() {
          return "";
        },
      };
    };
    const model = new OpenAIContainer({
      apiKey: "test-key",
      baseUrl: "https://llm.example.test/v1",
      fetch: fetchImplementation,
      model: "test-model",
      temperature: 0,
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
    expect(calls).toHaveLength(1);
    expect(calls[0]).toEqual({
      input: "https://llm.example.test/v1/chat/completions",
      init: {
        body: JSON.stringify({
          model: "test-model",
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
          response_format: {
            type: "json_object",
          },
          temperature: 0,
        }),
        headers: {
          "content-type": "application/json",
          authorization: "Bearer test-key",
        },
        method: "POST",
      },
    });
  });

  it("throws with status details when the provider rejects the request", async () => {
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
    const model = new OpenAIContainer({
      fetch: fetchImplementation,
      model: "test-model",
    });

    await expect(model.chat([])).rejects.toThrow(
      "OpenAI API request failed. status=401 Unauthorized, body=bad key",
    );
  });

  it("throws when the format cannot parse provider output", async () => {
    const fetchImplementation: FetchLike = async () => ({
      ok: true,
      status: 200,
      statusText: "OK",
      async json() {
        return {
          choices: [
            {
              message: {},
            },
          ],
        };
      },
      async text() {
        return "";
      },
    });
    const model = new OpenAIContainer({
      fetch: fetchImplementation,
      model: "test-model",
    });

    await expect(model.chat([])).rejects.toThrow(ReportInputViaLLMError);
  });

  it("accepts a custom LLM format inside the API container", async () => {
    const format: LLMFormat = {
      createRequestBody(messages, options) {
        return {
          providerModel: options.model,
          providerMessages: messages.map((message) => message.message),
        };
      },
      parseResponse(responseJson) {
        return {
          outputContent: JSON.stringify(responseJson),
        };
      },
    };
    const calls: unknown[] = [];
    const fetchImplementation: FetchLike = async (input, init) => {
      calls.push({ input, init });

      return {
        ok: true,
        status: 200,
        statusText: "OK",
        async json() {
          return {
            custom: true,
          };
        },
        async text() {
          return "";
        },
      };
    };
    const model = new OpenAIContainer({
      fetch: fetchImplementation,
      format,
      model: "test-model",
    });

    const output = await model.chat([
      {
        role: "user",
        message: "hello",
      },
    ]);

    expect(output.outputContent).toBe("{\"custom\":true}");
    expect(calls).toEqual([
      {
        input: "https://api.openai.com/v1/chat/completions",
        init: {
          body: JSON.stringify({
            providerModel: "test-model",
            providerMessages: ["hello"],
          }),
          headers: {
            "content-type": "application/json",
          },
          method: "POST",
        },
      },
    ]);
  });
});
