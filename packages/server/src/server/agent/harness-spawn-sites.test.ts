import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { describe, expect, test } from "vitest";

/**
 * Every process a harness module (Claude Code, Codex) starts from its harness
 * binary gets its environment from `resolveHarnessSpawnEnv`. Harness modules
 * therefore reach a process only through the helpers in `harness-process.ts`,
 * which accept nothing but a `HarnessSpawnEnv`.
 *
 * The guard walks every module a harness module loads, transitively: static
 * and dynamic imports, `require`, side-effect imports and re-exports. In that
 * closure a package may be loaded only from `PERMITTED_PACKAGES`, a module that
 * can start a process (any module that loads one) only for the names reviewed
 * in `REVIEWED_IMPORTS`, and no code may reach a process through a runtime
 * global (`Bun.spawn`, `process.getBuiltinModule`, a computed `import()`).
 * Everything else fails, so a new route to a process needs a review here.
 */

const AGENT_DIR = dirname(fileURLToPath(import.meta.url));
const SRC_DIR = resolve(AGENT_DIR, "../..");
const HELPERS = resolve(AGENT_DIR, "harness-process.ts");

/** Packages a harness module may load: none of them starts a process. */
const PERMITTED_PACKAGES = new Set([
  "node:crypto",
  "node:events",
  "node:fs",
  "node:fs/promises",
  "node:os",
  "node:path",
  "node:readline",
  "node:url",
  "node:util",
  "pino",
  "zod",
  "uuid",
]);

/** Package prefixes whose every subpath a harness module may load. */
const PERMITTED_PACKAGE_PREFIXES = ["@getpaseo/protocol/"];

interface ReviewedImport {
  /** Repository path under `packages/server/src`, or a package name. */
  module: string;
  /** The value names reviewed; nothing else may be loaded from the module. */
  names: readonly string[];
  /** Set when only this harness module may load the names. */
  importer?: string;
  why: string;
}

/**
 * Names a harness module may load from a module or package that can start a
 * process. The guard does not enter these modules: each name was reviewed.
 */
const REVIEWED_IMPORTS: readonly ReviewedImport[] = [
  {
    module: "@anthropic-ai/claude-agent-sdk",
    names: ["query"],
    importer: "server/agent/providers/claude/query.ts",
    why: "The SDK starts Claude Code through `spawnClaudeCodeProcess`, which query.ts supplies.",
  },
  {
    module: "utils/spawn.ts",
    names: ["spawnProcess"],
    importer: "server/agent/providers/claude/query.ts",
    why:
      "`spawnClaudeCodeProcess` starts Claude Code with the SDK's `options.env`, which " +
      "`ClaudeAgentSession.buildSdkEnv` builds with `buildAllowlistedHarnessEnv`; `builtLaunch` " +
      "drops every refused name the SDK adds.",
  },
  {
    module: "@anthropic-ai/claude-agent-sdk",
    names: ["forkSession"],
    importer: "server/agent/providers/claude/rewind.ts",
    why: "Forks a conversation by rewriting session files; it starts no process.",
  },
  {
    module: "utils/tree-kill.ts",
    names: ["terminateWithTreeKill"],
    why: "Signals an already running process tree; it starts no harness binary.",
  },
  {
    module: "server/agent/provider-launch-config.ts",
    names: [
      "createProviderEnv",
      "createProviderEnvSpec",
      "PARENT_SESSION_ENV_VARS",
      "resolveProviderLaunch",
    ],
    why: "Build environment records and the launch command from settings; none starts a process.",
  },
  {
    module: "server/agent/providers/diagnostic-utils.ts",
    names: ["formatProviderDiagnostic", "formatProviderDiagnosticError"],
    why: "Format diagnostic text.",
  },
];

interface ModuleLoad {
  specifier: string;
  /** The value names loaded; `*` for a whole module (namespace, `import()`, `export *`). */
  names: readonly string[];
}

