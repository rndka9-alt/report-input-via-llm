import { describe, expect, it } from "vitest";
import {
  OpenAICompatibleFormat,
  OpenAIResponsesAPIFormat,
  VercelAIGatewayContainer,
  type FetchLike,
} from "../../src/index.js";

describe("VercelAIGatewayContainer", () => {
  it("uses the Vercel AI Gateway OpenAI-compatible base URL", async () => {
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
    const model = new VercelAIGatewayContainer({
      apiKey: "gateway-key",
      fetch: fetchImplementation,
      format: new OpenAICompatibleFormat({
        model: "openai/gpt-5.2",
      }),
    });

    const output = await model.chat([
      {
        role: "user",
        message: "User input",
      },
    ]);

    expect(output.outputContent).toBe("{\"verdict\":\"pass\"}");
    expect(calls[0]).toMatchObject({
      input: "https://ai-gateway.vercel.sh/v1/chat/completions",
      init: {
        headers: {
          "content-type": "application/json",
          authorization: "Bearer gateway-key",
        },
        method: "POST",
      },
    });
  });

  it("can use the OpenAI Responses API format through the gateway", async () => {
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
    const model = new VercelAIGatewayContainer({
      fetch: fetchImplementation,
      format: new OpenAIResponsesAPIFormat({
        model: "openai/gpt-5.2",
      }),
    });

    await model.chat([
      {
        role: "user",
        message: "User input",
      },
    ]);

    expect(calls[0]).toMatchObject({
      input: "https://ai-gateway.vercel.sh/v1/responses",
    });
  });

  it("injects Vercel providerOptions at the container layer", async () => {
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
    const model = new VercelAIGatewayContainer({
      fetch: fetchImplementation,
      format: new OpenAICompatibleFormat({
        model: "anthropic/claude-sonnet-4.5",
      }),
      providerOptions: {
        anthropic: {
          thinking: {
            type: "enabled",
            budgetTokens: 12000,
          },
        },
      },
    });

    await model.chat([
      {
        role: "user",
        message: "User input",
      },
    ]);

    expect(calls[0]).toMatchObject({
      input: "https://ai-gateway.vercel.sh/v1/chat/completions",
      init: {
        body: JSON.stringify({
          model: "anthropic/claude-sonnet-4.5",
          messages: [
            {
              role: "user",
              content: "User input",
            },
          ],
          response_format: {
            type: "json_object",
          },
          providerOptions: {
            anthropic: {
              thinking: {
                type: "enabled",
                budgetTokens: 12000,
              },
            },
          },
        }),
      },
    });
  });
});
