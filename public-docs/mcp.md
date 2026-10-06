---
title: MCP reference
description: Reference for the Paseo tools agents use to manage agents, workspaces, scripts, terminals, and schedules.
nav: MCP reference
order: 34
category: Orchestration
---

# MCP reference

[Enable Paseo tools](/docs/orchestration#get-started) to give agents this catalog. Ask for an outcome in natural language, or use the tool interfaces below.

## Configuration

| Setting                            | Default | Purpose                                                                                                             |
| ---------------------------------- | ------- | ------------------------------------------------------------------------------------------------------------------- |
| `daemon.mcp.enabled`               | `true`  | Run the MCP server.                                                                                                 |
| `daemon.mcp.injectIntoAgents`      | `false` | Give agents launched by Paseo access to its tools.                                                                  |
| `daemon.mcp.gateway.backends`      | `{}`    | Name the MCP servers agents reach through the daemon. [Gateway](#reach-mcp-backends-through-the-daemon)             |
| `daemon.mcp.gateway.modelBackends` | `{}`    | Send a provider's model traffic through a gateway backend. [Model traffic](#send-model-traffic-through-the-gateway) |

Depending on the provider, Paseo delivers tools through its native tool interface or MCP. The capabilities are the same. Start a new agent or reload an existing one after changing injection settings.

## Limit Paseo tools by provider

Use provider policies when different agent profiles should receive different Paseo tools. Enable
tool injection globally, then add `paseoTools` to the exact provider IDs you launch:

```json
{
  "$schema": "https://paseo.sh/schemas/paseo.config.v1.json",
  "version": 1,
  "daemon": {
    "mcp": {
      "enabled": true,
      "injectIntoAgents": true
    }
  },
  "agents": {
    "providers": {
      "codex-lead": {
        "extends": "codex",
        "label": "Codex Lead"
      },
      "codex-worker": {
        "extends": "codex",
        "label": "Codex Worker",
        "paseoTools": {
          "disabledTools": ["create_agent", "send_agent_prompt", "kill_agent"]
        }
      },
      "codex-isolated": {
        "extends": "codex",
        "label": "Codex Isolated",
        "paseoTools": {
          "enabled": false
        }
      }
    }
  }
}
```

Run `paseo reload` after editing `~/.paseo/config.json`, then start a new agent or reload an
existing one. A running session keeps the catalog it received at launch.

Omitting `paseoTools` enables the complete catalog. Set `enabled` to `false` to remove the catalog,
or list exact tool IDs in `disabledTools` to remove selected tools. Custom profiles do not inherit
this policy from `extends`; configure each custom provider ID separately.

Browser tools still require browser tools to be enabled and a connected browser host. The
voice-only `speak` tool is separate from this policy.

This setting limits the catalog presented to an agent. It is not a security boundary for an agent
that can access the host through a shell.

## Reach MCP backends through the daemon

The daemon can proxy an agent's MCP traffic to a named backend and tell the backend which agent is
calling. Name the backends in `config.json`, or replace the whole set with the
`PASEO_MCP_GATEWAY_BACKENDS` environment variable (a JSON object of the same shape). Each URL is a
complete `http://` or `https://` URL with a valid host and no credentials or fragment. A host is
an IPv4 address, a bracketed IPv6 address, or a DNS name whose labels hold only letters, digits and
single hyphens between them, with a final label that starts with a letter. DNS names exclude
underscores, internationalised (`xn--`) labels, trailing dots and consecutive hyphens:

```json
{
  "daemon": {
    "mcp": {
      "gateway": {
        "backends": {
          "cluster": "https://mcp.internal.example/mcp",
          "models": { "url": "https://models.internal.example", "responseTimeoutMs": 600000 }
        }
      }
    }
  }
}
```

A backend is its URL, or an object with `url` and `responseTimeoutMs`: how long the gateway waits
for the backend's response headers, from 1 to 3,600,000 milliseconds (default 30,000). Raise it for
backends that answer slowly before their first byte, such as non-streaming model calls. Once
headers arrive, the response streams with no limit.

Point an agent's MCP server at the gateway with two placeholders the daemon fills at launch:

```json
"mcpServers": {
  "cluster": {
    "type": "http",
    "url": "{paseoMcpGatewayUrl}/cluster",
    "headers": { "Authorization": "Bearer {paseoAgentToken}" }
  }
}
```

`{paseoMcpGatewayUrl}` is the daemon's loopback `/mcp/backends` URL and `{paseoAgentToken}` is the
launching agent's own token. Agent records on disk keep these placeholders, never the resolved
values. The gateway forwards every method except the CORS preflight: the daemon answers `OPTIONS`
through its CORS handling before the gateway authenticates anything. It forwards the path below the
backend name, query, body and MCP session headers, and streams responses (including SSE) without
buffering. Each path segment below the backend name must be a plain segment once fully
percent-decoded: no dot segments, separators, `?` or `#`, control or format characters, or URL
schemes (`400` otherwise). It drops the
agent's `Authorization` and every `X-Paseo-*` header, then sets:

| Header                 | Value                                            |
| ---------------------- | ------------------------------------------------ |
| `X-Paseo-Agent-ID`     | The agent the token was issued to                |
| `X-Paseo-Session-ID`   | The agent's provider session ID, once it has one |
| `X-Paseo-Workspace-ID` | The agent's workspace, when it has one           |
| `X-Paseo-Server-ID`    | This daemon's server ID                          |

Paseo holds no backend credential. A plugin supplies one per request through the
[`mcp_gateway.upstream` hook](/docs/plugins/reference#before-hooks); without one the request goes
upstream with no `Authorization`. Unknown backend names get `404`, a missing or unknown token gets
`401`, an unreachable backend gets `502`, and a backend that sends no response headers within its
`responseTimeoutMs` gets `504`. Backend responses, including errors, pass through unchanged.

## Send model traffic through the gateway

An agent can run with no model credential of its own: its harness calls the daemon's gateway with
the agent's token, and a plugin's [`mcp_gateway.upstream` hook](/docs/plugins/reference#before-hooks)
attaches the credential the backend needs. Name the backend for each provider ID in
`daemon.mcp.gateway.modelBackends`, or replace the whole map with the
`PASEO_MCP_GATEWAY_MODEL_BACKENDS` environment variable (a JSON object of the same shape):

```json
{
  "daemon": {
    "mcp": {
      "gateway": {
        "backends": {
          "anthropic": { "url": "https://models.internal.example", "responseTimeoutMs": 600000 },
          "openai": { "url": "https://models.internal.example/v1", "responseTimeoutMs": 600000 }
        },
        "modelBackends": { "claude": "anthropic", "codex": "openai" }
      }
    }
  }
}
```

Keys are provider IDs, including custom providers that extend `claude` or `codex`. Each agent of a
named provider launches against `<daemon>/mcp/backends/<backend>` with its own token:

| Provider    | Launch                                                                                                                                         |
| ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| Claude Code | `ANTHROPIC_BASE_URL` is the gateway URL and `ANTHROPIC_AUTH_TOKEN` the agent's token, sent as `Authorization: Bearer`.                         |
| Codex       | A `responses` model provider whose `base_url` is the gateway URL and whose `env_key` is `PASEO_MODEL_GATEWAY_TOKEN`, set to the agent's token. |

Before setting these, Paseo removes every model-provider variable from the agent's environment,
whichever provider it runs: `ANTHROPIC_API_KEY`, `ANTHROPIC_AUTH_TOKEN`, `ANTHROPIC_BASE_URL`,
`CLAUDE_CODE_OAUTH_TOKEN`, `OPENAI_API_KEY`, `OPENAI_BASE_URL` and `CODEX_API_KEY`. Of the model
variables, the agent's environment then holds only its own gateway values.

Codex appends its API paths to `base_url`, so a Codex backend URL usually ends in `/v1`; Claude Code
adds `/v1/...` itself. The provider uses HTTP and SSE; Codex WebSockets stay off. These values
override runtime settings and `agent.session_open` hook values, and reach the provider only at
launch: agent records never hold them, and the token is revoked when the agent closes. A launch
fails when the provider cannot use the gateway (providers other than Claude Code and Codex) or the
daemon does not listen on TCP.

## Mental model

Workspaces decide where work happens; agent parentage decides who owns the work.

- An agent that calls `create_agent` without a `workspaceId` gets a subagent in its own workspace.
- Passing a `workspaceId` places that subagent in another workspace without detaching it from its parent.
- A top-level MCP caller without a workspace gets a new local workspace.
- Create a workspace first when you need worktree isolation, a specific branch, or a pull request checkout.

MCP does not expose an agent-detach tool. Detaching is a manual user action in the app or CLI.

## Tools

### Agents

| Tool                 | Function                                                                                |
| -------------------- | --------------------------------------------------------------------------------------- |
| `create_agent`       | Create an agent, optionally placing it in an existing workspace with `workspaceId`.     |
| `send_agent_prompt`  | Send a prompt to an existing agent using its `agentId` and a `prompt`.                  |
| `get_agent_status`   | Return the latest snapshot for an agent.                                                |
| `list_agents`        | List recent agents as compact metadata.                                                 |
| `cancel_agent`       | Abort an agent's current run but keep the agent alive.                                  |
| `archive_agent`      | Soft-delete an agent and remove it from the active list.                                |
| `kill_agent`         | Terminate an agent session permanently.                                                 |
| `update_agent`       | Update an agent name, labels, or runtime settings such as mode/model/thinking/features. |
| `get_agent_activity` | Return recent agent timeline entries as a curated summary.                              |
| `set_agent_mode`     | Switch an agent's session mode.                                                         |

### Workspaces

| Tool                | Function                                                                                              |
| ------------------- | ----------------------------------------------------------------------------------------------------- |
| `create_workspace`  | Create a local or worktree-isolated workspace. Worktrees can branch off, check out a branch, or a PR. |
| `list_workspaces`   | List active workspaces and their directories and isolation.                                           |
| `rename_workspace`  | Change the user-visible name of the current or specified workspace.                                   |
| `archive_workspace` | Archive a workspace and the sessions it owns.                                                         |

For worktree isolation, `create_workspace` accepts the same useful choices as the app: branch off from a base, check out an existing branch, or check out a pull request. The worktree remains an implementation detail of the workspace lifecycle.

### Workspace scripts

These tools manage scripts configured in a workspace's `paseo.json`. Each requires an explicit `workspaceId`; start and stop also require the configured `scriptName`.

| Tool                     | Function                                                                                |
| ------------------------ | --------------------------------------------------------------------------------------- |
| `list_workspace_scripts` | List configured scripts with lifecycle, terminal, port, proxy URL, and health metadata. |
| `start_workspace_script` | Start a configured script through Paseo's managed launcher.                             |
| `stop_workspace_script`  | Stop a running script through its supervised terminal.                                  |

See [Git worktrees](/docs/worktrees#scripts-and-services) for `paseo.json` configuration.

### Terminals

| Tool                 | Function                                                                     |
| -------------------- | ---------------------------------------------------------------------------- |
| `list_terminals`     | List terminal sessions for one working directory or all working directories. |
| `create_terminal`    | Create a terminal session for a working directory.                           |
| `kill_terminal`      | Kill a terminal session.                                                     |
| `capture_terminal`   | Capture plain-text output from a terminal session.                           |
| `send_terminal_keys` | Send text or special key tokens to a terminal session.                       |

### Schedules and heartbeats

Both use the same cron engine, but they have deliberately different interfaces.

| Tool                | Function                                                                     |
| ------------------- | ---------------------------------------------------------------------------- |
| `create_schedule`   | Create a cron schedule that starts a new agent for each run.                 |
| `list_schedules`    | List new-agent schedules managed by the daemon.                              |
| `inspect_schedule`  | Inspect a schedule and its run history.                                      |
| `pause_schedule`    | Pause an active schedule.                                                    |
| `resume_schedule`   | Resume a paused schedule.                                                    |
| `update_schedule`   | Change a schedule's cron, prompt, agent settings, limits, or other settings. |
| `schedule_logs`     | Return recent runs and output for a schedule.                                |
| `run_schedule_once` | Start one new-agent schedule run without changing its cron.                  |
| `delete_schedule`   | Delete a new-agent schedule permanently.                                     |
| `create_heartbeat`  | Send a recurring cron-backed prompt into the current agent.                  |
| `delete_heartbeat`  | Delete one of the current agent's heartbeats.                                |

MCP heartbeats are ephemeral: create or delete them. To change one, delete it and create a replacement. Pause, resume, update, inspect, logs, and run-once apply to new-agent schedules only.

### Agent profiles

| Tool            | Function                                                                                                                           |
| --------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `list_profiles` | Return the host's saved agent profiles, including their notes and launch settings. Returns an empty list when none are configured. |

Before delegating, read each profile's `notes` and choose the profile the user named or the one that fits the task. See [Agent profiles](/docs/agent-profiles) for setup and example notes.

`create_agent` has no profile parameter and requires a `provider/model` pair. If the profile has no model, call `list_models` for its provider and choose an available model for the task before launching. Apply the chosen profile's values to the launch request:

| Profile field                   | `create_agent` field                                                        |
| ------------------------------- | --------------------------------------------------------------------------- |
| `provider` and optional `model` | `provider` as `provider/model`, using the saved or discovered model ID      |
| `modeId`                        | `settings.modeId`                                                           |
| `thinkingOptionId`              | `settings.thinkingOptionId`                                                 |
| `featureValues`                 | `settings.features`                                                         |
| `notes`                         | Selection guidance for the orchestrator; supply the task in `initialPrompt` |

Omit absent optional settings. If no profile fits, use provider discovery to choose available settings.

### Providers

| Tool               | Function                                                          |
| ------------------ | ----------------------------------------------------------------- |
| `list_providers`   | List configured agent providers, availability, and modes.         |
| `list_models`      | List models for an agent provider.                                |
| `inspect_provider` | Inspect compact provider capabilities and draft feature settings. |

### Permissions

| Tool                       | Function                                          |
| -------------------------- | ------------------------------------------------- |
| `list_pending_permissions` | Return pending permission requests across agents. |
| `respond_to_permission`    | Approve or deny a pending permission request.     |

### Browser

Browser automation is opt-in and adds tools for opening tabs, reading pages, clicking, typing, and taking screenshots. See the [Browser tools reference](/docs/browser-tools).

### Voice

| Tool    | Function                                                                                  |
| ------- | ----------------------------------------------------------------------------------------- |
| `speak` | Speak text through daemon-managed voice output. Available only in voice-enabled sessions. |
