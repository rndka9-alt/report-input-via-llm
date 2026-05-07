import { z } from "zod";
import {
  runReportSuiteViaLLM,
  type ChatModel,
  type LLMMessage,
} from "../src/index.js";

const summaryQualitySchema = z.object({
  finalLabel: z.enum(["pass", "fail"]),
  confidence: z.number().min(0).max(1),
  summary: z.string().min(1),
});

const systemPrompt = [
  "You are a strict report evaluator.",
  "Return a structured judgment for each input.",
].join("\n");

const judgmentPrompt = [
  "Judge whether the generated summary preserves the important source facts.",
  "Use finalLabel=pass when the summary is faithful enough for downstream use.",
].join("\n");

const model: ChatModel = {
  async chat(messages: readonly LLMMessage[]) {
    const userMessage = messages.find((message) => message.role === "user");
    const failed = userMessage?.message.includes("Wrong launch date") === true;

    return {
      outputContent: JSON.stringify({
        finalLabel: failed ? "fail" : "pass",
        confidence: failed ? 0.31 : 0.92,
        summary: failed
          ? "The summary changes a key source fact."
          : "The summary preserves the relevant source facts.",
      }),
    };
  },
};

const result = await runReportSuiteViaLLM(
  model,
  {
    suiteId: "summary-quality-example",
    suiteVersion: "0.1.0",
    testcases: [
      {
        id: "faithful_summary",
        category: "summary_quality",
        validator: {
          systemPrompt,
          judgmentPrompt,
          schema: summaryQualitySchema,
        },
        input: {
          source: "The product launched in March and supports offline export.",
          output: "The product launched in March and includes offline export.",
        },
        meta: {
          tags: ["example", "pass"],
        },
      },
      {
        id: "changed_fact",
        category: "summary_quality",
        validator: {
          systemPrompt,
          judgmentPrompt,
          schema: summaryQualitySchema,
        },
        input: {
          source: "The product launched in March and supports offline export.",
          output: "Wrong launch date: the product launched in April.",
        },
        meta: {
          tags: ["example", "fail"],
        },
      },
    ],
  },
  {
    runId: "example_run",
  },
);

console.log(JSON.stringify(result.summary, null, 2));
console.log(JSON.stringify(result.cases, null, 2));
