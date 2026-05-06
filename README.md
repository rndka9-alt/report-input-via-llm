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
import { OpenAIContainer } from "report-input-via-llm";

const model = new OpenAIContainer({
  apiKey: process.env.OPENAI_API_KEY,
  model: "your-model-name",
});
```

For local or proxy servers:

```ts
const model = new OpenAIContainer({
  baseUrl: "http://localhost:4000/v1",
  model: "local-model",
});
```

Internally, API containers contain an LLM format implementation.

```txt
src/apiContainer/
  formats/
    openai-compatible-format.ts
  openai-container.ts
```

Formats own provider payload parsing and body creation. Containers own API provider details.
