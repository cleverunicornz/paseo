import type {
  AgentPermissionRequest,
  AgentPermissionResponse,
  AgentTimelineItem,
  AgentSessionConfig,
} from "@getpaseo/protocol/agent-types";
import type { PaseoApi } from "@getpaseo/client";
import type { WorkspaceCreateRequest } from "@getpaseo/protocol/messages";

export interface PluginHookContext {
  paseo: PaseoApi;
  signal: AbortSignal;
}

export interface PluginHookWorkspace {
  id: string;
  projectId: string;
  cwd: string;
  name: string | null;
  archivedAt: string | null;
}

export interface PluginHookAgent {
  id: string;
  workspaceId: string | null;
  parentAgentId: string | null;
  provider: string;
  cwd: string;
  title: string | null;
}

/** The agent a timeline item belongs to, with the identity a recorder needs. */
export interface PluginTimelineItemAgent extends PluginHookAgent {
  /** The provider's own session id (Claude session, Codex thread), once known. */
  sessionId: string | null;
  labels: Record<string, string>;
  model: string | null;
}

/**
 * One timeline row as the daemon streams it to its clients: after assistant
 * and reasoning chunks are coalesced, once per row, in `seq` order. The agent
 * never waits for a handler. A delivery is acknowledged when every handler for
 * it resolved; one that throws leaves it unacknowledged until the daemon offers
 * the same event again (on stop-readiness polls and at the shutdown drain).
 * Shutdown waits for unacknowledged deliveries up to its drain deadline. A consumer that misses
 * rows catches up from the agent's timeline by `seq` within `epoch`.
 */
export interface PluginTimelineItemEvent {
  agent: PluginTimelineItemAgent;
  item: AgentTimelineItem;
  seq: number;
  epoch: string;
  timestamp: string;
  turnId: string | null;
}

export interface PluginSessionOpenRequest {
  agentId: string;
  workspaceId: string | null;
  provider: string;
  cwd: string;
  reason: "create" | "resume" | "refresh" | "import";
  purpose: "interactive" | "history";
  env: Record<string, string>;
}

/**
 * One request an agent sends through the daemon's MCP gateway
 * (`/mcp/backends/<backend>`). The identity fields come from the agent's
 * daemon-issued token and cannot be changed. `url` is the configured backend
 * URL, or `null` when the daemon config does not name `backend`; a hook may
 * set it to serve a backend of its own. `headers` are added to the upstream
 * request, e.g. an `Authorization` credential; Paseo sets the `X-Paseo-*`
 * identity headers itself.
 */
export interface PluginMcpGatewayUpstreamRequest {
  backend: string;
  agentId: string;
  sessionId: string | null;
  workspaceId: string | null;
  url: string | null;
  headers: Record<string, string>;
}

export type PluginTurnOutcome =
  | { kind: "completed" }
  | { kind: "failed"; error: { message: string; code?: string } }
  | { kind: "canceled"; reason: string };

export interface PluginLifecycleEvents {
  "agent.turn_started": { agent: PluginHookAgent; turnId: string | null };
  "agent.turn_ended": {
    agent: PluginHookAgent;
    turnId: string | null;
    outcome: PluginTurnOutcome;
    timeline: readonly AgentTimelineItem[];
  };
  "agent.permission_requested": { agent: PluginHookAgent; request: AgentPermissionRequest };
  "agent.permission_resolved": {
    agent: PluginHookAgent;
    requestId: string;
    resolution: AgentPermissionResponse;
  };
  "agent.archived": { agent: PluginHookAgent; archivedAt: string };
  "agent.created": { agent: PluginHookAgent };
  "agent.timeline_item": PluginTimelineItemEvent;
  "workspace.created": { workspace: PluginHookWorkspace };
  "workspace.archived": { workspace: PluginHookWorkspace };
}

export interface PluginBeforeRequests {
  "agent.create": { config: AgentSessionConfig; env?: Record<string, string> };
  "agent.session_open": PluginSessionOpenRequest;
  "workspace.create": Omit<WorkspaceCreateRequest, "type" | "requestId">;
  "mcp_gateway.upstream": PluginMcpGatewayUpstreamRequest;
}

export interface PluginLifecycleRegistration {
  on<Name extends keyof PluginLifecycleEvents>(
    name: Name,
    handler: (
      event: PluginLifecycleEvents[Name],
      context: PluginHookContext,
    ) => void | Promise<void>,
  ): () => void;
  before<Name extends keyof PluginBeforeRequests>(
    name: Name,
    handler: (
      input: { request: PluginBeforeRequests[Name] },
      context: PluginHookContext,
    ) => PluginBeforeRequests[Name] | void | Promise<PluginBeforeRequests[Name] | void>,
  ): () => void;
}
