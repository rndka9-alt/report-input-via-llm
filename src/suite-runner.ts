import { mkdir, readFile, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { z } from "zod";
import {
  ReportInputViaLLMError,
  reportInputViaLLM,
  type ChatModel,
  type LLMOutput,
  type ReportRules,
} from "./core.js";

export type ReportCaseErrorPhase =
  | "load_suite"
  | "load_prompt"
  | "load_schema"
  | "build_rules"
  | "llm_report"
  | "write_artifact";

export interface ReportCaseError {
  name: string;
  message: string;
  phase: ReportCaseErrorPhase;
  details?: unknown;
}

export interface ReportCaseResult {
  caseId: string;
  category: string;
  status: "success" | "failed";
  result?: unknown;
  rawOutput?: LLMOutput;
  error?: ReportCaseError;
  meta?: Record<string, unknown>;
}

export interface ReportSuiteSummaryCategory {
  total: number;
  success: number;
  failed: number;
}

export interface ReportSuiteSummary {
  total: number;
  success: number;
  failed: number;
  byCategory: Record<string, ReportSuiteSummaryCategory>;
}

export interface ReportSuiteRunResult {
  runId: string;
  suiteId: string;
  suiteVersion?: string;
  outputDir?: string;
  summary: ReportSuiteSummary;
  cases: ReportCaseResult[];
}

export interface ReportSuiteValidator {
  systemPrompt: string;
  judgmentPrompt: string;
  schema: z.ZodType<Record<string, unknown>>;
}

export interface ReportSuiteTestcase {
  id: string;
  category: string;
  input: unknown;
  validator: ReportSuiteValidator;
  meta?: Record<string, unknown>;
}

export interface ReportSuite {
  suiteId: string;
  suiteVersion?: string;
  testcases: readonly ReportSuiteTestcase[];
}

export interface RunReportSuiteViaLLMOptions {
  onCaseError?: "throw" | "record-and-continue";
  outputDir?: string;
  runId?: string;
}

const suiteDefaultsSchema = z.object({
  systemPromptPath: z.string().min(1).optional(),
  rulePromptPath: z.string().min(1).optional(),
  schemaPath: z.string().min(1).optional(),
});

const testcaseSchema = z.object({
  id: z.string().min(1),
  category: z.string().min(1),
  input: z.unknown(),
  meta: z.record(z.unknown()).optional(),
  systemPromptPath: z.string().min(1).optional(),
  rulePromptPath: z.string().min(1).optional(),
  schemaPath: z.string().min(1).optional(),
});

const suiteSchema = z.object({
  suiteId: z.string().min(1),
  suiteVersion: z.string().min(1).optional(),
  defaults: suiteDefaultsSchema.optional(),
  testcases: z.array(testcaseSchema).min(1),
});

type ReportSuiteFile = z.infer<typeof suiteSchema>;
type ReportSuiteFileTestcase = z.infer<typeof testcaseSchema>;

interface ReportSuiteRunMetadata {
  suiteId: string;
  suiteVersion?: string;
}

export async function runReportSuiteViaLLM(
  model: ChatModel,
  suite: ReportSuite,
  options: RunReportSuiteViaLLMOptions = {},
): Promise<ReportSuiteRunResult> {
  const startedAt = new Date();
  const runId = options.runId ?? createRunId(startedAt);
  validateSuite(suite);
  const caseResults: ReportCaseResult[] = [];
  const onCaseError = options.onCaseError ?? "record-and-continue";

  for (const testcase of suite.testcases) {
    const caseResult = await runSingleCase(model, testcase);

    if (caseResult.status === "failed" && onCaseError === "throw") {
      throw new ReportInputViaLLMError(
        `Report suite case failed. caseId=${caseResult.caseId}, phase=${caseResult.error?.phase}`,
        caseResult.error,
      );
    }

    caseResults.push(caseResult);
  }

  const completedAt = new Date();
  const summary = createSummary(caseResults);
  const runResult = createRunResult({
    cases: caseResults,
    outputDir: createRunOutputDir(options.outputDir, runId),
    runId,
    suite,
    summary,
  });

  if (runResult.outputDir !== undefined) {
    await writeArtifacts({
      completedAt,
      result: runResult,
      startedAt,
      totalCaseCount: suite.testcases.length,
    });
  }

  return runResult;
}

export async function runReportSuiteFileViaLLM(
  model: ChatModel,
  suiteFilePath: string,
  options: RunReportSuiteViaLLMOptions = {},
): Promise<ReportSuiteRunResult> {
  const startedAt = new Date();
  const runId = options.runId ?? createRunId(startedAt);
  const suitePath = resolve(suiteFilePath);
  const suiteFile = await loadSuite(suitePath);
  const suiteDirectory = dirname(suitePath);
  const caseResults: ReportCaseResult[] = [];
  const onCaseError = options.onCaseError ?? "record-and-continue";

  for (const testcase of suiteFile.testcases) {
    const caseResult = await runSingleFileCase(model, suiteFile, testcase, suiteDirectory);

    if (caseResult.status === "failed" && onCaseError === "throw") {
      throw new ReportInputViaLLMError(
        `Report suite case failed. caseId=${caseResult.caseId}, phase=${caseResult.error?.phase}`,
        caseResult.error,
      );
    }

    caseResults.push(caseResult);
  }

  const completedAt = new Date();
  const summary = createSummary(caseResults);
  const runResult = createRunResult({
    cases: caseResults,
    outputDir: createRunOutputDir(options.outputDir, runId),
    runId,
    suite: createSuiteRunMetadata(suiteFile.suiteId, suiteFile.suiteVersion),
    summary,
  });

  if (runResult.outputDir !== undefined) {
    await writeArtifacts({
      completedAt,
      result: runResult,
      startedAt,
      totalCaseCount: suiteFile.testcases.length,
    });
  }

  return runResult;
}

function createRunResult(input: {
  cases: ReportCaseResult[];
  outputDir: string | undefined;
  runId: string;
  suite: ReportSuiteRunMetadata;
  summary: ReportSuiteSummary;
}): ReportSuiteRunResult {
  const baseResult = {
    runId: input.runId,
    suiteId: input.suite.suiteId,
    summary: input.summary,
    cases: input.cases,
  };

  if (input.suite.suiteVersion !== undefined && input.outputDir !== undefined) {
    return {
      ...baseResult,
      suiteVersion: input.suite.suiteVersion,
      outputDir: input.outputDir,
    };
  }

  if (input.suite.suiteVersion !== undefined) {
    return {
      ...baseResult,
      suiteVersion: input.suite.suiteVersion,
    };
  }

  if (input.outputDir !== undefined) {
    return {
      ...baseResult,
      outputDir: input.outputDir,
    };
  }

  return baseResult;
}

function createSuiteRunMetadata(
  suiteId: string,
  suiteVersion: string | undefined,
): ReportSuiteRunMetadata {
  if (suiteVersion !== undefined) {
    return {
      suiteId,
      suiteVersion,
    };
  }

  return {
    suiteId,
  };
}

async function loadSuite(suitePath: string): Promise<ReportSuiteFile> {
  const fileContent = await readFileForPhase(suitePath, "load_suite");
  let parsedJson: unknown;

  try {
    parsedJson = JSON.parse(fileContent);
  } catch (error) {
    throw new ReportInputViaLLMError(`Suite file is not valid JSON. path=${suitePath}`, error);
  }

  try {
    return suiteSchema.parse(parsedJson);
  } catch (error) {
    throw new ReportInputViaLLMError(`Suite file does not match expected shape. path=${suitePath}`, error);
  }
}

async function runSingleCase(
  model: ChatModel,
  testcase: ReportSuiteTestcase,
): Promise<ReportCaseResult> {
  try {
    const rules = createRules({
      judgmentPrompt: testcase.validator.judgmentPrompt,
      schema: testcase.validator.schema,
      systemPrompt: testcase.validator.systemPrompt,
    });
    const report = await reportInputViaLLM(model, rules, testcase.input);

    const successResult = createCaseResult({
      caseId: testcase.id,
      category: testcase.category,
      rawOutput: report.llmOutput,
      result: report.result,
      status: "success",
    });

    return addMeta(successResult, testcase.meta);
  } catch (error) {
    const failedResult = createCaseResult({
      caseId: testcase.id,
      category: testcase.category,
      error: normalizeCaseError(error),
      status: "failed",
    });

    return addMeta(failedResult, testcase.meta);
  }
}

async function loadSuiteFileTestcase(
  suite: ReportSuiteFile,
  testcase: ReportSuiteFileTestcase,
  suiteDirectory: string,
): Promise<ReportSuiteTestcase> {
  const systemPromptPath = resolveRequiredPath(
    testcase.systemPromptPath,
    suite.defaults?.systemPromptPath,
    suiteDirectory,
    `testcase ${testcase.id} systemPromptPath`,
  );
  const rulePromptPath = resolveRequiredPath(
    testcase.rulePromptPath,
    suite.defaults?.rulePromptPath,
    suiteDirectory,
    `testcase ${testcase.id} rulePromptPath`,
  );
  const schemaPath = resolveRequiredPath(
    testcase.schemaPath,
    suite.defaults?.schemaPath,
    suiteDirectory,
    `testcase ${testcase.id} schemaPath`,
  );
  const systemPrompt = await readFileForPhase(systemPromptPath, "load_prompt");
  const judgmentPrompt = await readFileForPhase(rulePromptPath, "load_prompt");
  const schema = await loadSchema(schemaPath);
  const loadedTestcase = {
    id: testcase.id,
    category: testcase.category,
    input: testcase.input,
    validator: {
      judgmentPrompt,
      schema,
      systemPrompt,
    },
  };

  if (testcase.meta !== undefined) {
    return {
      ...loadedTestcase,
      meta: testcase.meta,
    };
  }

  return loadedTestcase;
}

async function runSingleFileCase(
  model: ChatModel,
  suite: ReportSuiteFile,
  testcase: ReportSuiteFileTestcase,
  suiteDirectory: string,
): Promise<ReportCaseResult> {
  try {
    const loadedTestcase = await loadSuiteFileTestcase(suite, testcase, suiteDirectory);

    return await runSingleCase(model, loadedTestcase);
  } catch (error) {
    const failedResult = createCaseResult({
      caseId: testcase.id,
      category: testcase.category,
      error: normalizeCaseError(error),
      status: "failed",
    });

    return addMeta(failedResult, testcase.meta);
  }
}

function validateSuite(suite: ReportSuite): void {
  ensureNonEmptyString(suite.suiteId, "suite.suiteId");

  if (suite.suiteVersion !== undefined) {
    ensureNonEmptyString(suite.suiteVersion, "suite.suiteVersion");
  }

  if (suite.testcases.length === 0) {
    throw new ReportInputViaLLMError("suite.testcases must contain at least one testcase.");
  }

  for (const testcase of suite.testcases) {
    ensureNonEmptyString(testcase.id, "testcase.id");
    ensureNonEmptyString(testcase.category, `testcase ${testcase.id} category`);
    ensureNonEmptyString(
      testcase.validator.systemPrompt,
      `testcase ${testcase.id} validator.systemPrompt`,
    );
    ensureNonEmptyString(
      testcase.validator.judgmentPrompt,
      `testcase ${testcase.id} validator.judgmentPrompt`,
    );
  }
}

export function createRules(input: {
  judgmentPrompt: string;
  schema: z.ZodType<Record<string, unknown>>;
  systemPrompt: string;
}): ReportRules<Record<string, unknown>> {
  ensureNonEmptyString(input.systemPrompt, "systemPrompt");
  ensureNonEmptyString(input.judgmentPrompt, "judgmentPrompt");

  if (!(input.schema instanceof z.ZodObject)) {
    throw new ReportInputViaLLMError("Output schema must be a Zod object schema.");
  }

  const schemaKeys = Object.keys(input.schema.shape);

  if (schemaKeys.length === 0) {
    throw new ReportInputViaLLMError("Output schema must contain at least one field.");
  }

  return {
    systemPrompt: input.systemPrompt,
    inputInstruction: input.judgmentPrompt,
    resultSchema: input.schema,
    fields: Object.fromEntries(
      schemaKeys.map((schemaKey) => [
        schemaKey,
        "Return this field according to the judgment prompt.",
      ]),
    ),
  };
}

async function loadSchema(schemaPath: string): Promise<z.ZodType<Record<string, unknown>>> {
  let schemaModule: unknown;

  try {
    schemaModule = await import(pathToFileURL(schemaPath).href);
  } catch (error) {
    throw new ReportInputViaLLMError(`Schema module could not be imported. path=${schemaPath}`, error);
  }

  const schema = readSchemaExport(schemaModule);

  if (!(schema instanceof z.ZodObject)) {
    throw new ReportInputViaLLMError(
      `Schema module must export a Zod object as named schema or default. path=${schemaPath}`,
    );
  }

  return schema;
}

function readSchemaExport(schemaModule: unknown): unknown {
  if (!isRecord(schemaModule)) {
    throw new ReportInputViaLLMError("Schema module did not load as an object.");
  }

  if ("schema" in schemaModule) {
    return schemaModule.schema;
  }

  if ("default" in schemaModule) {
    return schemaModule.default;
  }

  throw new ReportInputViaLLMError("Schema module must export named schema or default.");
}

function resolveRequiredPath(
  testcasePath: string | undefined,
  defaultPath: string | undefined,
  suiteDirectory: string,
  label: string,
): string {
  const pathValue = testcasePath ?? defaultPath;

  if (pathValue === undefined || pathValue.trim().length === 0) {
    throw new ReportInputViaLLMError(`${label} is required.`);
  }

  if (isAbsolute(pathValue)) {
    return pathValue;
  }

  return resolve(suiteDirectory, pathValue);
}

async function readFileForPhase(path: string, phase: ReportCaseErrorPhase): Promise<string> {
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    throw new ReportInputViaLLMError(`Failed to read file. phase=${phase}, path=${path}`, error);
  }
}

