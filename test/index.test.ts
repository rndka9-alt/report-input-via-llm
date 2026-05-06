import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  defineReportRules,
  reportInputViaLLM,
  ReportInputViaLLMError,
  type ChatModel,
} from "../src/index.js";

describe("reportInputViaLLM", () => {
  it("passes generalized messages to the model and returns validated result", async () => {
    const calls: unknown[] = [];
    const model: ChatModel = {
      async chat(messages) {
        calls.push(messages);

        return {
          outputContent: JSON.stringify({
            verdict: "pass",
            reason: "The report satisfies the rule.",
          }),
        };
      },
    };
    const rules = defineReportRules({
      systemPrompt: "You are a strict report evaluator.",
      inputInstruction: "Evaluate the given report.",
      resultSchema: z.object({
        verdict: z.enum(["pass", "fail"]),
        reason: z.string().min(1),
      }),
      fields: {
        verdict: "Return pass or fail.",
        reason: "Explain the decision briefly.",
      },
    });

    const output = await reportInputViaLLM(model, rules, {
      title: "weekly report",
      body: "done",
    });

    expect(output.result).toEqual({
      verdict: "pass",
      reason: "The report satisfies the rule.",
    });
    expect(output.messages).toHaveLength(2);
    expect(calls).toEqual([output.messages]);
    expect(output.messages[0]).toMatchObject({
      role: "system",
    });
    expect(output.messages[1]?.message).toContain("- verdict: Return pass or fail.");
  });

  it("throws when the model returns malformed JSON", async () => {
    const model: ChatModel = {
      async chat() {
        return {
          outputContent: "not-json",
        };
      },
    };
    const rules = defineReportRules({
      systemPrompt: "Evaluate.",
      inputInstruction: "Check input.",
      resultSchema: z.object({
        score: z.number(),
      }),
      fields: {
        score: "Return a score.",
      },
    });

    await expect(reportInputViaLLM(model, rules, "input")).rejects.toThrow(
      ReportInputViaLLMError,
    );
  });

  it("throws when the model result does not satisfy the mapped schema", async () => {
    const model: ChatModel = {
      async chat() {
        return {
          outputContent: JSON.stringify({
            score: "high",
          }),
        };
      },
    };
    const rules = defineReportRules({
      systemPrompt: "Evaluate.",
      inputInstruction: "Check input.",
      resultSchema: z.object({
        score: z.number(),
      }),
      fields: {
        score: "Return a numeric score.",
      },
    });

    await expect(reportInputViaLLM(model, rules, "input")).rejects.toThrow(
      "Expected number",
    );
  });
});
