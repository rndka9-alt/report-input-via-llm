import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import {
  ReportInputViaLLMError,
  runReportSuiteViaLLM,
  type ChatModel,
  type LLMMessage,
} from "../src/index.js";

describe("runReportSuiteViaLLM", () => {
  it("runs JSON suite cases through reportInputViaLLM and writes artifacts", async () => {
    const fixture = await createSuiteFixture({
      caseRulePromptPath: "./prompts.local/rules/quality.md",
    });
    const calls: LLMMessage[][] = [];
    const model: ChatModel = {
      async chat(messages) {
        calls.push([...messages]);

        return {
          outputContent: JSON.stringify({
            finalLabel: "pass",
            confidence: 0.9,
            summary: "Looks valid",
          }),
        };
      },
    };

    const result = await runReportSuiteViaLLM(model, fixture.suitePath, {
      outputDir: fixture.outputRoot,
      runId: "run_test",
    });

    expect(result.summary).toEqual({
      total: 1,
      success: 1,
      failed: 0,
      byCategory: {
        summary_quality: {
          total: 1,
          success: 1,
          failed: 0,
        },
      },
    });
    expect(result.cases[0]).toMatchObject({
      caseId: "case_001",
      category: "summary_quality",
      status: "success",
      result: {
        finalLabel: "pass",
        confidence: 0.9,
        summary: "Looks valid",
      },
      meta: {
        tags: ["mvp"],
      },
    });
    expect(calls[0]?.[0]?.message).toContain("System prompt");
    expect(calls[0]?.[1]?.message).toContain("Judge summary quality");

    const manifest = JSON.parse(
      await readFile(join(fixture.outputRoot, "run_test", "manifest.json"), "utf8"),
    );
    const summary = JSON.parse(
      await readFile(join(fixture.outputRoot, "run_test", "summary.json"), "utf8"),
    );
    const caseArtifact = JSON.parse(
      await readFile(join(fixture.outputRoot, "run_test", "cases", "case_001.json"), "utf8"),
    );
    const failures = await readFile(
      join(fixture.outputRoot, "run_test", "failures.jsonl"),
      "utf8",
    );

    expect(manifest).toMatchObject({
      runId: "run_test",
      suiteId: "example-validator-suite",
      suiteVersion: "0.1.0",
      totalCaseCount: 1,
    });
    expect(summary).toEqual(result.summary);
    expect(caseArtifact).toEqual(result.cases[0]);
    expect(failures).toBe("");
  });

  it("records individual testcase errors by default", async () => {
    const fixture = await createSuiteFixture({
      caseRulePromptPath: "./prompts.local/rules/missing.md",
    });
    const model: ChatModel = {
      async chat() {
        return {
          outputContent: "{}",
        };
      },
    };

    const result = await runReportSuiteViaLLM(model, fixture.suitePath, {
      runId: "run_test",
    });

    expect(result.summary).toEqual({
      total: 1,
      success: 0,
      failed: 1,
      byCategory: {
        summary_quality: {
          total: 1,
          success: 0,
          failed: 1,
        },
      },
    });
    expect(result.cases[0]).toMatchObject({
      caseId: "case_001",
      status: "failed",
      error: {
        phase: "load_prompt",
      },
    });
  });

  it("throws individual testcase errors when configured", async () => {
    const fixture = await createSuiteFixture({
      caseRulePromptPath: "./prompts.local/rules/missing.md",
    });
    const model: ChatModel = {
      async chat() {
        return {
          outputContent: "{}",
        };
      },
    };

    await expect(
      runReportSuiteViaLLM(model, fixture.suitePath, {
        onCaseError: "throw",
      }),
    ).rejects.toThrow(ReportInputViaLLMError);
  });

  it("throws configuration errors when the suite file cannot be loaded", async () => {
    const model: ChatModel = {
      async chat() {
        return {
          outputContent: "{}",
        };
      },
    };

    await expect(runReportSuiteViaLLM(model, "/missing/suite.json")).rejects.toThrow(
      ReportInputViaLLMError,
    );
  });
});

async function createSuiteFixture(input: {
  caseRulePromptPath: string;
}): Promise<{
  outputRoot: string;
  suitePath: string;
}> {
  const root = await mkdtemp(join(tmpdir(), "report-suite-"));
  await mkdir(join(root, "prompts.local", "rules"), { recursive: true });
  await mkdir(join(root, "schemas"), { recursive: true });
  await mkdir(join(root, "reports"), { recursive: true });
  await writeFile(join(root, "prompts.local", "system.md"), "System prompt", "utf8");
  await writeFile(
    join(root, "prompts.local", "rules", "quality.md"),
    "Judge summary quality",
    "utf8",
  );
  await writeFile(
    join(root, "schemas", "example-report-schema.ts"),
    [
      'import { z } from "zod";',
      "",
      "export const schema = z.object({",
      "  finalLabel: z.string(),",
      "  confidence: z.number(),",
      "  summary: z.string(),",
      "});",
      "",
    ].join("\n"),
    "utf8",
  );

  const suitePath = join(root, "suite.json");
  await writeFile(
    suitePath,
    JSON.stringify(
      {
        suiteId: "example-validator-suite",
        suiteVersion: "0.1.0",
        defaults: {
          systemPromptPath: "./prompts.local/system.md",
          schemaPath: "./schemas/example-report-schema.ts",
        },
        testcases: [
          {
            id: "case_001",
            category: "summary_quality",
            rulePromptPath: input.caseRulePromptPath,
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
      null,
      2,
    ),
    "utf8",
  );

  return {
    outputRoot: join(root, "reports"),
    suitePath,
  };
}