function normalizeCaseError(error: unknown): ReportCaseError {
  const phase = inferPhase(error);
  const normalizedError = normalizeError(error);
  const baseError = {
    name: normalizedError.name,
    message: normalizedError.message,
    phase,
  };

  if (normalizedError.details === undefined) {
    return baseError;
  }

  return {
    ...baseError,
    details: normalizedError.details,
  };
}

function inferPhase(error: unknown): ReportCaseErrorPhase {
  if (!(error instanceof ReportInputViaLLMError)) {
    return "llm_report";
  }

  if (typeof error.message !== "string") {
    return "llm_report";
  }

  if (
    error.message.includes("systemPromptPath") ||
    error.message.includes("rulePromptPath") ||
    error.message.includes("schemaPath")
  ) {
    return "build_rules";
  }

  if (error.message.includes("phase=load_prompt")) {
    return "load_prompt";
  }

  if (
    error.message.includes("Schema module") ||
    error.message.includes("Output schema") ||
    error.message.includes("named schema or default")
  ) {
    return "load_schema";
  }

  if (error.message.includes("rules.") || error.message.includes("judgmentPrompt")) {
    return "build_rules";
  }

  return "llm_report";
}

function normalizeError(error: unknown): {
  details?: unknown;
  message: string;
  name: string;
} {
  if (error instanceof Error) {
    const baseError = {
      name: error.name,
      message: error.message,
    };

    if (error instanceof ReportInputViaLLMError && error.cause !== undefined) {
      return {
        ...baseError,
        details: error.cause,
      };
    }

    return baseError;
  }

  return {
    name: "UnknownError",
    message: "An unknown error occurred.",
    details: error,
  };
}

