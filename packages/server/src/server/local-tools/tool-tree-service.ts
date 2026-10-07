import { rm } from "node:fs/promises";
import path from "node:path";
import type { Logger } from "pino";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

import { withTimeout } from "../../utils/promise-timeout.js";
import {
  PASEO_TOOL_TREE_SERVER,
  writeToolTree,
  type JsonSchema,
  type ToolTreeServer,
  type ToolTreeTool,
} from "./tool-tree.js";

const BACKEND_LIST_TIMEOUT_MS = 15_000;
const AGENT_ID_PATTERN = /^[A-Za-z0-9_-]+$/;

export interface ToolTreeServiceOptions {
  /** Parent directory of the per-agent trees. */
  rootDir: string;
  /** The Paseo tools the agent's own catalogue renders. */
  listPaseoTools: (agentId: string) => Promise<ToolTreeTool[]>;
  /** The MCP backends the agent reaches through the gateway. */
  listBackendNames: () => string[];
  getGatewayBaseUrl: () => string | null;
  issueAgentToken: (agentId: string) => string;
  logger: Logger;
}

interface RefreshState {
  running: Promise<void>;
  again: boolean;
}

/**
 * Keeps each agent's tool tree equal to the tools it is rendered: Paseo's own
 * catalogue for that agent plus every MCP backend's list as the agent sees it
 * through the gateway. A refresh rewrites the tree only when that changed.
 */
export class ToolTreeService {
  private readonly refreshes = new Map<string, RefreshState>();

  constructor(private readonly options: ToolTreeServiceOptions) {}

  dirFor(agentId: string): string {
    if (!AGENT_ID_PATTERN.test(agentId)) {
      throw new Error(`Unexpected agent id for a tool tree: ${agentId}`);
    }
    return path.join(this.options.rootDir, agentId);
  }

  /** Regenerates the agent's tree; overlapping requests coalesce into one more pass. */
  refresh(agentId: string): Promise<void> {
    const current = this.refreshes.get(agentId);
    if (current) {
      current.again = true;
      return current.running;
    }
    const state: RefreshState = { running: Promise.resolve(), again: false };
    state.running = (async () => {
      try {
        do {
          state.again = false;
          await this.writeTree(agentId);
        } while (state.again);
      } finally {
        this.refreshes.delete(agentId);
      }
    })();
    this.refreshes.set(agentId, state);
    return state.running;
  }

  /** Fire-and-forget `refresh` for request paths; failures are logged. */
  scheduleRefresh(agentId: string): void {
    void this.refresh(agentId).catch((error: unknown) => {
      this.options.logger.warn({ err: error, agentId }, "Failed to refresh the agent's tool tree");
    });
  }

  async remove(agentId: string): Promise<void> {
    await this.refreshes.get(agentId)?.running.catch(() => undefined);
    await rm(this.dirFor(agentId), { recursive: true, force: true });
  }

  private async writeTree(agentId: string): Promise<void> {
    const servers: ToolTreeServer[] = [
      { name: PASEO_TOOL_TREE_SERVER, tools: await this.options.listPaseoTools(agentId) },
    ];
    for (const backend of this.options.listBackendNames()) {
      if (backend === PASEO_TOOL_TREE_SERVER) continue;
      try {
        servers.push({ name: backend, tools: await this.listBackendTools(agentId, backend) });
      } catch (error) {
        // A backend that does not answer now is left out until the next refresh.
        this.options.logger.warn(
          { err: error, agentId, backend },
          "Could not list an MCP backend's tools for the tool tree",
        );
      }
    }
    const { written } = await writeToolTree(this.dirFor(agentId), servers);
    if (written) {
      this.options.logger.debug({ agentId }, "Tool tree written");
    }
  }

  private async listBackendTools(agentId: string, backend: string): Promise<ToolTreeTool[]> {
    const base = this.options.getGatewayBaseUrl();
    if (!base) {
      throw new Error("The MCP gateway is not listening on TCP");
    }
    const client = new Client({ name: "paseo-tool-tree", version: "1.0.0" });
    const transport = new StreamableHTTPClientTransport(
      new URL(`${base.replace(/\/+$/, "")}/${encodeURIComponent(backend)}`),
      {
        requestInit: {
          headers: { Authorization: `Bearer ${this.options.issueAgentToken(agentId)}` },
        },
      },
    );
    const list = async (): Promise<ToolTreeTool[]> => {
      await client.connect(transport);
      const tools: ToolTreeTool[] = [];
      let cursor: string | undefined;
      do {
        const page = await client.listTools(cursor ? { cursor } : undefined);
        for (const tool of page.tools) {
          tools.push({
            name: tool.name,
            description: tool.description,
            inputSchema: tool.inputSchema as JsonSchema,
            ...(tool.outputSchema ? { outputSchema: tool.outputSchema as JsonSchema } : {}),
          });
        }
        cursor = page.nextCursor;
      } while (cursor);
      return tools;
    };
    try {
      return await withTimeout(list(), BACKEND_LIST_TIMEOUT_MS, `Listing ${backend} timed out`);
    } finally {
      await client.close().catch(() => undefined);
    }
  }
}
