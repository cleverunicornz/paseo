import { execFile } from "node:child_process";
import http from "node:http";
import type net from "node:net";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import ts from "typescript";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";

import { renderToolTree, writeToolTree, type ToolTreeServer } from "./tool-tree.js";

const execFileAsync = promisify(execFile);

const FIXTURE: ToolTreeServer[] = [
  {
    name: "paseo",
    tools: [
      {
        name: "exec",
        description: "Run a command in your workspace.\nReturns its output.",
        inputSchema: {
          type: "object",
          properties: {
            command: { type: "array", items: { type: "string" }, description: "Argv." },
            cwd: { type: "string" },
            timeoutMs: { type: "integer" },
            mode: { type: "string", enum: ["fast", "safe"] },
          },
          required: ["command"],
          additionalProperties: false,
        },
        outputSchema: {
          type: "object",
          properties: {
            exitCode: { type: "number" },
            stdout: { type: "string" },
            "odd-key": { anyOf: [{ type: "string" }, { type: "null" }] },
          },
          required: ["exitCode", "stdout"],
        },
      },
    ],
  },
  {
    name: "cluster",
    tools: [
      {
        name: "get-pods",
        description: "List pods. Never */ closes a comment.",
        inputSchema: {
          type: "object",
          properties: {
            namespace: { type: "string" },
            labels: { type: "object", additionalProperties: { type: "string" } },
          },
        },
      },
      { name: "list.things", inputSchema: { type: "object", properties: {} } },
    ],
  },
];

/** Strict TypeScript diagnostics for files of a tree, compiled as an agent's script would be. */
function typecheck(rootNames: string[]): string[] {
  const program = ts.createProgram(rootNames, {
    strict: true,
    noEmit: true,
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.NodeNext,
    moduleResolution: ts.ModuleResolutionKind.NodeNext,
    allowImportingTsExtensions: true,
    verbatimModuleSyntax: true,
    // The tree needs no type packages: an agent's script runs it as-is.
    types: [],
  });
  return ts.getPreEmitDiagnostics(program).map((d) => {
    const where = d.file ? `${path.basename(d.file.fileName)}: ` : "";
    return `${where}${ts.flattenDiagnosticMessageText(d.messageText, "\n")}`;
  });
}

const AWKWARD_TOOL_NAMES = [
  "index",
  "INDEX",
  "call_tool",
  "callTool",
  "ToolContent",
  "client",
  "read-file",
  "read_file",
  "readFile",
  "ReadFile",
  "Read.File",
  "read_file_2",
  "foo",
  "foo_input",
  "FooInput",
  "class",
  "123go",
  "",
  "$",
  "a/b",
  "../up",
  "constructor",
  "__proto__",
  "café",
  "日本",
];

const AWKWARD: ToolTreeServer[] = [
  {
    name: "paseo",
    tools: AWKWARD_TOOL_NAMES.map((name) => ({
      name,
      inputSchema: { type: "object", properties: { value: { type: "string" } } },
      outputSchema: { type: "object", properties: { ok: { type: "boolean" } } },
    })),
  },
  ...["a.b", "a_b", "A_B", "x/../y", ""].map((name) => ({
    name,
    tools: [{ name: "index", inputSchema: { type: "object", properties: {} } }],
  })),
];

const OBJECT_A = {
  type: "object",
  properties: { kind: { const: "a" }, a: { type: "string" } },
  required: ["kind", "a"],
};
const OBJECT_B = {
  type: "object",
  properties: { kind: { const: "b" }, b: { type: "number" } },
  required: ["kind", "b"],
};

const COMPOSED: ToolTreeServer[] = [
  {
    name: "shapes",
    tools: [
      {
        name: "one_of",
        inputSchema: { oneOf: [OBJECT_A, OBJECT_B] },
        outputSchema: { anyOf: [OBJECT_A, { type: "null" }] },
      },
      {
        name: "all_of",
        inputSchema: {
          allOf: [OBJECT_A, { type: "object", properties: { extra: { type: "boolean" } } }],
        },
        outputSchema: {
          allOf: [
            { anyOf: [OBJECT_A, OBJECT_B] },
            { type: "object", properties: { id: { type: "string" } } },
          ],
        },
      },
      { name: "empty_all_of", inputSchema: { type: "object", properties: { x: { allOf: [] } } } },
      {
        name: "refs",
        inputSchema: {
          type: "object",
          properties: {
            point: { $ref: "#/$defs/Point" },
            tree: { $ref: "#/$defs/Node" },
            remote: { $ref: "https://example.invalid/s.json" },
          },
          required: ["point"],
          $defs: {
            Point: {
              type: "object",
              properties: { x: { type: "number" }, y: { type: "number" } },
              required: ["x", "y"],
            },
            Node: {
              type: "object",
              properties: { children: { type: "array", items: { $ref: "#/$defs/Node" } } },
            },
          },
        },
      },
      {
        name: "nested",
        inputSchema: {
          type: "object",
          properties: {
            outer: {
              type: "object",
              properties: {
                inner: { type: "object", properties: { deep: { type: ["string", "null"] } } },
              },
            },
            list: { type: "array", items: { anyOf: [OBJECT_A, { type: "null" }] } },
            map: { type: "object", additionalProperties: { oneOf: [OBJECT_A, OBJECT_B] } },
            literal: { const: { nested: [1, "two", null] } },
            mixed: { enum: ["x", 1, true, null] },
          },
          required: ["list"],
        },
        outputSchema: { type: "array", items: { oneOf: [OBJECT_A, OBJECT_B] } },
      },
    ],
  },
];

