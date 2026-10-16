import { z } from "zod";
import Ajv from "ajv";
export class StructuredAgentResponseError extends Error {
    constructor(message, options) {
        super(message);
        this.name = "StructuredAgentResponseError";
        this.lastResponse = options.lastResponse;
        this.validationErrors = options.validationErrors;
    }
}
export class StructuredAgentFallbackError extends Error {
    constructor(attempts) {
        const summary = attempts
            .map((attempt) => {
            const modelSuffix = attempt.model ? ` (${attempt.model})` : "";
            if (!attempt.available) {
                return `${attempt.provider}${modelSuffix}: unavailable${attempt.error ? ` (${attempt.error})` : ""}`;
            }
            return `${attempt.provider}${modelSuffix}: failed${attempt.error ? ` (${attempt.error})` : ""}`;
        })
            .join("; ");
        super(summary.length > 0
            ? `Structured generation failed for all providers: ${summary}`
            : "Structured generation failed for all providers");
        this.name = "StructuredAgentFallbackError";
        this.attempts = attempts;
    }
}
// Re-export from the legacy module path so existing server consumers keep working.
export { DEFAULT_STRUCTURED_GENERATION_PROVIDERS } from "./structured-generation-providers.js";
function isZodSchema(value) {
    return typeof value?.safeParse === "function";
}
function buildZodValidator(schema, schemaName) {
    const jsonSchema = z.toJSONSchema(schema, {
        target: "draft-07",
        unrepresentable: "any",
        io: "input",
    });
    if (typeof jsonSchema.title !== "string") {
        jsonSchema.title = schemaName;
    }
    return {
        jsonSchema,
        validate: (value) => {
            const result = schema.safeParse(value);
            if (result.success) {
                return { ok: true, value: result.data };
            }
            const errors = result.error.issues.map((issue) => {
                const path = issue.path.length > 0 ? issue.path.join(".") : "(root)";
                return `${path}: ${issue.message}`;
            });
            return { ok: false, errors };
        },
    };
}
function buildJsonSchemaValidator(schema) {
    const AjvConstructor = Ajv;
    const ajv = new AjvConstructor({ allErrors: true, strict: false });
    const validate = ajv.compile(schema);
    return {
        jsonSchema: schema,
        validate: (value) => {
            const ok = validate(value);
            if (ok) {
                return { ok: true, value: value };
            }
            const errors = (validate.errors ?? []).map((error) => {
                const path = error.instancePath && error.instancePath.length > 0 ? error.instancePath : "(root)";
                const message = error.message ?? "is invalid";
                return `${path}: ${message}`;
            });
            return { ok: false, errors };
        },
    };
}
function buildValidator(schema, schemaName) {
    if (isZodSchema(schema)) {
        return buildZodValidator(schema, schemaName);
    }
    return buildJsonSchemaValidator(schema);
}
function buildBasePrompt(prompt, jsonSchema) {
    const schemaText = JSON.stringify(jsonSchema, null, 2);
    return [
        prompt.trim(),
        "",
        "You must respond with JSON only that matches this JSON Schema:",
        schemaText,
    ].join("\n");
}
export function buildStructuredAgentResponsePrompt(options) {
    const validator = buildValidator(options.schema, options.schemaName ?? "Response");
    return buildBasePrompt(options.prompt, validator.jsonSchema);
}
function buildRetryPrompt(basePrompt, errors) {
    const formattedErrors = errors.map((error) => `- ${error}`).join("\n");
    return [
        basePrompt,
        "",
        "Previous response was invalid with validation errors:",
        formattedErrors.length > 0 ? formattedErrors : "- Unknown validation error",
        "",
        "Respond again with JSON only that matches the schema.",
    ].join("\n");
}
function extractJsonFromMarkdown(text) {
    const fencedMatch = text.match(/```(?:json)?\s*\n([\s\S]*?)\n```/);
    if (fencedMatch) {
        return fencedMatch[1].trim();
    }
    const extracted = extractFirstJsonSnippet(text);
    if (extracted) {
        return extracted;
    }
    return text.trim();
}
function tryParseJson(candidate) {
    try {
        JSON.parse(candidate);
        return candidate;
    }
    catch {
        return null;
    }
}
function extractBalancedJsonCandidate(source, start) {
    const open = source[start];
    const close = open === "{" ? "}" : "]";
    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let i = start; i < source.length; i += 1) {
        const ch = source[i];
        if (inString) {
            if (escaped) {
                escaped = false;
                continue;
            }
            if (ch === "\\") {
                escaped = true;
                continue;
            }
            if (ch === '"') {
                inString = false;
            }
            continue;
        }
        if (ch === '"') {
            inString = true;
            continue;
        }
        if (ch === open) {
            depth += 1;
            continue;
        }
        if (ch !== close) {
            continue;
        }
        depth -= 1;
        if (depth !== 0) {
            continue;
        }
        const candidate = source.slice(start, i + 1).trim();
        const parsed = tryParseJson(candidate);
        if (parsed !== null) {
            return parsed;
        }
    }
    return null;
}
function extractFirstJsonSnippet(text) {
    const source = text.trim();
    if (!source) {
        return null;
    }
    // Try to find the first valid JSON object/array within a larger response.
    // This is intentionally provider-agnostic and improves resilience when models
    // add extra prose before/after the JSON.
    const startIndexes = [];
    for (let i = 0; i < source.length; i += 1) {
        const ch = source[i];
        if (ch === "{" || ch === "[") {
            startIndexes.push(i);
        }
    }
    for (const start of startIndexes) {
        const candidate = extractBalancedJsonCandidate(source, start);
        if (candidate !== null) {
            return candidate;
        }
    }
    return null;
}
export async function getStructuredAgentResponse(options) {
    const { caller, prompt, schema, maxRetries = 2, schemaName = "Response" } = options;
    const validator = buildValidator(schema, schemaName);
    const basePrompt = buildBasePrompt(prompt, validator.jsonSchema);
    let attemptPrompt = basePrompt;
    let lastResponse = "";
    let lastErrors = [];
    for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
        const response = await caller(attemptPrompt);
        lastResponse = response;
        const jsonText = extractJsonFromMarkdown(response);
        let parsed;
        try {
            parsed = JSON.parse(jsonText);
        }
        catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            lastErrors = [`Invalid JSON: ${message}`];
            if (attempt === maxRetries) {
                break;
            }
            attemptPrompt = buildRetryPrompt(basePrompt, lastErrors);
            continue;
        }
        const validation = validator.validate(parsed);
        if (validation.ok) {
            return validation.value;
        }
        lastErrors = validation.errors;
        if (attempt === maxRetries) {
            break;
        }
        attemptPrompt = buildRetryPrompt(basePrompt, lastErrors);
    }
    throw new StructuredAgentResponseError("Agent response did not match the required JSON schema", {
        lastResponse,
        validationErrors: lastErrors,
    });
}
export async function generateStructuredAgentResponse(options) {
    const { manager, agentConfig, agentId, persistSession, prompt, schema, maxRetries, schemaName } = options;
    const agent = await manager.createAgent(agentConfig, agentId, {
        persistSession,
        workspaceId: undefined,
    });
    try {
        const caller = async (nextPrompt) => {
            const result = await manager.runAgent(agent.id, nextPrompt);
            if (typeof result.finalText === "string" && result.finalText.length > 0) {
                return result.finalText;
            }
            // Fallback for providers that may not populate finalText consistently.
            const lastAssistant = result.timeline.findLast((item) => item.type === "assistant_message");
            return lastAssistant?.text ?? "";
        };
        return await getStructuredAgentResponse({
            caller,
            prompt,
            schema,
            maxRetries,
            schemaName,
        });
    }
    finally {
        try {
            await manager.closeAgent(agent.id);
        }
        catch {
            // ignore cleanup errors
        }
        finally {
            await manager.deleteAgentState(agent.id).catch(() => undefined);
        }
    }
}
function errorMessage(error) {
    if (error instanceof Error) {
        return error.message;
    }
    return String(error);
}
export async function generateStructuredAgentResponseWithFallback(options) {
    const { manager, cwd, prompt, schema, providers, agentConfigOverrides, persistSession, maxRetries, schemaName, logger, runner, } = options;
    if (providers.length === 0) {
        throw new StructuredAgentFallbackError([]);
    }
    const runStructured = runner ??
        ((input) => generateStructuredAgentResponse(input));
    const attempts = [];
    for (const candidate of providers) {
        const availabilityEntry = await manager.getProviderAvailability(candidate.provider);
        if (!availabilityEntry.available) {
            const reason = availabilityEntry.error ?? "unavailable";
            attempts.push({
                provider: candidate.provider,
                model: candidate.model ?? null,
                available: false,
                error: availabilityEntry.error ?? null,
            });
            logger?.warn({ provider: candidate.provider, model: candidate.model, schemaName, reason }, "Structured generation: skipping unavailable provider");
            continue;
        }
        try {
            const result = await runStructured({
                manager,
                prompt,
                schema,
                maxRetries,
                schemaName,
                persistSession,
                agentConfig: {
                    ...agentConfigOverrides,
                    provider: candidate.provider,
                    cwd,
                    ...(candidate.model ? { model: candidate.model } : {}),
                    ...(candidate.thinkingOptionId ? { thinkingOptionId: candidate.thinkingOptionId } : {}),
                },
            });
            if (attempts.length > 0) {
                logger?.info({
                    provider: candidate.provider,
                    model: candidate.model,
                    schemaName,
                    priorAttempts: attempts,
                }, "Structured generation: succeeded after fallback");
            }
            return result;
        }
        catch (error) {
            attempts.push({
                provider: candidate.provider,
                model: candidate.model ?? null,
                available: true,
                error: errorMessage(error),
            });
            logger?.warn({ err: error, provider: candidate.provider, model: candidate.model, schemaName }, "Structured generation: provider failed, trying next");
        }
    }
    throw new StructuredAgentFallbackError(attempts);
}
//# sourceMappingURL=agent-response-loop.js.map