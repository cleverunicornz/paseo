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

| Setting                              | Default | Purpose                                                                                                                          |
| ------------------------------------ | ------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `daemon.mcp.enabled`                 | `true`  | Run the MCP server.                                                                                                              |
| `daemon.mcp.injectIntoAgents`        | `false` | Give agents launched by Paseo access to its tools.                                                                               |
| `daemon.mcp.gateway.backends`        | `{}`    | Name the MCP servers agents reach through the daemon. [Gateway](#reach-mcp-backends-through-the-daemon)                          |
| `daemon.mcp.gateway.modelBackends`   | `{}`    | Send a provider's model traffic through a gateway backend. [Model traffic](#send-model-traffic-through-the-gateway)              |
| `daemon.mcp.gateway.envPassthrough`  | `[]`    | Trusted variables a gateway-enabled harness inherits beyond the base set. [Harness environment](#the-harness-environment)        |
| `daemon.mcp.localTools.codexPath`    | unset   | Serve the local tools (commands, files, patches, processes, search, git) through a Codex app server. [Local tools](#local-tools) |
| `daemon.mcp.toolTree.enabled`        | `false` | Give each agent its tools as TypeScript files it can call from code. [Tool tree](#tool-tree)                                     |
| `agents.providers.<id>.builtinTools` | `on`    | `off` launches the harness without its own built-in tools. [Built-in tools](#harness-built-in-tools)                             |

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
| `X-Paseo-Member`       | In session mode, the session's member            |
| `X-Paseo-Role`         | In session mode, the session's role              |

Session mode is described in [one member per session](/docs/session-containers#one-member-per-session).
Outside it the gateway sends neither `X-Paseo-Member` nor `X-Paseo-Role`. In session mode an agent
stopped for running another member gets `403` with the refusal.

Paseo holds no backend credential. A plugin supplies one per request through the
[`mcp_gateway.upstream` hook](/docs/plugins/reference#before-hooks); without one the request goes
upstream with no `Authorization`. A plugin can call a backend for an agent with
[`server.mcp.callTool()`](/docs/plugins/reference#gateway-calls); that call takes this same path,
hooks and headers, and the plugin never holds the agent's token. Unknown backend names get `404`, a missing or unknown token gets
`401`, an unreachable backend gets `502`, and a backend that sends no response headers within its
`responseTimeoutMs` gets `504`. Backend responses, including errors, pass through unchanged.

## Send model traffic through the gateway

The gateway keeps three kinds of credential apart:

| Credential           | Held by                                                                                                |
| -------------------- | ------------------------------------------------------------------------------------------------------ |
| Provider credentials | The model proxy only (the subscription logins)                                                         |
| The proxy client key | The daemon; a plugin's [`mcp_gateway.upstream` hook](/docs/plugins/reference#before-hooks) attaches it |
| The per-agent token  | The agent; valid only at its own daemon                                                                |

Name the backend for each provider ID in `daemon.mcp.gateway.modelBackends`, or replace the whole
map with the `PASEO_MCP_GATEWAY_MODEL_BACKENDS` environment variable (a JSON object of the same
shape):

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
named provider launches against `<daemon>/mcp/backends/<backend>` with its per-agent token:

| Provider    | Launch                                                                                                                                           |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| Claude Code | `ANTHROPIC_BASE_URL` is the gateway URL and `ANTHROPIC_AUTH_TOKEN` the per-agent token, sent as `Authorization: Bearer`.                         |
| Codex       | A `responses` model provider whose `base_url` is the gateway URL and whose `env_key` is `PASEO_MODEL_GATEWAY_TOKEN`, set to the per-agent token. |

### The harness environment

Every process Paseo's Claude Code or Codex provider starts from a named provider's binary gets this environment: agent sessions, draft sessions, availability and version probes, the diagnostic's `which` and login-shell lookups and `claude auth status` check, and the Codex app-servers that list models, list importable sessions and archive threads. None of them inherits anything from the daemon's environment except the documented base variables. Launch values and configured pass-through are trusted configuration, passed as given apart from the refused names. Provider credentials are never inherited, and the per-agent token is valid only at the agent's own daemon.

An agent session's environment consists of:

- the base variables, from the daemon's environment and the provider's runtime settings: `PATH`,
  `HOME`, `USER`, `LOGNAME`, `SHELL`, `LANG`, `LC_*`, `TERM`, `TZ`, `TMPDIR`, and on Windows
  `SYSTEMROOT`, `WINDIR`, `COMSPEC`, `PATHEXT`, `USERPROFILE`, `APPDATA`, `LOCALAPPDATA`, `TEMP` and
  `TMP`;
- the configured pass-through, from the same sources;
- launch values: `PASEO_AGENT_ID`, `PASEO_AGENT_CWD`, and `env` from the create request and
  `agent.create`/`agent.session_open` hooks;
- `NO_PROXY` and `no_proxy`, set to `127.0.0.1`, `localhost`, `::1` and the gateway host;
- its gateway values from the table above.

A probe, a listing or archive app-server, or a draft session (the daemon listing a provider's
commands or features before an agent exists) gets only the base variables and the configured
pass-through. Providers not named in `modelBackends` inherit the daemon's environment as before.

General command runners keep the daemon's environment, even when the command they run is `claude`
or `codex`: worktree setup and teardown scripts, terminals and terminal profiles, and plugin
callback processes. To keep credentials away from them too, keep the credentials out of the
daemon's environment. Store them as files that your hooks read per request; the
`mcp_gateway.upstream` hook can read the proxy client key that way.

Refused names never pass, from any source, in any case: names starting with `ANTHROPIC_`,
`OPENAI_`, `AWS_`, `AZURE_`, `GOOGLE_`, `GCLOUD_`, `CLOUDSDK_`, `CLOUD_ML_`, `VERTEX_`,
`CLAUDE_CODE_USE_`, `CLAUDE_CODE_SKIP_`, `CLAUDE_CODE_OAUTH_`, `CLAUDE_CODE_API_KEY` or
`CLAUDE_CODE_CLIENT_`, `CODEX_API_KEY`, and any name ending in `_PROXY`. Everything else in the
daemon's environment or runtime settings is dropped. Claude Code also receives the variables the
Claude Agent SDK sets for its own child, and a launch through the daemon's own executable adds
`ELECTRON_RUN_AS_NODE`.

Launch values and the pass-through list are trusted configuration: the operator, plugins and the
agent's creator set them, not the agent. Name what a deployment needs, such as tool configuration,
in `daemon.mcp.gateway.envPassthrough`, or replace the list with
`PASEO_MCP_GATEWAY_ENV_PASSTHROUGH` (a JSON array). Entries are variable names or prefixes ending
in `*`:

```json
{
  "daemon": { "mcp": { "gateway": { "envPassthrough": ["IS_SANDBOX", "MYTOOL_*"] } } }
}
```

The daemon refuses to start with an entry that names, or as a prefix could match, a refused name,
a prefix entry holding `_PROXY`, or a loader, Node-runtime, TLS-trust or harness
configuration-location variable: `LD_*`, `DYLD_*`, `NODE_OPTIONS`, `NODE_EXTRA_CA_CERTS`,
`SSL_CERT_FILE`, `SSL_CERT_DIR`, `CLAUDE_CONFIG_DIR` and `CODEX_HOME`. A deployment that needs one of
these supplies it as a launch value. A name ending in `_PROXY` is dropped even when a broader prefix
entry such as `TOOL_*` matches it.

Codex appends its API paths to `base_url`, so a Codex backend URL usually ends in `/v1`; Claude Code
adds `/v1/...` itself. The provider uses HTTP and SSE; Codex WebSockets stay off. The gateway values
reach the provider only at launch: agent records never hold them, and the per-agent token is revoked
when the agent closes. A launch fails when the provider cannot use the gateway (providers other
than Claude Code and Codex) or the daemon does not listen on TCP.

## Local tools

Paseo can serve the tools an agent needs to work in its workspace: running commands, reading and
writing files, applying patches, running long-lived processes, searching, and git. The daemon runs
one Codex app server as their executor, with no model and no login. Name the Codex executable to
turn them on:

```json
{ "daemon": { "mcp": { "localTools": { "codexPath": "/usr/local/bin/codex" } } } }
```

`PASEO_LOCAL_TOOLS_CODEX_PATH` replaces `codexPath`. The executor starts on the first call, starts
again on the next call after it exits, and uses its own Codex home: `$PASEO_HOME/local-tools/codex-home`
unless `codexHome` names another absolute path. Paseo is tested with Codex 0.159.2.

A local tool acts in the calling agent's workspace (its working directory) and needs the agent's
own token. Paths are relative to the workspace. A path that leaves it, directly or through a
symlink, is refused. `apply_patch` reads a patch as the Codex executor does, padded headers and a
heredoc wrapper included, and checks every file it adds, updates, deletes or moves to; one path
outside the workspace refuses the whole patch. Outputs are bounded and end on a whole UTF-8
character: `exec` keeps 64 KiB per stream unless `maxOutputBytes` asks for up to 1 MiB, `read_file`
returns up to 256 KiB, and `list_dir` up to 2,000 entries.

Commands get the environment of a gateway-enabled harness (the base variables plus
`daemon.mcp.gateway.envPassthrough`) and run without Codex's own sandbox, as the daemon's user. An
`exec` or `process_spawn` run also gets these variables, so code the agent runs calls Paseo's tools
as that agent:

| Variable                | Value                                     |
| ----------------------- | ----------------------------------------- |
| `PASEO_AGENT_TOKEN`     | The calling agent's token.                |
| `PASEO_MCP_URL`         | The daemon's `/mcp/agents` URL.           |
| `PASEO_MCP_GATEWAY_URL` | The gateway's `/mcp/backends` URL.        |
| `PASEO_TOOL_TREE`       | The agent's tool tree, when trees are on. |
| `PASEO_AGENT_ID`        | The calling agent's ID.                   |

The values travel with that run's request to the executor. Paseo writes none of them to a file.

## Tool tree

With `daemon.mcp.toolTree.enabled`, Paseo writes each agent a directory with one TypeScript file per
tool the agent is shown: `servers/paseo/` for Paseo's tools and `servers/<backend>/` for each gateway
backend's (backends named in `modelBackends` carry model traffic and are left out). Each file exports
a typed function, and `client.ts` calls the tool through Paseo with the run variables above. The
harness gets the directory as `PASEO_TOOL_TREE`: `$PASEO_HOME/tool-trees/<agentId>` unless `dir`
names another parent. Paseo writes the whole tree, Paseo's tools and every backend's, before the
harness starts, so the agent's first listing shows every tool. When a backend cannot be listed then,
the launch fails with an error naming the backend. Paseo checks the tree again whenever the agent
lists its tools, rewriting it only when the list changed; a backend that does not answer at that
point is left out until the next check.

File and function names come from tool names: a character other than a letter, digit or `_`
becomes `_`, and a file name compares without case. When two tools would share a file or an
exported name, or a tool is named `index` (each server's `index.ts` re-exports all of its tools),
the tool later in name order gets `_2`, `_3`, and so on; a tool whose name needs no change is
placed first. `README.md` lists every file with its function and tool. A schema Paseo cannot type
precisely, such as a `$ref` outside the schema, becomes `unknown`.

An agent lists the directory, reads the files it needs, and runs a script with `exec`:

```ts
import { readFile } from "/home/me/.paseo/tool-trees/<agentId>/servers/paseo/read_file.ts";

const pkg = await readFile({ path: "package.json" });
console.log(JSON.parse(pkg.content).version);
```

Run it with `node --experimental-strip-types script.ts` or `bun script.ts`.

## Harness built-in tools

Set `builtinTools` to `off` on a provider to launch its harness with Paseo's tools only. Pair it with
[local tools](#local-tools) so the agent can still run commands and edit files.

| Harness     | Launch                                                                                                                                       |
| ----------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| Claude Code | `--tools ""` (no built-in tool) and `--strict-mcp-config` (only the MCP servers Paseo passes).                                               |
| Codex       | `--disable shell_tool --disable unified_exec`. Codex registers `apply_patch` per model and has no switch for it, so that one built-in stays. |

```json
{
  "agents": {
    "providers": { "claude": { "builtinTools": "off" }, "codex": { "builtinTools": "off" } }
  }
}
```

The switch turns off Codex's built-in tools, not what Codex loads from its home. Codex still reads
MCP servers from `[mcp_servers]` in `$CODEX_HOME/config.toml`, instructions from
`$CODEX_HOME/AGENTS.md`, and skills from `$CODEX_HOME/skills` and `~/.agents/skills`, plus the
system-wide config and skills in `/etc/codex`. Paseo changes none of these. For an agent with
Paseo's tools only, the image that runs Codex provides a `CODEX_HOME` (default `~/.codex`), a home
directory and an `/etc/codex` with none of them. The workspace's own `AGENTS.md` and `.agents/skills`
still apply.

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

### Local

Available when [local tools](#local-tools) are on.

| Tool            | Function                                                                         |
| --------------- | -------------------------------------------------------------------------------- |
| `exec`          | Run a command (argv) in the workspace and return its exit code and output.       |
| `read_file`     | Read a file, optionally a range of lines; binary files come back base64-encoded. |
| `write_file`    | Create or replace a file, creating missing directories.                          |
| `list_dir`      | List a directory's entries.                                                      |
| `apply_patch`   | Apply a patch in Codex's `apply_patch` format.                                   |
| `process_spawn` | Start a long-running process.                                                    |
| `process_write` | Write to a process's stdin, or close it.                                         |
| `process_read`  | Return a process's new output, waiting for some if asked.                        |
| `process_kill`  | Stop a process.                                                                  |
| `process_list`  | List the caller's processes.                                                     |
| `search`        | Search file contents with ripgrep.                                               |
| `find_files`    | Fuzzy-find files by name.                                                        |
| `git_status`    | Working tree status.                                                             |
| `git_diff`      | Unstaged, staged, or ref changes.                                                |
| `git_log`       | Recent commits.                                                                  |
| `git_commit`    | Commit given paths, every tracked change, or what is staged.                     |
| `git_push`      | Push a branch.                                                                   |

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