describe("tool tree generator", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), "paseo-tool-tree-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  test("renders one typed file per tool, grouped by server, plus one client module", () => {
    const files = renderToolTree(FIXTURE);
    expect([...files.keys()].sort()).toEqual([
      "README.md",
      "client.ts",
      "package.json",
      "servers/cluster/get_pods.ts",
      "servers/cluster/index.ts",
      "servers/cluster/list_things.ts",
      "servers/paseo/exec.ts",
      "servers/paseo/index.ts",
    ]);

    const exec = files.get("servers/paseo/exec.ts")!;
    expect(exec).toContain('import * as $client from "../../client.ts";');
    expect(exec).toContain("export interface ExecInput {");
    expect(exec).toContain("  /** Argv. */\n  command: string[];");
    expect(exec).toContain("  cwd?: string;");
    expect(exec).toContain('  mode?: "fast" | "safe";');
    expect(exec).toContain("export interface ExecOutput {");
    expect(exec).toContain('  "odd-key"?: string | null;');
    expect(exec).toContain(" * Run a command in your workspace.\n * Returns its output.");
    expect(exec).toContain("export function exec(input: ExecInput): Promise<ExecOutput> {");
    expect(exec).toContain(
      '  return $client.callTool("paseo", "exec", input) as Promise<ExecOutput>;',
    );

    const pods = files.get("servers/cluster/get_pods.ts")!;
    expect(pods).toContain(
      "export function getPods(input: GetPodsInput = {}): Promise<$client.ToolContent> {",
    );
    expect(pods).toContain('callTool("cluster", "get-pods", input)');
    expect(pods).toContain("labels?: Record<string, string>;");
    expect(pods).not.toContain("Never */ closes");

    expect(files.get("servers/cluster/index.ts")).toBe(
      'export * from "./get_pods.ts";\nexport * from "./list_things.ts";\n',
    );
    expect(files.get("README.md")).toContain("servers/cluster/get_pods.ts");
  });

  test("the generated tree typechecks strictly and its types reject wrong input", async () => {
    await writeToolTree(dir, FIXTURE);
    await writeFile(
      path.join(dir, "use.ts"),
      [
        'import { exec } from "./servers/paseo/index.ts";',
        'import { getPods, listThings } from "./servers/cluster/index.ts";',
        'const result = await exec({ command: ["ls"], mode: "fast" });',
        "const code: number = result.exitCode;",
        'await getPods({ labels: { app: "x" } });',
        "await listThings();",
        "export { code };",
      ].join("\n"),
    );
    await writeFile(
      path.join(dir, "misuse.ts"),
      'import { exec } from "./servers/paseo/exec.ts";\nawait exec({ command: "ls" });\nexport {};\n',
    );

    const diagnostics = (rootName: string) => typecheck([path.join(dir, rootName)]);
    expect(diagnostics("use.ts")).toEqual([]);
    expect(diagnostics("misuse.ts").join("\n")).toMatch(/not assignable to type 'string\[\]'/);
  });

  test("every valid tool name gets its own file and a unique export, and the tree typechecks", async () => {
    const files = renderToolTree(AWKWARD);
    const servers = new Map<string, string>();
    for (const server of AWKWARD) {
      for (const tool of server.tools) {
        const call = `callTool(${JSON.stringify(server.name)}, ${JSON.stringify(tool.name)}, input)`;
        const owners = [...files.entries()].filter(([, content]) => content.includes(call));
        expect(
          owners.map(([file]) => file),
          `${server.name}/${tool.name}`,
        ).toHaveLength(1);
        const [file, content] = owners[0]!;
        expect(file).toMatch(/^servers\/[A-Za-z0-9_-]+\/[A-Za-z0-9_]+\.ts$/);
        expect(path.basename(file)).not.toBe("index.ts");
        const dirName = path.dirname(file);
        expect(servers.get(dirName) ?? server.name, file).toBe(server.name);
        servers.set(dirName, server.name);
        expect(content).toMatch(/export function [A-Za-z_$][\w$]*\(/);
      }
    }
    // A tool whose clean name no other tool contests keeps it.
    const kept = files.get("servers/paseo/constructor.ts");
    expect(kept).toContain('callTool("paseo", "constructor", input)');
    expect(kept).toContain("export function constructor(");
    // No two files differ only in case, so the tree survives a case-insensitive disk.
    const lowered = [...files.keys()].map((file) => file.toLowerCase());
    expect(new Set(lowered).size).toBe(lowered.length);

    await writeToolTree(dir, AWKWARD);
    // Each server's barrel re-exports every tool's function under its own name.
    const imports: string[] = [];
    const uses: string[] = [];
    [...files.entries()]
      .filter(([file]) => file.startsWith("servers/") && !file.endsWith("/index.ts"))
      .forEach(([file, content], index) => {
        const name = /export function ([A-Za-z_$][\w$]*)\(/.exec(content)![1]!;
        imports.push(`import * as m${index} from "./${path.dirname(file)}/index.ts";`);
        uses.push(`m${index}.${name}`);
      });
    await writeFile(
      path.join(dir, "use-all.ts"),
      `${imports.join("\n")}\nexport const all: Array<(input?: never) => Promise<unknown>> = [${uses.join(", ")}];\n`,
    );
    const roots = [...files.keys()]
      .filter((file) => file.endsWith(".ts"))
      .map((file) => path.join(dir, file));
    expect(typecheck([...roots, path.join(dir, "use-all.ts")])).toEqual([]);
  });

  test("composed and referenced schemas render as valid, precise types", async () => {
    await writeToolTree(dir, COMPOSED);
    await writeFile(
      path.join(dir, "use.ts"),
      [
        'import { oneOf, allOf, emptyAllOf, refs, nested } from "./servers/shapes/index.ts";',
        'const one = await oneOf({ kind: "b", b: 1 });',
        'const kind: "a" | undefined = one?.kind;',
        'const all = await allOf({ kind: "a", a: "x", extra: true });',
        "const id: string | undefined = all.id;",
        "await emptyAllOf({ x: 1 });",
        "await refs({ point: { x: 1, y: 2 }, tree: { children: [{ children: [] }] }, remote: 1 });",
        'const items = await nested({ list: [null, { kind: "a", a: "x" }], map: { k: { kind: "b", b: 2 } }, mixed: "x", literal: { nested: [1, "two", null] }, outer: { inner: { deep: null } } });',
        'const first: { kind: "a" } | { kind: "b" } | undefined = items[0];',
        "export { kind, id, first };",
      ].join("\n"),
    );
    await writeFile(
      path.join(dir, "misuse.ts"),
      [
        'import { oneOf, refs, nested } from "./servers/shapes/index.ts";',
        'await oneOf({ kind: "a", b: 1 });',
        "await refs({ point: { x: 1 } });",
        "await nested({ list: [1] });",
        "export {};",
      ].join("\n"),
    );
    const roots = [...renderToolTree(COMPOSED).keys()]
      .filter((file) => file.endsWith(".ts"))
      .map((file) => path.join(dir, file));
    expect(typecheck([...roots, path.join(dir, "use.ts")])).toEqual([]);
    const misuse = typecheck([path.join(dir, "misuse.ts")]);
    expect(misuse).toHaveLength(3);
  });

  test("rewrites the tree only when the rendered tool list changes", async () => {
    expect(await writeToolTree(dir, FIXTURE)).toEqual({ written: true });
    const before = (await stat(path.join(dir, "servers/paseo/exec.ts"))).mtimeMs;
    expect(await writeToolTree(dir, FIXTURE)).toEqual({ written: false });

    const changed: ToolTreeServer[] = [
      FIXTURE[0]!,
      { name: "cluster", tools: [FIXTURE[1]!.tools[0]!] },
    ];
    expect(await writeToolTree(dir, changed)).toEqual({ written: true });
    await expect(stat(path.join(dir, "servers/cluster/list_things.ts"))).rejects.toThrow();
    expect((await stat(path.join(dir, "servers/paseo/exec.ts"))).mtimeMs).toBeGreaterThanOrEqual(
      before,
    );
  });
});

