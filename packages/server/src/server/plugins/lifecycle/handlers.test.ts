import { expect, test } from "vitest";
import { createPaseoApi } from "@getpaseo/client";
import { DaemonClient } from "@getpaseo/client/internal/daemon-client";
import { PluginHookHandlers } from "./index.js";

const paseo = createPaseoApi(
  new DaemonClient({ url: "ws://127.0.0.1:1/ws", clientId: "lifecycle-unit" }),
);

test("removing an old registration twice preserves a newer registration for the same hook", async () => {
  const hooks = new PluginHookHandlers(() => {});
  const remove = hooks.before("workspace.create", ({ request }) => {
    return { ...request, title: "old" };
  });
  remove();
  hooks.before("workspace.create", ({ request }) => {
    return { ...request, title: "new" };
  });
  remove();
  const output = await hooks.invoke(
    "operation",
    "before",
    "workspace.create",
    {
      source: { kind: "directory", path: "/project" },
    },
    paseo,
  );
  expect(output).toEqual({ source: { kind: "directory", path: "/project" }, title: "new" });
});

test("before hooks compose returned requests and preserve the original input", async () => {
  const hooks = new PluginHookHandlers(() => {});
  hooks.before("workspace.create", ({ request }) => {
    return { ...request, title: "first" };
  });
  hooks.before("workspace.create", () => {
    return;
  });
  hooks.before("workspace.create", ({ request }) => {
    return { ...request, title: request.title + ":second" };
  });
  const input = { source: { kind: "directory", path: "/project" } };
  expect(await hooks.invoke("operation", "before", "workspace.create", input, paseo)).toEqual({
    source: { kind: "directory", path: "/project" },
    title: "first:second",
  });
  expect(input).toEqual({ source: { kind: "directory", path: "/project" } });
});

test("teardown aborts an active callback and removes its registrations", async () => {
  const hooks = new PluginHookHandlers(() => {});
  hooks.before("workspace.create", async (_input, context) => {
    await new Promise<void>((_resolve, reject) => {
      context.signal.addEventListener(
        "abort",
        () => {
          reject(new Error("Hook aborted"));
        },
        { once: true },
      );
    });
  });
  const invocation = hooks.invoke(
    "operation",
    "before",
    "workspace.create",
    {
      source: { kind: "directory", path: "/project" },
    },
    paseo,
  );
  hooks.close();
  await expect(invocation).rejects.toThrow("Hook aborted");
  expect(hooks.catalog()).toEqual({ events: [], before: [] });
});

test("session-open hooks reject changes to session identity instead of silently ignoring them", async () => {
  const hooks = new PluginHookHandlers(() => {});
  hooks.before("agent.session_open", ({ request }) => {
    return { ...request, provider: "another-provider" };
  });
  await expect(
    hooks.invoke(
      "operation",
      "before",
      "agent.session_open",
      {
        agentId: "agent",
        workspaceId: "workspace",
        provider: "claude",
        cwd: "/project",
        reason: "resume",
        purpose: "interactive",
        env: {},
      },
      paseo,
    ),
  ).rejects.toThrow("agent.session_open hooks can only change env");
});

const GATEWAY_REQUEST = {
  backend: "cluster",
  agentId: "agent",
  sessionId: "session",
  workspaceId: null,
  url: "https://mcp.example/mcp",
  headers: {},
};

test("mcp_gateway.upstream hooks can set upstream headers and the backend URL", async () => {
  const hooks = new PluginHookHandlers(() => {});
  hooks.before("mcp_gateway.upstream", ({ request }) => {
    return {
      ...request,
      headers: { ...request.headers, Authorization: `Bearer for-${request.agentId}` },
    };
  });
  hooks.before("mcp_gateway.upstream", ({ request }) => {
    return { ...request, url: "http://127.0.0.1:9000/mcp" };
  });
  expect(
    await hooks.invoke("operation", "before", "mcp_gateway.upstream", GATEWAY_REQUEST, paseo),
  ).toEqual({
    ...GATEWAY_REQUEST,
    url: "http://127.0.0.1:9000/mcp",
    headers: { Authorization: "Bearer for-agent" },
  });
});

test.each([
  ["agentId", { agentId: "another-agent" }],
  ["backend", { backend: "another-backend" }],
  ["sessionId", { sessionId: "another-session" }],
  ["workspaceId", { workspaceId: "workspace" }],
])("mcp_gateway.upstream hooks cannot change the caller's %s", async (_field, change) => {
  const hooks = new PluginHookHandlers(() => {});
  hooks.before("mcp_gateway.upstream", ({ request }) => ({ ...request, ...change }));
  await expect(
    hooks.invoke("operation", "before", "mcp_gateway.upstream", GATEWAY_REQUEST, paseo),
  ).rejects.toThrow("mcp_gateway.upstream hooks can only change url and headers");
});

test("mcp_gateway.upstream hooks must return an http or https backend URL", async () => {
  const hooks = new PluginHookHandlers(() => {});
  hooks.before("mcp_gateway.upstream", ({ request }) => ({
    ...request,
    url: "file:///etc/passwd",
  }));
  await expect(
    hooks.invoke("operation", "before", "mcp_gateway.upstream", GATEWAY_REQUEST, paseo),
  ).rejects.toThrow();
});
