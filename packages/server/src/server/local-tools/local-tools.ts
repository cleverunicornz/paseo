import { randomBytes } from "node:crypto";
import { lstat, realpath, stat } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";

import { ensureValidJson } from "../json-utils.js";
import { expandUserPath } from "../path-utils.js";
import { ACCESS_OUTSIDE_WORKSPACE_MESSAGE, resolveScopedPath } from "../file-explorer/service.js";
import type {
  PaseoToolConfig,
  PaseoToolExecutionContext,
  PaseoToolResult,
} from "../agent/tools/types.js";
import type { CodexExecutor } from "./codex-executor.js";
import { parsePatch, renderPatch } from "./patch-format.js";
import type { LocalProcessRegistry } from "./local-processes.js";

const DEFAULT_EXEC_TIMEOUT_MS = 120_000;
const MAX_EXEC_TIMEOUT_MS = 30 * 60_000;
const DEFAULT_MAX_OUTPUT_BYTES = 64 * 1024;
const MAX_OUTPUT_BYTES = 1024 * 1024;
const RPC_MARGIN_MS = 30_000;
const MAX_READ_FILE_BYTES = 10 * 1024 * 1024;
const DEFAULT_READ_RETURN_BYTES = 256 * 1024;
const MAX_LIST_ENTRIES = 2000;
const BINARY_SAMPLE_BYTES = 8192;
/** The patch travels as one argument; Linux caps a single argument at 128 KiB. */
const MAX_PATCH_BYTES = 120 * 1024;
const DEFAULT_PROCESS_READ_CHARS = 64 * 1024;
const MAX_PROCESS_WAIT_MS = 30_000;

type RegisterTool = (
  name: string,
  config: PaseoToolConfig,
  handler: (
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Tool inputs are validated by the catalog before execution.
    input: any,
    context: PaseoToolExecutionContext,
  ) => Promise<PaseoToolResult>,
) => void;

export interface LocalToolsHost {
  executor: CodexExecutor;
  /** The Codex executable; its apply-patch entry applies patches with no model. */
  codexPath: string;
  processes: LocalProcessRegistry;
  /**
   * Variables an agent's own code gets for one run (exec, process_spawn): its
   * Paseo token and endpoints, so a script reaches Paseo as that agent.
   */
  resolveRunEnv: (agentId: string) => Record<string, string>;
  /** The agent's tool tree, when trees are on. */
  resolveToolTreeDir?: (agentId: string) => string | null;
}

interface LocalToolCaller {
  id: string;
  cwd: string;
}

export interface RegisterLocalToolsOptions {
  registerTool: RegisterTool;
  host: LocalToolsHost;
  callerAgentId?: string;
  resolveCallerAgent: () => LocalToolCaller | null;
}

interface CommandExecResponse {
  exitCode: number;
}

interface CommandExecOutputDelta {
  processId?: unknown;
  stream?: unknown;
  deltaBase64?: unknown;
}

interface CommandResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  stdoutTruncated: boolean;
  stderrTruncated: boolean;
}

interface RunCommandOptions {
  cwd: string;
  timeoutMs?: number;
  maxOutputBytes?: number;
  env?: Record<string, string>;
  signal?: AbortSignal;
}

const CommandResultShape = {
  exitCode: z.number().describe("The command's exit code; 124 when it ran out of time."),
  stdout: z.string(),
  stderr: z.string(),
  stdoutTruncated: z.boolean(),
  stderrTruncated: z.boolean(),
};

const GitResultShape = {
  exitCode: z.number(),
  output: z.string(),
  truncated: z.boolean(),
};

const RelativePathSchema = z
  .string()
  .min(1)
  .describe("Path relative to your workspace root (absolute paths must stay inside it).");

const ArgvSchema = z
  .array(z.string())
  .min(1)
  .describe(
    'Command and arguments, e.g. ["npm", "test"]. For shell syntax use ["bash", "-lc", "..."].',
  );