function createCaseResult(input: {
  caseId: string;
  category: string;
  error?: ReportCaseError;
  meta?: Record<string, unknown>;
  rawOutput?: LLMOutput;
  result?: unknown;
  status: "success" | "failed";
}): ReportCaseResult {
  const result = {
    caseId: input.caseId,
    category: input.category,
    status: input.status,
  };

  return addOptionalCaseFields(result, input);
}

function addOptionalCaseFields(
  result: {
    caseId: string;
    category: string;
    status: "success" | "failed";
  },
  input: {
    error?: ReportCaseError;
    meta?: Record<string, unknown>;
    rawOutput?: LLMOutput;
    result?: unknown;
    status: "success" | "failed";
  },
): ReportCaseResult {
  if (input.status === "success" && input.result !== undefined && input.rawOutput !== undefined) {
    if (input.meta !== undefined) {
      return {
        ...result,
        result: input.result,
        rawOutput: input.rawOutput,
        meta: input.meta,
      };
    }

    return {
      ...result,
      result: input.result,
      rawOutput: input.rawOutput,
    };
  }

  if (input.error !== undefined && input.meta !== undefined) {
    return {
      ...result,
      error: input.error,
      meta: input.meta,
    };
  }

  if (input.error !== undefined) {
    return {
      ...result,
      error: input.error,
    };
  }

  if (input.meta !== undefined) {
    return {
      ...result,
      meta: input.meta,
    };
  }

  return result;
}

