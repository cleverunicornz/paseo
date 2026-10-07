import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { describe, expect, test } from "vitest";

/**
 * Every process a harness module (Claude Code, Codex) starts from its harness
 * binary gets its environment from `resolveHarnessSpawnEnv`. Harness modules
 * therefore start processes only through the helpers in `harness-process.ts`,
 * which accept nothing but a `HarnessSpawnEnv`. This guard fails when a
 * harness module imports a spawn or probe primitive that takes any
 * environment, so a new harness spawn site cannot bypass the builder.
 */

const AGENT_DIR = dirname(fileURLToPath(import.meta.url));

/** Primitives that start a process with a caller-chosen environment, by module path. */
const SPAWN_PRIMITIVES = new Map<string, readonly string[]>([
  [resolve(AGENT_DIR, "../../utils/spawn.js"), ["spawnProcess", "execCommand"]],
  [
    resolve(AGENT_DIR, "../../executable-resolution/executable-resolution.js"),
    ["findExecutable", "probeExecutable", "isCommandAvailable"],
  ],
  [
    resolve(AGENT_DIR, "provider-launch-config.js"),
    ["checkProviderLaunchAvailable", "isProviderCommandAvailable", "resolveProviderCommandPrefix"],
  ],
  [
    resolve(AGENT_DIR, "providers/diagnostic-utils.js"),
    ["resolveBinaryVersion", "buildBinaryDiagnosticRows"],
  ],
]);

const CHILD_PROCESS_MODULES = new Set(["node:child_process", "child_process"]);

/**
 * Reviewed exceptions. The Claude Agent SDK hands Claude Code's launch to
 * `spawnClaudeCodeProcess` with the environment it was given as
 * `options.env`, which `ClaudeAgentSession.buildSdkEnv` builds with
 * `buildAllowlistedHarnessEnv` under the allowlist; `builtLaunch` drops every
 * refused name the SDK itself might add.
 */
const REVIEWED_SITES: Record<string, readonly string[]> = {
  "providers/claude/query.ts": ["spawnProcess"],
};

function listHarnessModules(): string[] {
  const modules: string[] = [join(AGENT_DIR, "providers/codex-app-server-agent.ts")];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name !== "test-utils" && entry.name !== "test-fixtures") walk(path);
      } else if (
        entry.name.endsWith(".ts") &&
        !entry.name.endsWith(".test.ts") &&
        !entry.name.startsWith("test-")
      ) {
        modules.push(path);
      }
    }
  };
  walk(join(AGENT_DIR, "providers/claude"));
  walk(join(AGENT_DIR, "providers/codex"));
  return modules;
}

/** Value bindings of an import of `node:child_process`. */
function importsChildProcessValues(clause: ts.ImportClause): boolean {
  const bindings = clause.namedBindings;
  if (clause.name || (bindings && ts.isNamespaceImport(bindings))) return true;
  return Boolean(
    bindings &&
    ts.isNamedImports(bindings) &&
    bindings.elements.some((element) => !element.isTypeOnly),
  );
}

/** The spawn primitives an import declaration brings in as values. */
function importedPrimitives(fileName: string, node: ts.ImportDeclaration): string[] {
  const clause = node.importClause;
  if (!clause || clause.isTypeOnly || !ts.isStringLiteral(node.moduleSpecifier)) return [];
  const specifier = node.moduleSpecifier.text;
  if (CHILD_PROCESS_MODULES.has(specifier)) {
    return importsChildProcessValues(clause) ? [specifier] : [];
  }
  const primitives = specifier.startsWith(".")
    ? SPAWN_PRIMITIVES.get(resolve(dirname(fileName), specifier))
    : undefined;
  const bindings = clause.namedBindings;
  if (!primitives || !bindings) return [];
  if (ts.isNamespaceImport(bindings)) return [`* as ${bindings.name.text}`];
  return bindings.elements
    .filter((element) => !element.isTypeOnly)
    .map((element) => (element.propertyName ?? element.name).text)
    .filter((imported) => primitives.includes(imported));
}

/** `import("node:child_process")` or `require("node:child_process")`. */
function loadsChildProcess(node: ts.Node): string | null {
  if (!ts.isCallExpression(node)) return null;
  const callee = node.expression;
  const isLoader =
    callee.kind === ts.SyntaxKind.ImportKeyword ||
    (ts.isIdentifier(callee) && callee.text === "require");
  const [argument] = node.arguments;
  if (!isLoader || !argument || !ts.isStringLiteral(argument)) return null;
  return CHILD_PROCESS_MODULES.has(argument.text) ? argument.text : null;
}

/** The spawn primitives a module's source imports or requires as values. */
function findSpawnPrimitiveImports(fileName: string, source: string): string[] {
  const file = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true);
  const found: string[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isImportDeclaration(node)) found.push(...importedPrimitives(fileName, node));
    const loaded = loadsChildProcess(node);
    if (loaded) found.push(loaded);
    ts.forEachChild(node, visit);
  };
  visit(file);
  return found;
}

describe("harness modules start processes only through the harness spawn helpers", () => {
  test("the guard recognises every way of reaching a spawn primitive", () => {
    const source = [
      'import { spawn } from "node:child_process";',
      'import * as cp from "child_process";',
      'import { execCommand as run, type SpawnEnvOptions } from "../../../../utils/spawn.js";',
      'import { probeExecutable } from "../../../../executable-resolution/executable-resolution.js";',
      'import { checkProviderLaunchAvailable } from "../../provider-launch-config.js";',
      'import { resolveBinaryVersion } from "../diagnostic-utils.js";',
      'import { execHarnessCommand } from "../../harness-process.js";',
      'const late = await import("node:child_process");',
      'import type { ChildProcess } from "node:child_process";',
      'import { type ChildProcessWithoutNullStreams } from "node:child_process";',
    ].join("\n");

    const sample = join(AGENT_DIR, "providers/claude/sample.ts");
    expect(findSpawnPrimitiveImports(sample, source)).toEqual([
      "node:child_process",
      "child_process",
      "execCommand",
      "probeExecutable",
      "checkProviderLaunchAvailable",
      "resolveBinaryVersion",
      "node:child_process",
    ]);
  });

  test.each(listHarnessModules().map((path) => [relative(AGENT_DIR, path), path] as const))(
    "%s",
    (name, path) => {
      const found = findSpawnPrimitiveImports(path, readFileSync(path, "utf8"));
      expect(found).toEqual(REVIEWED_SITES[name] ?? []);
    },
  );
});