const GitRefSchema = z
  .string()
  .min(1)
  .refine((value) => !value.startsWith("-"), { message: "must not start with '-'" });

function toolResult(value: unknown): PaseoToolResult {
  return { content: [], structuredContent: ensureValidJson(value) };
}

/**
 * Text of at most `maxBytes` UTF-8 bytes. The bound applies to the decoded
 * text: an invalid byte decodes to U+FFFD, three bytes wide. The cut falls on
 * a character start.
 */
function truncateBytes(bytes: Buffer, maxBytes: number): { text: string; truncated: boolean } {
  const decoded = Buffer.from(bytes.toString("utf8"), "utf8");
  if (decoded.length <= maxBytes) {
    return { text: decoded.toString("utf8"), truncated: false };
  }
  let end = maxBytes;
  while (end > 0 && ((decoded[end] ?? 0) & 0xc0) === 0x80) end -= 1;
  return { text: decoded.subarray(0, end).toString("utf8"), truncated: true };
}

function displayPath(root: string, target: string): string {
  const relative = path.relative(root, target);
  return relative === "" ? "." : relative.split(path.sep).join("/");
}

function isLikelyBinary(bytes: Buffer): boolean {
  return bytes.subarray(0, BINARY_SAMPLE_BYTES).includes(0);
}

function entryKind(entry: { isDirectory: boolean; isFile: boolean }): string {
  if (entry.isDirectory) return "directory";
  return entry.isFile ? "file" : "other";
}