function addMeta(
  result: ReportCaseResult,
  meta: Record<string, unknown> | undefined,
): ReportCaseResult {
  if (meta === undefined) {
    return result;
  }

  return {
    ...result,
    meta,
  };
}

function createSummary(cases: readonly ReportCaseResult[]): ReportSuiteSummary {
  const summary: ReportSuiteSummary = {
    total: cases.length,
    success: 0,
    failed: 0,
    byCategory: {},
  };

  for (const caseResult of cases) {
    const categorySummary =
      summary.byCategory[caseResult.category] ??
      createEmptyCategorySummary();

    categorySummary.total += 1;

    if (caseResult.status === "success") {
      summary.success += 1;
      categorySummary.success += 1;
    } else {
      summary.failed += 1;
      categorySummary.failed += 1;
    }

    summary.byCategory[caseResult.category] = categorySummary;
  }

  return summary;
}

function createEmptyCategorySummary(): ReportSuiteSummaryCategory {
  return {
    total: 0,
    success: 0,
    failed: 0,
  };
}

async function writeArtifacts(input: {
  completedAt: Date;
  result: ReportSuiteRunResult;
  startedAt: Date;
  totalCaseCount: number;
}): Promise<void> {
  const outputDir = input.result.outputDir;

  if (outputDir === undefined) {
    throw new ReportInputViaLLMError("outputDir is required to write artifacts.");
  }

  try {
    const casesDirectory = join(outputDir, "cases");
    await mkdir(casesDirectory, { recursive: true });
    await writeJson(join(outputDir, "manifest.json"), {
      runId: input.result.runId,
      suiteId: input.result.suiteId,
      suiteVersion: input.result.suiteVersion,
      startedAt: input.startedAt.toISOString(),
      completedAt: input.completedAt.toISOString(),
      totalCaseCount: input.totalCaseCount,
    });
    await writeJson(join(outputDir, "summary.json"), input.result.summary);

    for (const caseResult of input.result.cases) {
      await writeJson(join(casesDirectory, `${sanitizeArtifactName(caseResult.caseId)}.json`), caseResult);
    }

    await writeFile(
      join(outputDir, "failures.jsonl"),
      input.result.cases
        .filter((caseResult) => caseResult.status === "failed")
        .map((caseResult) => JSON.stringify(caseResult))
        .join("\n"),
      "utf8",
    );
  } catch (error) {
    throw new ReportInputViaLLMError(
      `Failed to write suite artifacts. outputDir=${outputDir}`,
      error,
    );
  }
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function createRunOutputDir(outputDir: string | undefined, runId: string): string | undefined {
  if (outputDir === undefined) {
    return undefined;
  }

  return resolve(outputDir, runId);
}

function createRunId(startedAt: Date): string {
  return `${startedAt.toISOString().replace(/[:.]/g, "-")}-${Math.random()
    .toString(36)
    .slice(2, 10)}`;
}

function sanitizeArtifactName(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]/g, "_");
}

function ensureNonEmptyString(value: string, path: string): void {
  if (value.trim().length === 0) {
    throw new ReportInputViaLLMError(`${path} must be a non-empty string.`);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
