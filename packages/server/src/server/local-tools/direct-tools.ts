import type { PaseoToolCatalog, PaseoToolDefinition } from "../agent/tools/types.js";

/**
 * The tools every harness offers its model directly, outside a script, while the tool tree is on
 * (infra-v2 I-000029, D-000417 item 3): one set for every harness, declared here and nowhere else. Every other
 * tool, and every gateway backend's, reaches the agent only through its tool tree. Today the set is Paseo's own
 * tools; narrowing it (for example to the local tools, or to `exec` alone) is a change to this list.
 */
export const HARNESS_DIRECT_TOOLS: readonly string[] = [
  "apply_patch",
  "archive_agent",
  "archive_workspace",
  "cancel_agent",
  "capture_terminal",
  "create_agent",
  "create_heartbeat",
  "create_schedule",
  "create_terminal",
  "create_workspace",
  "delete_heartbeat",
  "delete_schedule",
  "exec",
  "find_files",
  "get_agent_activity",
  "get_agent_status",
  "git_commit",
  "git_diff",
  "git_log",
  "git_push",
  "git_status",
  "inspect_provider",
  "inspect_schedule",
  "kill_agent",
  "kill_terminal",
  "list_agents",
  "list_dir",
  "list_models",
  "list_pending_permissions",
  "list_profiles",
  "list_providers",
  "list_schedules",
  "list_terminals",
  "list_workspace_scripts",
  "list_workspaces",
  "pause_schedule",
  "process_kill",
  "process_list",
  "process_read",
  "process_spawn",
  "process_write",
  "read_file",
  "rename_workspace",
  "respond_to_permission",
  "resume_schedule",
  "run_schedule_once",
  "schedule_logs",
  "search",
  "send_agent_prompt",
  "send_terminal_keys",
  "set_agent_mode",
  "start_workspace_script",
  "stop_workspace_script",
  "update_agent",
  "update_schedule",
  "write_file",
];

/** Where a harness that speaks MCP finds its direct tools: the agent endpoint's route plus this. */
export const DIRECT_TOOLS_ROUTE_SUFFIX = "/direct";

/** The namespace a harness that takes Paseo's tools natively gives them (Codex reserves `mcp__*`). */
export const DIRECT_TOOLS_NAMESPACE = "paseo";

const DIRECT = new Set(HARNESS_DIRECT_TOOLS);

/** The catalogue's tools that are in the direct set; any other name is unknown to it. */
export function directToolCatalog(catalog: PaseoToolCatalog): PaseoToolCatalog {
  const tools = new Map<string, PaseoToolDefinition>(
    [...catalog.tools].filter(([name]) => DIRECT.has(name)),
  );
  return {
    tools,
    getTool: (name) => tools.get(name),
    executeTool: async (name, input, context) => {
      if (!tools.has(name)) {
        throw new Error(
          `${name} is not one of the tools offered directly; call it through the tool tree`,
        );
      }
      return catalog.executeTool(name, input, context);
    },
  };
}
