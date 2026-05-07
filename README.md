# report-input-via-llm

Single-turn LLM evaluator for pipeline usage.

It receives:

- a generalized chat model
- fixed system and evaluation rules
- an input payload

It returns:

- the parsed and Zod-validated result
- the raw LLM output
- the messages sent to the model

```ts
import { z } from "zod";
import { defineReportRules, reportInputViaLLM, type ChatModel } from "report-input-via-llm";

const model: ChatModel = {
  async chat(messages) {
    return {
      outputContent: JSON.stringify({
        verdict: "pass",
        reason: "The input satisfies the rule.",
      }),
    };
  },
};

const rules = defineReportRules({
  systemPrompt: "You are a strict evaluator.",
  inputInstruction: "Evaluate the input.",
  resultSchema: z.object({
    verdict: z.enum(["pass", "fail"]),
    reason: z.string().min(1),
  }),
  fields: {
    verdict: "Return pass or fail.",
    reason: "Explain the decision briefly.",
  },
});

const report = await reportInputViaLLM(model, rules, {
  title: "Weekly report",
  body: "Done",
});

console.log(report.result.verdict);
```

The model interface is intentionally small:

```ts
interface ChatModel {
  chat(messages: readonly LLMMessage[]): Promise<LLMOutput>;
}

interface LLMMessage {
  role: "system" | "user" | "assistant";
  message: string;
}

interface LLMOutput {
  outputContent: string;
  reasoningContent?: string;
  raw?: unknown;
}
```

API containers are the public model implementations. They own provider concerns such as
base URLs, headers, authentication, and request execution.

```ts
import { OpenAICompatibleFormat, OpenAIContainer } from "report-input-via-llm";

const model = new OpenAIContainer({
  apiKey: process.env.OPENAI_API_KEY,
  format: new OpenAICompatibleFormat({
    model: "your-model-name",
  }),
});
```

For local or proxy servers:

```ts
const model = new OpenAIContainer({
  baseUrl: "http://localhost:4000/v1",
  format: new OpenAICompatibleFormat({
    model: "local-model",
  }),
});
```

For the OpenAI Responses API:

```ts
import { OpenAIContainer, OpenAIResponsesAPIFormat } from "report-input-via-llm";

const model = new OpenAIContainer({
  apiKey: process.env.OPENAI_API_KEY,
  format: new OpenAIResponsesAPIFormat({
    model: "your-model-name",
  }),
});
```

For Ollama Cloud:

```ts
import { OllamaChatFormat, OllamaCloudContainer, ollamaCloudDeepSeekModels } from "report-input-via-llm";

const model = new OllamaCloudContainer({
  apiKey: process.env.OLLAMA_API_KEY,
  format: new OllamaChatFormat({
    model: ollamaCloudDeepSeekModels.deepseekV4Flash,
  }),
});
```

For Anthropic:

```ts
import { AnthropicContainer, AnthropicMessagesAPIFormat } from "report-input-via-llm";

const model = new AnthropicContainer({
  apiKey: process.env.ANTHROPIC_API_KEY,
  format: new AnthropicMessagesAPIFormat({
    maxTokens: 1024,
    model: "claude-opus-4-1-20250805",
  }),
});
```

For Vercel AI Gateway:

```ts
import { OpenAICompatibleFormat, VercelAIGatewayContainer } from "report-input-via-llm";

const model = new VercelAIGatewayContainer({
  apiKey: process.env.AI_GATEWAY_API_KEY,
  format: new OpenAICompatibleFormat({
    model: "openai/your-model-name",
  }),
  providerOptions: {
    openai: {
      reasoningEffort: "low",
    },
  },
});
```

API containers require an explicit LLM format instance.
Model invocation options such as `model`, `temperature`, and `maxTokens` belong to
the format. Provider transport options such as `apiKey`, `headers`, `baseUrl`, and
gateway-specific `providerOptions` belong to the container.

```txt
src/apiContainer/
  formats/
    openai-compatible-format.ts
    openai-responses-api-format.ts
    ollama-chat-format.ts
    anthropic-messages-api-format.ts
  openai-container.ts
  ollama-cloud-container.ts
  anthropic-container.ts
  vercel-ai-gateway-container.ts
```

Formats own provider payload parsing and body creation. Containers own API provider details.

## Suite Runner

`runReportSuiteViaLLM` runs already-loaded testcase content through `reportInputViaLLM`.
Callers own prompt and schema loading, so prompts can come from files, databases,
bundles, or any other project-specific source.

```ts
import { z } from "zod";
import { OpenAICompatibleFormat, OpenAIContainer, runReportSuiteViaLLM } from "report-input-via-llm";

const model = new OpenAIContainer({
  apiKey: process.env.OPENAI_API_KEY,
  format: new OpenAICompatibleFormat({
    model: "your-model-name",
  }),
});

const result = await runReportSuiteViaLLM(
  model,
  {
    suiteId: "summary-suite",
    testcases: [
      {
        id: "case_001",
        category: "summary_quality",
        validator: {
          systemPrompt: "You are a strict evaluator.",
          judgmentPrompt: "Judge summary quality.",
          schema: z.object({
            finalLabel: z.string(),
            confidence: z.number(),
            summary: z.string(),
          }),
        },
        input: {
          source: "Original text here",
          output: "Model generated summary here",
        },
        meta: {
          tags: ["mvp"],
        },
      },
    ],
  },
  {
    outputDir: "./external/reports",
    onCaseError: "record-and-continue",
  },
);

console.log(result.summary);
```

`testcases` is an array, so one suite can run multiple inputs and validators in
one sequential run.

See `examples/loaded-suite.ts` for a complete no-network example that uses a
mock `ChatModel`.

`runReportSuiteFileViaLLM` is the file-backed convenience wrapper. It loads a JSON
suite file, prompt files, and a schema module, then delegates to `runReportSuiteViaLLM`.

Suite files are JSON and reference prompt/rule/schema paths:

```json
{
  "suiteId": "example-validator-suite",
  "suiteVersion": "0.1.0",
  "defaults": {
    "systemPromptPath": "../prompts/local/system.md",
    "schemaPath": "../schemas/example-report-schema.ts"
  },
  "testcases": [
    {
      "id": "case_001",
      "category": "summary_quality",
      "rulePromptPath": "../prompts/local/rules/summary-quality.md",
      "input": {
        "source": "Original text here",
        "output": "Model generated summary here"
      },
      "meta": {
        "tags": ["mvp"]
      }
    }
  ]
}
```

Schema files are TypeScript modules exporting `schema` or a default Zod schema:

```ts
import { z } from "zod";

export const schema = z.object({
  finalLabel: z.string(),
  confidence: z.number(),
  summary: z.string(),
});
```

When `outputDir` is provided, artifacts are written under `{outputDir}/{runId}`:

```txt
manifest.json
summary.json
cases/{caseId}.json
failures.jsonl
```

External prompt, schema, suite, and report files live under `external/`:

```txt
external/
  prompts/
    example/
    local/
  schemas/
  suites/
  reports/
```

Real prompt files can live under `external/prompts/local/`, which is gitignored.
The committed `external/prompts/example/` files are templates only.