/** A stateless MCP server that accepts only the run's token and names the route it was reached on. */
async function serveFixtureServer(
  req: http.IncomingMessage,
  res: http.ServerResponse,
): Promise<void> {
  if (req.headers.authorization !== "Bearer agent-token") {
    res.writeHead(401).end();
    return;
  }
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  const route = req.url ?? "";
  const mcp = new McpServer({ name: "fixture", version: "1.0.0" });
  mcp.registerTool(
    "exec",
    {
      inputSchema: { command: z.array(z.string()) },
      outputSchema: { exitCode: z.number(), stdout: z.string() },
    },
    async ({ command }) => ({
      content: [],
      structuredContent: { exitCode: 0, stdout: `${route}:${command.join(" ")}` },
    }),
  );
  mcp.registerTool("get-pods", { inputSchema: {} }, async () => ({
    content: [{ type: "text", text: `pods via ${route}` }],
  }));
  mcp.registerTool("fails", { inputSchema: {} }, async () => ({
    content: [{ type: "text", text: "it broke" }],
    isError: true,
  }));
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  res.on("close", () => {
    void transport.close();
    void mcp.close();
  });
  await mcp.connect(transport);
  const body = Buffer.concat(chunks).toString("utf8");
  await transport.handleRequest(req, res, body ? JSON.parse(body) : undefined);
}