export function registerLocalTools(options: RegisterLocalToolsOptions): void {
  const { registerTool, host } = options;
  const { executor } = host;

  function requireCaller(): LocalToolCaller {
    const caller = options.callerAgentId ? options.resolveCallerAgent() : null;
    if (!caller) {
      throw new Error(
        "Local tools act in an agent's workspace: call them with your agent token on /mcp/agents",
      );
    }
    return caller;
  }

  function workspaceRoot(caller: LocalToolCaller): string {
    return expandUserPath(caller.cwd);
  }

  async function scoped(caller: LocalToolCaller, relativePath = "."): Promise<string> {
    return (await resolveScopedPath({ root: caller.cwd, relativePath })).resolvedPath;
  }

  /** A path a tool will create or overwrite: like `scoped`, and never a dangling symlink. */
  async function scopedForWrite(caller: LocalToolCaller, relativePath: string): Promise<string> {
    const resolved = await scoped(caller, relativePath);
    const entry = await lstat(resolved).catch(() => null);
    if (entry?.isSymbolicLink()) {
      // A symlink that resolved is inside the workspace; one that did not is dangling.
      await realpath(resolved).catch((error: unknown) => {
        throw new Error(ACCESS_OUTSIDE_WORKSPACE_MESSAGE, { cause: error });
      });
    }
    return resolved;
  }

  /**
   * A patch path as the executor resolves it (lexically against the workspace
   * root, no trimming or `~`), judged like `scopedForWrite`. Returns the judged
   * path relative to the root, with no `..` left for the executor to resolve.
   */
  async function scopedPatchPath(caller: LocalToolCaller, patchPath: string): Promise<string> {
    const root = workspaceRoot(caller);
    const absolute = path.resolve(root, patchPath);
    if (absolute !== absolute.trim()) {
      throw new Error(ACCESS_OUTSIDE_WORKSPACE_MESSAGE);
    }
    await scopedForWrite(caller, absolute);
    return path.relative(root, absolute);
  }

  /** The patch rewritten with every path judged; one path outside the workspace refuses it whole. */
  async function scopedPatch(caller: LocalToolCaller, patch: string): Promise<string> {
    const hunks = parsePatch(patch);
    for (const hunk of hunks) {
      hunk.path = await scopedPatchPath(caller, hunk.path);
      if (hunk.kind === "update" && hunk.movePath !== null) {
        hunk.movePath = await scopedPatchPath(caller, hunk.movePath);
      }
    }
    return renderPatch(hunks);
  }

  async function runCommand(
    caller: LocalToolCaller,
    command: string[],
    run: RunCommandOptions,
  ): Promise<CommandResult> {
    const timeoutMs = run.timeoutMs ?? DEFAULT_EXEC_TIMEOUT_MS;
    const maxOutputBytes = run.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES;
    const processId = `${caller.id}:exec-${randomBytes(6).toString("hex")}`;
    const onAbort = () => {
      void executor.request("command/exec/terminate", { processId }).catch(() => undefined);
    };
    // Output is streamed as bytes and decoded here: the executor's own text
    // decoding misreads a stream its cap cut inside a UTF-8 character.
    const output = { stdout: [] as Buffer[], stderr: [] as Buffer[] };
    const stopListening = executor.onNotification((method, params) => {
      const delta = params as CommandExecOutputDelta;
      if (method !== "command/exec/outputDelta" || delta.processId !== processId) return;
      if (typeof delta.deltaBase64 !== "string") return;
      output[delta.stream === "stderr" ? "stderr" : "stdout"].push(
        Buffer.from(delta.deltaBase64, "base64"),
      );
    });
    run.signal?.addEventListener("abort", onAbort, { once: true });
    try {
      const response = await executor.request<CommandExecResponse>(
        "command/exec",
        {
          command,
          processId,
          cwd: run.cwd,
          timeoutMs,
          streamStdoutStderr: true,
          // One byte over the bound tells a cut-off stream from one that fit.
          outputBytesCap: maxOutputBytes + 1,
          env: run.env ?? {},
          // Codex's own sandbox (bubblewrap) needs user namespaces, which
          // agent containers do not grant; the OS user is the boundary.
          sandboxPolicy: { type: "dangerFullAccess" },
        },
        timeoutMs + RPC_MARGIN_MS,
      );
      // The response follows the run's last output notification.
      const stdout = truncateBytes(Buffer.concat(output.stdout), maxOutputBytes);
      const stderr = truncateBytes(Buffer.concat(output.stderr), maxOutputBytes);
      return {
        exitCode: response.exitCode,
        stdout: stdout.text,
        stderr: stderr.text,
        stdoutTruncated: stdout.truncated,
        stderrTruncated: stderr.truncated,
      };
    } finally {
      stopListening();
      run.signal?.removeEventListener("abort", onAbort);
    }
  }

  async function runGit(
    caller: LocalToolCaller,
    args: string[],
    run: { maxOutputBytes?: number; signal?: AbortSignal } = {},
  ): Promise<{ exitCode: number; output: string; truncated: boolean }> {
    const result = await runCommand(caller, ["git", ...args], {
      cwd: await scoped(caller),
      maxOutputBytes: run.maxOutputBytes,
      signal: run.signal,
    });
    if (result.exitCode !== 0) {
      throw new Error(
        `git ${args[0]} exited with ${result.exitCode}: ${(result.stderr || result.stdout).trim()}`,
      );
    }
    return {
      exitCode: result.exitCode,
      output: result.stdout + result.stderr,
      truncated: result.stdoutTruncated || result.stderrTruncated,
    };
  }

  async function scopedPathArgs(caller: LocalToolCaller, paths: string[] | undefined) {
    const root = await realpath(workspaceRoot(caller));
    const resolved: string[] = [];
    for (const entry of paths ?? []) {
      resolved.push(displayPath(root, await scoped(caller, entry)));
    }
    return resolved;
  }

  const toolTreeHint = (() => {
    const dir = options.callerAgentId ? host.resolveToolTreeDir?.(options.callerAgentId) : null;
    return dir
      ? ` Every tool you have is also a typed function under ${dir} (servers/<server>/<tool>.ts); a script you run here can import and call them.`
      : "";
  })();

  registerTool(
    "exec",
    {
      title: "Run a command",
      description:
        "Run a command in your workspace and return its exit code and output. The run's environment " +
        "carries PASEO_AGENT_TOKEN, PASEO_MCP_URL and PASEO_MCP_GATEWAY_URL, so code you run here " +
        `can call Paseo's tools as you.${toolTreeHint}`,
      inputSchema: {
        command: ArgvSchema,
        cwd: RelativePathSchema.optional().describe(
          "Working directory; defaults to the workspace root.",
        ),
        timeoutMs: z.number().int().positive().max(MAX_EXEC_TIMEOUT_MS).optional(),
        maxOutputBytes: z
          .number()
          .int()
          .positive()
          .max(MAX_OUTPUT_BYTES)
          .optional()
          .describe(`Per-stream output kept; default ${DEFAULT_MAX_OUTPUT_BYTES}.`),
        env: z.record(z.string(), z.string()).optional(),
      },
      outputSchema: CommandResultShape,
    },
    async (input, context) => {
      const caller = requireCaller();
      const result = await runCommand(caller, input.command, {
        cwd: await scoped(caller, input.cwd),
        timeoutMs: input.timeoutMs,
        maxOutputBytes: input.maxOutputBytes,
        env: { ...input.env, ...host.resolveRunEnv(caller.id) },
        signal: context.signal,
      });
      return toolResult(result);
    },
  );

  registerTool(
    "read_file",
    {
      title: "Read a file",
      description:
        "Read a text file in your workspace, optionally a range of lines. Binary files come back base64-encoded.",
      inputSchema: {
        path: RelativePathSchema,
        startLine: z.number().int().positive().optional().describe("First line, from 1."),
        maxLines: z.number().int().positive().optional(),
        maxBytes: z.number().int().positive().max(MAX_OUTPUT_BYTES).optional(),
      },
      outputSchema: {
        path: z.string(),
        content: z.string(),
        encoding: z.enum(["utf-8", "base64"]),
        size: z.number(),
        truncated: z.boolean().describe("True when content is not the whole file."),
      },
    },
    async (input) => {
      const caller = requireCaller();
      const resolved = await scoped(caller, input.path);
      const { size } = await stat(resolved);
      if (size > MAX_READ_FILE_BYTES) {
        throw new Error(
          `File is ${size} bytes; read_file reads up to ${MAX_READ_FILE_BYTES}. Use exec with head, tail or sed.`,
        );
      }
      const { dataBase64 } = await executor.request<{ dataBase64: string }>("fs/readFile", {
        path: resolved,
      });
      const bytes = Buffer.from(dataBase64, "base64");
      const maxBytes = input.maxBytes ?? DEFAULT_READ_RETURN_BYTES;
      const shown = displayPath(
        workspaceRoot(caller),
        path.resolve(workspaceRoot(caller), input.path),
      );
      if (isLikelyBinary(bytes)) {
        const slice = bytes.subarray(0, maxBytes);
        return toolResult({
          path: shown,
          content: slice.toString("base64"),
          encoding: "base64",
          size,
          truncated: slice.length < bytes.length,
        });
      }
      const text = bytes.toString("utf8");
      let selected = text;
      if (input.startLine !== undefined || input.maxLines !== undefined) {
        const lines = text.split(/(?<=\n)/);
        const start = (input.startLine ?? 1) - 1;
        selected = lines
          .slice(start, input.maxLines === undefined ? undefined : start + input.maxLines)
          .join("");
      }
      const bounded = truncateBytes(Buffer.from(selected, "utf8"), maxBytes);
      return toolResult({
        path: shown,
        content: bounded.text,
        encoding: "utf-8",
        size,
        truncated: bounded.text.length < text.length,
      });
    },
  );

  registerTool(
    "write_file",
    {
      title: "Write a file",
      description: "Create or replace a text file in your workspace, creating missing directories.",
      inputSchema: {
        path: RelativePathSchema,
        content: z.string(),
      },
      outputSchema: { path: z.string(), bytes: z.number() },
    },
    async (input) => {
      const caller = requireCaller();
      const resolved = await scopedForWrite(caller, input.path);
      await executor.request("fs/createDirectory", {
        path: path.dirname(resolved),
        recursive: true,
      });
      const data = Buffer.from(input.content, "utf8");
      await executor.request("fs/writeFile", {
        path: resolved,
        dataBase64: data.toString("base64"),
      });
      return toolResult({
        path: displayPath(workspaceRoot(caller), path.resolve(workspaceRoot(caller), input.path)),
        bytes: data.length,
      });
    },
  );

  registerTool(
    "list_dir",
    {
      title: "List a directory",
      description: "List the entries of a directory in your workspace.",
      inputSchema: { path: RelativePathSchema.optional() },
      outputSchema: {
        path: z.string(),
        entries: z.array(
          z.object({ name: z.string(), kind: z.enum(["file", "directory", "other"]) }),
        ),
        truncated: z.boolean(),
      },
    },
    async (input) => {
      const caller = requireCaller();
      const resolved = await scoped(caller, input.path);
      const { entries } = await executor.request<{
        entries: Array<{ fileName: string; isDirectory: boolean; isFile: boolean }>;
      }>("fs/readDirectory", { path: resolved });
      const sorted = entries
        .map((entry) => ({ name: entry.fileName, kind: entryKind(entry) }))
        .sort((a, b) => a.name.localeCompare(b.name));
      return toolResult({
        path: displayPath(
          workspaceRoot(caller),
          path.resolve(workspaceRoot(caller), input.path ?? "."),
        ),
        entries: sorted.slice(0, MAX_LIST_ENTRIES),
        truncated: sorted.length > MAX_LIST_ENTRIES,
      });
    },
  );

  registerTool(
    "apply_patch",
    {
      title: "Apply a patch",
      description:
        "Apply a patch in Codex's apply_patch format ('*** Begin Patch' … '*** End Patch', with " +
        "Add File, Update File, Delete File and Move to sections) to files in your workspace.",
      inputSchema: {
        patch: z
          .string()
          .min(1)
          .refine((value) => Buffer.byteLength(value, "utf8") <= MAX_PATCH_BYTES, {
            message: `patch must be at most ${MAX_PATCH_BYTES} bytes; split it into several patches`,
          }),
      },
      outputSchema: { exitCode: z.number(), output: z.string() },
    },
    async (input, context) => {
      const caller = requireCaller();
      const patch = await scopedPatch(caller, input.patch);
      const result = await runCommand(
        caller,
        [host.codexPath, "--codex-run-as-apply-patch", patch],
        { cwd: await scoped(caller), signal: context.signal },
      );
      const output = (result.stdout + result.stderr).trim();
      if (result.exitCode !== 0) {
        throw new Error(`Patch not applied: ${output}`);
      }
      return toolResult({ exitCode: result.exitCode, output });
    },
  );

  registerTool(
    "process_spawn",
    {
      title: "Start a process",
      description:
        "Start a long-running process (a dev server, a REPL, a watcher) in your workspace. Feed it with " +
        "process_write, collect its output with process_read, stop it with process_kill. It gets the same " +
        "Paseo variables as exec.",
      inputSchema: {
        command: ArgvSchema,
        cwd: RelativePathSchema.optional(),
        env: z.record(z.string(), z.string()).optional(),
      },
      outputSchema: { processId: z.string() },
    },
    async (input) => {
      const caller = requireCaller();
      return toolResult(
        await host.processes.spawn({
          agentId: caller.id,
          command: input.command,
          cwd: await scoped(caller, input.cwd),
          env: { ...input.env, ...host.resolveRunEnv(caller.id) },
        }),
      );
    },
  );

  registerTool(
    "process_write",
    {
      title: "Write to a process",
      description: "Write text to a process's stdin, or close its stdin.",
      inputSchema: {
        processId: z.string(),
        input: z.string().optional(),
        closeStdin: z.boolean().optional(),
      },
      outputSchema: { ok: z.boolean() },
    },
    async (input) => {
      const caller = requireCaller();
      await host.processes.write(caller.id, input.processId, {
        data: input.input,
        closeStdin: input.closeStdin,
      });
      return toolResult({ ok: true });
    },
  );

  registerTool(
    "process_read",
    {
      title: "Read a process's output",
      description:
        "Return the output a process wrote since the last read, waiting up to waitMs for some. Once it " +
        "reports exited, the process is gone.",
      inputSchema: {
        processId: z.string(),
        waitMs: z.number().int().min(0).max(MAX_PROCESS_WAIT_MS).optional(),
        maxChars: z.number().int().positive().max(MAX_OUTPUT_BYTES).optional(),
      },
      outputSchema: {
        stdout: z.string(),
        stderr: z.string(),
        exited: z.boolean(),
        exitCode: z.number().nullable(),
        droppedChars: z.number(),
      },
    },
    async (input) => {
      const caller = requireCaller();
      return toolResult(
        await host.processes.read(caller.id, input.processId, {
          waitMs: input.waitMs ?? 0,
          maxChars: input.maxChars ?? DEFAULT_PROCESS_READ_CHARS,
        }),
      );
    },
  );

  registerTool(
    "process_kill",
    {
      title: "Kill a process",
      description: "Stop a process started with process_spawn.",
      inputSchema: { processId: z.string() },
      outputSchema: { ok: z.boolean() },
    },
    async (input) => {
      const caller = requireCaller();
      await host.processes.kill(caller.id, input.processId);
      return toolResult({ ok: true });
    },
  );

  registerTool(
    "process_list",
    {
      title: "List processes",
      description:
        "List the processes you started that have not been fully read since they exited.",
      inputSchema: {},
      outputSchema: {
        processes: z.array(
          z.object({
            processId: z.string(),
            command: z.array(z.string()),
            cwd: z.string(),
            startedAt: z.string(),
            running: z.boolean(),
          }),
        ),
      },
    },
    async () => {
      const caller = requireCaller();
      return toolResult({ processes: host.processes.list(caller.id) });
    },
  );

  registerTool(
    "search",
    {
      title: "Search file contents",
      description:
        "Search file contents in your workspace with ripgrep. Returns matching lines as path:line:text.",
      inputSchema: {
        pattern: z
          .string()
          .min(1)
          .describe("A regular expression, or literal text with fixedStrings."),
        path: RelativePathSchema.optional(),
        glob: z.array(z.string()).optional().describe("ripgrep globs, e.g. ['*.ts', '!dist/**']."),
        caseInsensitive: z.boolean().optional(),
        fixedStrings: z.boolean().optional(),
        maxOutputBytes: z.number().int().positive().max(MAX_OUTPUT_BYTES).optional(),
      },
      outputSchema: { output: z.string(), matched: z.boolean(), truncated: z.boolean() },
    },
    async (input, context) => {
      const caller = requireCaller();
      const root = await scoped(caller);
      const target = await scoped(caller, input.path);
      const args = ["rg", "--line-number", "--no-heading", "--color", "never"];
      if (input.caseInsensitive) args.push("--ignore-case");
      if (input.fixedStrings) args.push("--fixed-strings");
      for (const glob of input.glob ?? []) args.push("--glob", glob);
      args.push("-e", input.pattern);
      if (target !== root) args.push("--", displayPath(root, target));
      const result = await runCommand(caller, args, {
        cwd: root,
        maxOutputBytes: input.maxOutputBytes,
        signal: context.signal,
      });
      if (result.exitCode > 1) {
        throw new Error(`search failed: ${result.stderr.trim()}`);
      }
      return toolResult({
        output: result.stdout,
        matched: result.exitCode === 0,
        truncated: result.stdoutTruncated,
      });
    },
  );

  registerTool(
    "find_files",
    {
      title: "Find files by name",
      description: "Fuzzy-find files in your workspace by name or path fragment, best match first.",
      inputSchema: {
        query: z.string().min(1),
        limit: z.number().int().positive().max(500).optional(),
      },
      outputSchema: {
        files: z.array(z.object({ path: z.string(), score: z.number() })),
      },
    },
    async (input) => {
      const caller = requireCaller();
      const { files } = await executor.request<{ files: Array<{ path: string; score: number }> }>(
        "fuzzyFileSearch",
        { query: input.query, roots: [await scoped(caller)], cancellationToken: null },
      );
      return toolResult({
        files: files
          .slice(0, input.limit ?? 50)
          .map((file) => ({ path: file.path, score: file.score })),
      });
    },
  );

  registerTool(
    "git_status",
    {
      title: "Git status",
      description:
        "Show the working tree status of your workspace's repository (porcelain, with branch).",
      inputSchema: {},
      outputSchema: GitResultShape,
    },
    async (_input, context) => {
      const caller = requireCaller();
      return toolResult(
        await runGit(caller, ["status", "--porcelain=v1", "--branch"], { signal: context.signal }),
      );
    },
  );

  registerTool(
    "git_diff",
    {
      title: "Git diff",
      description:
        "Show changes in your workspace's repository: unstaged, staged, or against a ref.",
      inputSchema: {
        staged: z.boolean().optional(),
        ref: GitRefSchema.optional().describe(
          "Compare the working tree (or the index) with this ref.",
        ),
        paths: z.array(RelativePathSchema).optional(),
        maxOutputBytes: z.number().int().positive().max(MAX_OUTPUT_BYTES).optional(),
      },
      outputSchema: GitResultShape,
    },
    async (input, context) => {
      const caller = requireCaller();
      const args = ["diff", "--no-color"];
      if (input.staged) args.push("--cached");
      if (input.ref) args.push(input.ref);
      args.push("--", ...(await scopedPathArgs(caller, input.paths)));
      return toolResult(
        await runGit(caller, args, {
          maxOutputBytes: input.maxOutputBytes,
          signal: context.signal,
        }),
      );
    },
  );

  registerTool(
    "git_log",
    {
      title: "Git log",
      description: "List recent commits: hash, author, date and subject, newest first.",
      inputSchema: {
        maxCount: z.number().int().positive().max(500).optional(),
        ref: GitRefSchema.optional(),
      },
      outputSchema: GitResultShape,
    },
    async (input, context) => {
      const caller = requireCaller();
      const args = [
        "log",
        `--max-count=${input.maxCount ?? 20}`,
        "--date=iso-strict",
        "--format=%h%x09%an%x09%ad%x09%s",
      ];
      if (input.ref) args.push(input.ref, "--");
      return toolResult(await runGit(caller, args, { signal: context.signal }));
    },
  );

  registerTool(
    "git_commit",
    {
      title: "Git commit",
      description:
        "Commit in your workspace's repository: the given paths (added first), every tracked change " +
        "(all), or what is staged.",
      inputSchema: {
        message: z.string().min(1),
        paths: z.array(RelativePathSchema).optional(),
        all: z.boolean().optional(),
      },
      outputSchema: GitResultShape,
    },
    async (input, context) => {
      const caller = requireCaller();
      const paths = await scopedPathArgs(caller, input.paths);
      if (paths.length > 0) {
        await runGit(caller, ["add", "--", ...paths], { signal: context.signal });
      }
      const args = ["commit", "-m", input.message];
      if (input.all) args.push("--all");
      if (paths.length > 0) args.push("--", ...paths);
      return toolResult(await runGit(caller, args, { signal: context.signal }));
    },
  );

  registerTool(
    "git_push",
    {
      title: "Git push",
      description: "Push a branch of your workspace's repository to a remote.",
      inputSchema: {
        remote: GitRefSchema.optional().describe("Defaults to the branch's upstream remote."),
        branch: GitRefSchema.optional(),
        setUpstream: z.boolean().optional(),
      },
      outputSchema: GitResultShape,
    },
    async (input, context) => {
      const caller = requireCaller();
      const args = ["push"];
      if (input.setUpstream) args.push("--set-upstream");
      if (input.remote) args.push(input.remote);
      if (input.branch) args.push(input.branch);
      return toolResult(await runGit(caller, args, { signal: context.signal }));
    },
  );
}
