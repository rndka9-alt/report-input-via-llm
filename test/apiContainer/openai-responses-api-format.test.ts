import { describe, expect, it } from "vitest";
import { OpenAIContainer, OpenAIResponsesAPIFormat, type FetchLike } from "../../src/index.js";

describe("OpenAIResponsesAPIFormat", () => {
  it("uses the OpenAI Responses API endpoint and request body", async () => {
    const calls: unknown[] = [];
    const fetchImplementation: FetchLike = async (input, init) => {
      calls.push({ input, init });

      return {
        ok: true,
        status: 200,
        statusText: "OK",
        async json() {
          return {
            output_text: "{\"verdict\":\"pass\"}",
          };
        },
        async text() {
          return "";
        },
      };
    };
    const model = new OpenAIContainer({
      apiKey: "test-key",
      fetch: fetchImplementation,
      format: new OpenAIResponsesAPIFormat({
        model: "test-model",
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
    expect(calls).toEqual([
      {
        input: "https://api.openai.com/v1/responses",
        init: {
          body: JSON.stringify({
            model: "test-model",
            input: "user: User input",
            text: {
              format: {
                type: "json_object",
              },
            },
            instructions: "System prompt",
            temperature: 0,
          }),
          headers: {
            "content-type": "application/json",
            authorization: "Bearer test-key",
          },
          method: "POST",
        },
      },
    ]);
  });

  it("can parse output array content when output_text is absent", async () => {
    const calls: unknown[] = [];
    const fetchImplementation: FetchLike = async (input, init) => {
      calls.push({ input, init });

      return {
        ok: true,
        status: 200,
        statusText: "OK",
        async json() {
          return {
            output: [
              {
                content: [
                  {
                    type: "output_text",
                    text: "{\"verdict\":\"pass\"}",
                  },
                ],
                summary: [
                  {
                    text: "reasoned",
                  },
                ],
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
      fetch: fetchImplementation,
      format: new OpenAIResponsesAPIFormat({
        model: "test-model",
      }),
    });

    const output = await model.chat([
      {
        role: "user",
        message: "User input",
      },
    ]);

    expect(output.outputContent).toBe("{\"verdict\":\"pass\"}");
    expect(output.reasoningContent).toBe("reasoned");
  });
});
