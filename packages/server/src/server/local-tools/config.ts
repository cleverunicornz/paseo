import path from "node:path";
import { z } from "zod";

const AbsolutePathSchema = z
  .string()
  .min(1)
  .refine((value) => path.isAbsolute(value), { message: "must be an absolute path" });

/**
 * `daemon.mcp.localTools`: the Codex executable the daemon runs as its local
 * tool executor. Absent, the local tools are off and no executor starts.
 */
export const LocalToolsConfigSchema = z
  .object({
    codexPath: AbsolutePathSchema,
    /** The executor's own Codex home; defaults to `$PASEO_HOME/local-tools/codex-home`. */
    codexHome: AbsolutePathSchema.optional(),
  })
  .strict();

/** `daemon.mcp.toolTree`: a per-agent directory of typed files, one per tool the agent sees. */
export const ToolTreeConfigSchema = z
  .object({
    enabled: z.boolean().optional(),
    /** Parent directory of the per-agent trees; defaults to `$PASEO_HOME/tool-trees`. */
    dir: AbsolutePathSchema.optional(),
  })
  .strict();

export type LocalToolsConfig = z.infer<typeof LocalToolsConfigSchema>;

export interface ToolTreeConfig {
  enabled: boolean;
  dir?: string;
}

export const LOCAL_TOOLS_CODEX_PATH_ENV = "PASEO_LOCAL_TOOLS_CODEX_PATH";

export function resolveLocalToolsConfig(
  env: NodeJS.ProcessEnv,
  persisted: z.input<typeof LocalToolsConfigSchema> | undefined,
): LocalToolsConfig | null {
  const codexPath = env[LOCAL_TOOLS_CODEX_PATH_ENV] ?? persisted?.codexPath;
  if (codexPath === undefined) {
    return null;
  }
  const parsed = LocalToolsConfigSchema.safeParse({ ...persisted, codexPath });
  if (!parsed.success) {
    const source =
      env[LOCAL_TOOLS_CODEX_PATH_ENV] !== undefined
        ? LOCAL_TOOLS_CODEX_PATH_ENV
        : "daemon.mcp.localTools";
    throw new Error(
      `Invalid ${source}: ${parsed.error.issues.map((issue) => `${issue.path.join(".")} ${issue.message}`).join("; ")}`,
    );
  }
  return parsed.data;
}

export function resolveToolTreeConfig(
  persisted: z.input<typeof ToolTreeConfigSchema> | undefined,
): ToolTreeConfig {
  return {
    enabled: persisted?.enabled === true,
    ...(persisted?.dir ? { dir: persisted.dir } : {}),
  };
}
