import { z } from "zod";

export type LLMMessageRole = "system" | "user" | "assistant";

export interface LLMMessage {
  role: LLMMessageRole;
  message: string;
}

export interface LLMOutput {
  outputContent: string;
  reasoningContent?: string;
  raw?: unknown;
}

export interface ChatModel {
  chat(messages: readonly LLMMessage[]): Promise<LLMOutput>;
}

export type ReportRuleFields<Result> = {
  [Key in Extract<keyof Result, string>]: string;
};

export interface ReportRules<Result extends Record<string, unknown>> {
  systemPrompt: string;
  inputInstruction: string;
  resultSchema: z.ZodType<Result>;
  fields: ReportRuleFields<Result>;
}

export interface ReportInputViaLLMResult<Result extends Record<string, unknown>> {
  result: Result;
  llmOutput: LLMOutput;
  messages: readonly LLMMessage[];
}

export class ReportInputViaLLMError extends Error {
  readonly cause: unknown;

  constructor(message: string, cause?: unknown) {
    super(message);
    this.name = "ReportInputViaLLMError";
    this.cause = cause;
  }
}

export function defineReportRules<Result extends Record<string, unknown>>(
  rules: ReportRules<Result>,
): ReportRules<Result> {
  ensureNonEmptyString(rules.systemPrompt, "rules.systemPrompt");
  ensureNonEmptyString(rules.inputInstruction, "rules.inputInstruction");
  ensureAtLeastOneField(rules.fields);
  ensureSchemaMatchesFieldKeys(rules.resultSchema, rules.fields);

  for (const [key, instruction] of Object.entries(rules.fields)) {
    ensureNonEmptyString(instruction, `rules.fields.${key}`);
  }

  return rules;
}

export async function reportInputViaLLM<Result extends Record<string, unknown>>(
  model: ChatModel,
  rules: ReportRules<Result>,
  input: unknown,
): Promise<ReportInputViaLLMResult<Result>> {
  const checkedRules = defineReportRules(rules);
  const messages = createReportMessages(checkedRules, input);
  const llmOutput = await model.chat(messages);
  const parsedOutput = parseOutputContent(llmOutput.outputContent);
  const result = checkedRules.resultSchema.parse(parsedOutput);

  return {
    result,
    llmOutput,
    messages,
  };
}

function createReportMessages<Result extends Record<string, unknown>>(
  rules: ReportRules<Result>,
  input: unknown,
): readonly LLMMessage[] {
  return [
    {
      role: "system",
      message: [
        rules.systemPrompt,
        "",
        "You must return only a JSON object. Do not wrap it in markdown.",
        "The JSON object must satisfy this result schema:",
        zodSchemaToPrompt(rules.resultSchema),
      ].join("\n"),
    },
    {
      role: "user",
      message: [
        rules.inputInstruction,
        "",
        "Evaluation rules:",
        formatFieldInstructions(rules.fields),
        "",
        "Input:",
        stringifyInput(input),
      ].join("\n"),
    },
  ];
}

function formatFieldInstructions<Result>(fields: ReportRuleFields<Result>): string {
  return Object.entries(fields)
    .map(([key, instruction]) => `- ${key}: ${instruction}`)
    .join("\n");
}

function parseOutputContent(outputContent: string): unknown {
  ensureNonEmptyString(outputContent, "llmOutput.outputContent");

  try {
    return JSON.parse(outputContent);
  } catch (error) {
    throw new ReportInputViaLLMError("LLM outputContent is not valid JSON.", error);
  }
}

function stringifyInput(input: unknown): string {
  if (typeof input === "string") {
    ensureNonEmptyString(input, "input");
    return input;
  }

  try {
    return JSON.stringify(input, null, 2);
  } catch (error) {
    throw new ReportInputViaLLMError("Input could not be serialized to JSON.", error);
  }
}

function zodSchemaToPrompt(schema: z.ZodTypeAny): string {
  return JSON.stringify(zodTypeToPromptValue(schema), null, 2);
}

function zodTypeToPromptValue(schema: z.ZodTypeAny): unknown {
  if (schema instanceof z.ZodObject) {
    const shape = schema.shape;

    return Object.fromEntries(
      Object.entries(shape).map(([key, childSchema]) => {
        if (!isZodSchema(childSchema)) {
          throw new ReportInputViaLLMError(`Invalid Zod schema at resultSchema.${key}.`);
        }

        return [key, zodTypeToPromptValue(childSchema)];
      }),
    );
  }

  if (schema instanceof z.ZodString) {
    return "string";
  }

  if (schema instanceof z.ZodNumber) {
    return "number";
  }

  if (schema instanceof z.ZodBoolean) {
    return "boolean";
  }

  if (schema instanceof z.ZodArray) {
    return [zodTypeToPromptValue(schema.element)];
  }

  if (schema instanceof z.ZodEnum) {
    return schema.options;
  }

  if (schema instanceof z.ZodLiteral) {
    return schema.value;
  }

  if (schema instanceof z.ZodOptional) {
    return {
      optional: zodTypeToPromptValue(schema.unwrap()),
    };
  }

  if (schema instanceof z.ZodNullable) {
    return {
      nullable: zodTypeToPromptValue(schema.unwrap()),
    };
  }

  return schema.description ?? schema._def.typeName;
}

function ensureNonEmptyString(value: string, path: string): void {
  if (value.trim().length === 0) {
    throw new ReportInputViaLLMError(`${path} must be a non-empty string.`);
  }
}

function ensureAtLeastOneField<Result>(fields: ReportRuleFields<Result>): void {
  if (Object.keys(fields).length === 0) {
    throw new ReportInputViaLLMError("rules.fields must contain at least one result field.");
  }
}

function isZodSchema(value: unknown): value is z.ZodTypeAny {
  return value instanceof z.ZodType;
}

function ensureSchemaMatchesFieldKeys<Result extends Record<string, unknown>>(
  resultSchema: z.ZodType<Result>,
  fields: ReportRuleFields<Result>,
): void {
  if (!(resultSchema instanceof z.ZodObject)) {
    throw new ReportInputViaLLMError("rules.resultSchema must be a Zod object schema.");
  }

  const schemaKeys = Object.keys(resultSchema.shape).sort();
  const fieldKeys = Object.keys(fields).sort();

  if (schemaKeys.length !== fieldKeys.length) {
    throw new ReportInputViaLLMError(
      `rules.fields keys must match rules.resultSchema keys. schema=[${schemaKeys.join(
        ", ",
      )}], fields=[${fieldKeys.join(", ")}]`,
    );
  }

  for (const [index, schemaKey] of schemaKeys.entries()) {
    if (schemaKey !== fieldKeys[index]) {
      throw new ReportInputViaLLMError(
        `rules.fields keys must match rules.resultSchema keys. schema=[${schemaKeys.join(
          ", ",
        )}], fields=[${fieldKeys.join(", ")}]`,
      );
    }
  }
}