describe("generated client", () => {
  let dir: string;
  let server: http.Server;
  let port: number;
  const seen: Array<{ path: string; authorization: string | undefined }> = [];

  beforeEach(async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), "paseo-tool-tree-client-"));
    seen.length = 0;
    server = http.createServer((req, res) => {
      seen.push({ path: req.url ?? "", authorization: req.headers.authorization });
      void serveFixtureServer(req, res);
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    port = (server.address() as net.AddressInfo).port;
  });

  afterEach(async () => {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await rm(dir, { recursive: true, force: true });
  });

  test("calls Paseo's tools and backend tools with the run's token from a plain script", async () => {
    const servers: ToolTreeServer[] = [
      {
        name: "paseo",
        tools: [
          {
            name: "exec",
            inputSchema: {
              type: "object",
              properties: { command: { type: "array", items: { type: "string" } } },
              required: ["command"],
            },
            outputSchema: {
              type: "object",
              properties: { exitCode: { type: "number" }, stdout: { type: "string" } },
              required: ["exitCode", "stdout"],
            },
          },
          { name: "fails", inputSchema: { type: "object", properties: {} } },
        ],
      },
      {
        name: "cluster",
        tools: [{ name: "get-pods", inputSchema: { type: "object", properties: {} } }],
      },
    ];
    await writeToolTree(dir, servers);
    const script = path.join(dir, "run.ts");
    await writeFile(
      script,
      [
        'import { exec, fails } from "./servers/paseo/index.ts";',
        'import { getPods } from "./servers/cluster/index.ts";',
        'const ran = await exec({ command: ["echo", "hi"] });',
        "const pods = await getPods();",
        "let failure = '';",
        "try { await fails(); } catch (error) { failure = (error as Error).message; }",
        "console.log(JSON.stringify({ ran, pods, failure }));",
      ].join("\n"),
    );
    const { stdout } = await execFileAsync(
      process.execPath,
      ["--experimental-strip-types", "--no-warnings", script],
      {
        env: {
          PATH: process.env.PATH,
          PASEO_AGENT_TOKEN: "agent-token",
          PASEO_MCP_URL: `http://127.0.0.1:${port}/mcp/agents`,
          PASEO_MCP_GATEWAY_URL: `http://127.0.0.1:${port}/mcp/backends`,
        },
      },
    );
    expect(JSON.parse(stdout)).toEqual({
      ran: { exitCode: 0, stdout: "/mcp/agents:echo hi" },
      pods: [{ type: "text", text: "pods via /mcp/backends/cluster" }],
      failure: expect.stringContaining("it broke"),
    });
    expect(seen.length).toBeGreaterThan(0);
    expect(seen.every((request) => request.authorization === "Bearer agent-token")).toBe(true);
  });

  test("fails clearly when the run has no Paseo credentials", async () => {
    await writeToolTree(dir, [
      { name: "paseo", tools: [{ name: "exec", inputSchema: { type: "object", properties: {} } }] },
    ]);
    const script = path.join(dir, "run.ts");
    await writeFile(script, 'import { exec } from "./servers/paseo/exec.ts";\nawait exec({});\n');
    const failure = await execFileAsync(
      process.execPath,
      ["--experimental-strip-types", "--no-warnings", script],
      {
        env: { PATH: process.env.PATH },
      },
    ).catch((error: { stderr: string }) => error);
    expect("stderr" in failure ? failure.stderr : "").toContain("PASEO_AGENT_TOKEN");
    expect(await readFile(path.join(dir, "client.ts"), "utf8")).not.toContain("agent-token");
  });
});