interface ModuleFacts {
  loads: ModuleLoad[];
  /** Runtime routes to a process that need no import. */
  runtimeRoutes: string[];
}

const RUNTIME_PROCESS_MEMBERS = new Set([
  "getBuiltinModule",
  "binding",
  "_linkedBinding",
  "dlopen",
]);

function specifierOf(node: ts.Expression | undefined): string | null {
  return node && ts.isStringLiteralLike(node) ? node.text : null;
}

function importClauseNames(clause: ts.ImportClause | undefined): string[] {
  if (!clause) return ["*"];
  if (clause.isTypeOnly) return [];
  const names: string[] = clause.name ? ["default"] : [];
  const bindings = clause.namedBindings;
  if (bindings && ts.isNamespaceImport(bindings)) names.push("*");
  if (bindings && ts.isNamedImports(bindings)) {
    for (const element of bindings.elements) {
      if (!element.isTypeOnly) names.push((element.propertyName ?? element.name).text);
    }
  }
  return names;
}

function exportClauseNames(node: ts.ExportDeclaration): string[] {
  if (node.isTypeOnly) return [];
  const clause = node.exportClause;
  if (!clause || ts.isNamespaceExport(clause)) return ["*"];
  return clause.elements
    .filter((element) => !element.isTypeOnly)
    .map((element) => (element.propertyName ?? element.name).text);
}

/** The module a declaration or call loads, with the value names it loads; `null` for a computed one. */
function moduleLoadOf(node: ts.Node): ModuleLoad | null | undefined {
  if (ts.isImportDeclaration(node)) {
    const specifier = specifierOf(node.moduleSpecifier);
    return specifier ? { specifier, names: importClauseNames(node.importClause) } : undefined;
  }
  if (ts.isExportDeclaration(node)) {
    const specifier = specifierOf(node.moduleSpecifier);
    return specifier ? { specifier, names: exportClauseNames(node) } : undefined;
  }
  if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference)) {
    const specifier = specifierOf(node.moduleReference.expression);
    return specifier ? { specifier, names: node.isTypeOnly ? [] : ["*"] } : undefined;
  }
  if (!ts.isCallExpression(node)) return undefined;
  const callee = node.expression;
  const isLoader =
    callee.kind === ts.SyntaxKind.ImportKeyword ||
    (ts.isIdentifier(callee) && callee.text === "require");
  if (!isLoader) return undefined;
  const specifier = specifierOf(node.arguments[0]);
  return specifier ? { specifier, names: ["*"] } : null;
}

/** A route to a process through a runtime global: `Bun.*`, `process.getBuiltinModule`, `eval`. */
function runtimeRouteOf(node: ts.Node, file: ts.SourceFile): string | undefined {
  if (
    (ts.isCallExpression(node) || ts.isNewExpression(node)) &&
    ts.isIdentifier(node.expression) &&
    (node.expression.text === "eval" || node.expression.text === "Function")
  ) {
    return `${node.expression.text}()`;
  }
  if (!ts.isPropertyAccessExpression(node) && !ts.isElementAccessExpression(node)) {
    return undefined;
  }
  const target = node.expression.getText(file);
  const member = ts.isPropertyAccessExpression(node)
    ? node.name.text
    : specifierOf(node.argumentExpression);
  if (/(^|\.)Bun$/.test(target)) return `${target}.${member ?? "[…]"}`;
  if (/(^|\.)process$/.test(target) && member && RUNTIME_PROCESS_MEMBERS.has(member)) {
    return `${target}.${member}`;
  }
  return undefined;
}

/** Every module a source loads, and every runtime route it takes to a process. */
function readModuleFacts(fileName: string, source: string): ModuleFacts {
  const file = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true);
  const facts: ModuleFacts = { loads: [], runtimeRoutes: [] };
  const visit = (node: ts.Node) => {
    const load = moduleLoadOf(node);
    if (load === null) facts.runtimeRoutes.push("load of a computed module");
    else if (load && load.names.length > 0) facts.loads.push(load);
    const route = runtimeRouteOf(node, file);
    if (route) facts.runtimeRoutes.push(route);
    ts.forEachChild(node, visit);
  };
  visit(file);
  return facts;
}

