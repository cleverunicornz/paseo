import path from "node:path";
import type { Logger } from "pino";

import { serializePaseoToolInputParameters } from "../agent/tools/paseo-tool-serialization.js";
import type { PaseoToolCatalog } from "../agent/tools/types.js";
import type { ManagedProcessRegistry } from "../managed-processes/managed-processes.js";
import { CodexExecutor, buildExecutorEnv } from "./codex-executor.js";
import type { LocalToolsConfig, ToolTreeConfig } from "./config.js";
import { LocalProcessRegistry } from "./local-processes.js";
import type { LocalToolsHost } from "./local-tools.js";
import type { JsonSchema, ToolTreeTool } from "./tool-tree.js";
import { ToolTreeService } from "./tool-tree-service.js";

export interface LocalToolsRuntimeOptions {
  paseoHome: string;
  localTools: LocalToolsConfig | null | undefined;
  toolTree: ToolTreeConfig | undefined;
  /** The harness pass-through list; the executor's commands get the harness allowlist. */
  envPassthrough: readonly string[] | undefined;
  /** The gateway's backends; those serving model traffic are not MCP servers and stay out of trees. */
  gatewayBackends: Readonly<Record<string, unknown>> | undefined;
  modelBackends: Readonly<Record<string, string>> | undefined;
  managedProcesses?: ManagedProcessRegistry;
  logger: Logger;
  issueAgentToken: (agentId: string) => string;
  getAgentMcpUrl: () => string | null;
  getGatewayBaseUrl: () => string | null;
  /** The agent's own Paseo tool catalogue, as its MCP endpoint renders it. */
  createAgentCatalog: (agentId: string) => Promise<PaseoToolCatalog>;
}

export interface LocalToolsRuntime {
  /** Present when the local tools are on. */
  host: LocalToolsHost | null;
  /**
   * Writes the agent's whole tree, Paseo's tools and every gateway backend's,
   * before its harness launches and returns where it is; null when trees are
   * off. Rejects when the tree cannot be completed: the launch fails.
   */
  prepareToolTree: (agentId: string) => Promise<string | null>;
  /** An agent changed: a closed agent's tree is removed. */
  onAgentState: (agent: { id: string; lifecycle: string }) => void;
  /** The agent listed its tools: its tree follows what it was shown. */
  onToolsListed: (agentId: string) => void;
  close: () => Promise<void>;
}

export function toToolTreeTools(catalog: PaseoToolCatalog): ToolTreeTool[] {
  const tools: ToolTreeTool[] = [];
  for (const tool of catalog.tools.values()) {
    const entry: ToolTreeTool = {
      name: tool.name,
      description: tool.description,
      inputSchema: serializePaseoToolInputParameters(tool) as JsonSchema,
    };
    if (tool.outputSchema) {
      // The serializer renders a tool's input schema; give it the output schema in that place.
      entry.outputSchema = serializePaseoToolInputParameters({
        ...tool,
        inputSchema: tool.outputSchema,
      }) as JsonSchema;
    }
    tools.push(entry);
  }
  return tools;
}

export function createLocalToolsRuntime(options: LocalToolsRuntimeOptions): LocalToolsRuntime {
  const logger = options.logger.child({ module: "local-tools" });
  const modelBackendNames = new Set(Object.values(options.modelBackends ?? {}));
  const mcpBackendNames = Object.keys(options.gatewayBackends ?? {}).filter(
    (name) => !modelBackendNames.has(name),
  );
  const toolTree = options.toolTree?.enabled
    ? new ToolTreeService({
        rootDir: options.toolTree.dir ?? path.join(options.paseoHome, "tool-trees"),
        listPaseoTools: async (agentId) =>
          toToolTreeTools(await options.createAgentCatalog(agentId)),
        listBackendNames: () => mcpBackendNames,
        getGatewayBaseUrl: options.getGatewayBaseUrl,
        issueAgentToken: options.issueAgentToken,
        logger,
      })
    : null;
  const executor = options.localTools
    ? new CodexExecutor({
        codexPath: options.localTools.codexPath,
        codexHome:
          options.localTools.codexHome ?? path.join(options.paseoHome, "local-tools", "codex-home"),
        env: buildExecutorEnv({ envPassthrough: options.envPassthrough ?? [] }),
        logger,
        managedProcesses: options.managedProcesses,
      })
    : null;
  const processes = executor ? new LocalProcessRegistry(executor) : null;
  /** Agents with a tree on disk. */
  const treeAgents = new Set<string>();

  function resolveToolTreeDir(agentId: string): string | null {
    return toolTree ? toolTree.dirFor(agentId) : null;
  }

  function resolveRunEnv(agentId: string): Record<string, string> {
    const env: Record<string, string> = {
      PASEO_AGENT_ID: agentId,
      PASEO_AGENT_TOKEN: options.issueAgentToken(agentId),
    };
    const mcpUrl = options.getAgentMcpUrl();
    if (mcpUrl) env.PASEO_MCP_URL = mcpUrl;
    const gatewayUrl = options.getGatewayBaseUrl();
    if (gatewayUrl) env.PASEO_MCP_GATEWAY_URL = gatewayUrl;
    const tree = resolveToolTreeDir(agentId);
    if (tree) env.PASEO_TOOL_TREE = tree;
    return env;
  }

  return {
    host:
      executor && processes && options.localTools
        ? {
            executor,
            codexPath: options.localTools.codexPath,
            processes,
            resolveRunEnv,
            resolveToolTreeDir,
          }
        : null,
    async prepareToolTree(agentId) {
      if (!toolTree) return null;
      treeAgents.add(agentId);
      try {
        await toolTree.refresh(agentId, { strict: true });
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        throw new Error(`Could not write the tool tree for agent ${agentId}: ${reason}`, {
          cause: error,
        });
      }
      return toolTree.dirFor(agentId);
    },
    onAgentState(agent) {
      if (agent.lifecycle === "closed") {
        void processes?.releaseAgent(agent.id);
        if (toolTree && treeAgents.delete(agent.id)) {
          void toolTree.remove(agent.id).catch((error: unknown) => {
            logger.warn({ err: error, agentId: agent.id }, "Failed to remove a tool tree");
          });
        }
      }
    },
    onToolsListed(agentId) {
      toolTree?.scheduleRefresh(agentId);
    },
    async close() {
      await executor?.close();
    },
  };
}