/** A read-only view of the source tree, so the self-test can use a virtual one. */
interface SourceTree {
  read(path: string): string | null;
}

const diskTree: SourceTree = {
  read: (path) => (existsSync(path) ? readFileSync(path, "utf8") : null),
};

function resolveLocal(tree: SourceTree, fromFile: string, specifier: string): string {
  const base = resolve(dirname(fromFile), specifier);
  const candidates = [base.replace(/\.js$/, ".ts"), base.replace(/\.js$/, ".tsx"), `${base}.ts`];
  candidates.push(join(base, "index.ts"));
  return candidates.find((candidate) => tree.read(candidate) !== null) ?? base;
}

function isPermittedPackage(specifier: string): boolean {
  return (
    PERMITTED_PACKAGES.has(specifier) ||
    PERMITTED_PACKAGE_PREFIXES.some((prefix) => specifier.startsWith(prefix))
  );
}

/** Every module that loads a process package or takes a runtime route, and every module that loads one of those. */
function reachesProcess(
  tree: SourceTree,
  path: string,
  seen = new Map<string, boolean>(),
): boolean {
  const known = seen.get(path);
  if (known !== undefined) return known;
  seen.set(path, false);
  const source = tree.read(path);
  if (source === null) return false;
  const facts = readModuleFacts(path, source);
  const reaches =
    facts.runtimeRoutes.length > 0 ||
    facts.loads.some((entry) =>
      entry.specifier.startsWith(".")
        ? reachesProcess(tree, resolveLocal(tree, path, entry.specifier), seen)
        : !isPermittedPackage(entry.specifier),
    );
  seen.set(path, reaches);
  return reaches;
}

function reviewedNames(module: string, importer: string): Set<string> {
  return new Set(
    REVIEWED_IMPORTS.filter(
      (entry) => entry.module === module && (!entry.importer || entry.importer === importer),
    ).flatMap((entry) => entry.names),
  );
}

/**
 * Walks the closure of `roots` and returns each load that can reach a process
 * outside the harness spawn helpers, as `importer: what`. A root loaded by
 * another root is walked, never reviewed: it is checked on its own.
 */
function findProcessRoutes(tree: SourceTree, roots: readonly string[]): string[] {
  const rootSet = new Set(roots);
  const routes: string[] = [];
  const visited = new Set<string>();
  const reachCache = new Map<string, boolean>();
  const pending = [...roots];
  while (pending.length > 0) {
    const path = pending.pop()!;
    if (visited.has(path)) continue;
    visited.add(path);
    const source = tree.read(path);
    const importer = relative(SRC_DIR, path);
    if (source === null) {
      routes.push(`${importer}: unreadable module`);
      continue;
    }
    const facts = readModuleFacts(path, source);
    routes.push(...facts.runtimeRoutes.map((route) => `${importer}: ${route}`));
    for (const entry of facts.loads) {
      const isLocal = entry.specifier.startsWith(".");
      const target = isLocal ? resolveLocal(tree, path, entry.specifier) : entry.specifier;
      if (target === HELPERS) continue;
      if (rootSet.has(target)) {
        pending.push(target);
        continue;
      }
      const module = isLocal ? relative(SRC_DIR, target) : target;
      const reaches = isLocal
        ? reachesProcess(tree, target, reachCache)
        : !isPermittedPackage(target);
      if (!reaches) {
        if (isLocal) pending.push(target);
        continue;
      }
      const reviewed = reviewedNames(module, importer);
      for (const name of entry.names) {
        if (!reviewed.has(name)) routes.push(`${importer}: ${name} from ${module}`);
      }
    }
  }
  return routes.sort();
}

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

function virtualTree(files: Record<string, string>): SourceTree {
  const byPath = new Map(
    Object.entries(files).map(([path, source]) => [resolve(SRC_DIR, path), source]),
  );
  return { read: (path) => byPath.get(path) ?? null };
}

describe("harness modules reach a process only through the harness spawn helpers", () => {
  test("the guard recognises every route to a process", () => {
    const harness = "server/agent/providers/claude/sample.ts";
    const sibling = "server/agent/providers/claude/sibling.ts";
    const tree = virtualTree({
      [sibling]: 'import { terminateWithTreeKill } from "../../../../utils/tree-kill.js";',
      [harness]: [
        'import { spawn } from "node:child_process";',
        'import type { ChildProcess } from "node:child_process";',
        'import { type ChildProcessWithoutNullStreams } from "node:child_process";',
        'import pty from "node-pty";',
        'import { execa } from "execa";',
        'import "./side-effect.js";',
        'import { spawnHarnessProcess } from "../../harness-process.js";',
        'import { terminateWithTreeKill } from "../../../../utils/tree-kill.js";',
        'import { query } from "@anthropic-ai/claude-agent-sdk";',
        'import { spawnProcess, type SpawnEnvOptions } from "../../../../utils/spawn.js";',
        'import { parse } from "./pure.js";',
        'import { stop } from "./sibling.js";',
        'import { relay } from "./relay.js";',
        'export { probe } from "./reexport.js";',
        'export * from "./star.js";',
        'const cp = require("child_process");',
        'const late = await import("../../late.js");',
        "const computed = await import(name);",
        'const builtin = process.getBuiltinModule("node:child_process");',
        'Bun.spawn(["claude"]);',
        'globalThis.Bun["spawnSync"](["codex"]);',
        'new Function("return process")();',
      ].join("\n"),
      "server/agent/providers/claude/side-effect.ts": 'import { spawn } from "node:child_process";',
      "server/agent/providers/claude/pure.ts": 'import { z } from "zod";\nexport const parse = z;',
      "server/agent/providers/claude/relay.ts":
        'import { inner } from "./inner.js";\nexport const relay = inner;',
      "server/agent/providers/claude/inner.ts":
        'export { execFile as inner } from "node:child_process";',
      "server/agent/providers/claude/reexport.ts":
        'export { execCommand as probe } from "../../../../utils/spawn.js";',
      "server/agent/providers/claude/star.ts": 'export * from "../../../../utils/spawn.js";',
      "server/agent/late.ts": 'const { fork } = require("node:child_process");',
      "server/agent/harness-process.ts": 'import { spawn } from "node:child_process";',
      "utils/tree-kill.ts": 'import treeKill from "tree-kill";',
      "utils/spawn.ts": 'import { spawn } from "node:child_process";',
    });

    const roots = [harness, sibling].map((path) => resolve(SRC_DIR, path));
    expect(findProcessRoutes(tree, roots)).toEqual(
      [
        `${harness}: spawn from node:child_process`,
        `${harness}: default from node-pty`,
        `${harness}: execa from execa`,
        `${harness}: * from server/agent/providers/claude/side-effect.ts`,
        `${harness}: query from @anthropic-ai/claude-agent-sdk`,
        `${harness}: spawnProcess from utils/spawn.ts`,
        `${harness}: relay from server/agent/providers/claude/relay.ts`,
        `${harness}: probe from server/agent/providers/claude/reexport.ts`,
        `${harness}: * from server/agent/providers/claude/star.ts`,
        `${harness}: * from child_process`,
        `${harness}: * from server/agent/late.ts`,
        `${harness}: load of a computed module`,
        `${harness}: process.getBuiltinModule`,
        `${harness}: Bun.spawn`,
        `${harness}: globalThis.Bun.spawnSync`,
        `${harness}: Function()`,
      ].sort(),
    );
  });

  test("the harness closure reaches a process only through the helpers and reviewed imports", () => {
    expect(findProcessRoutes(diskTree, listHarnessModules())).toEqual([]);
  });
});
