---
title: Session containers
description: Run one agent per daemon, ask whether stopping now would lose anything, and stop without losing timeline items.
nav: Session containers
order: 8
category: Getting started
---

# Session containers

A session container runs one daemon for one agent. A controller outside it, such as a dashboard, starts the container, opens its web UI, and stops it when the session ends. This page covers what the daemon offers that controller:

- single-agent mode;
- one member per session;
- a stop-readiness answer and a begin-stopping call;
- a shutdown that waits for timeline recorders.

The settings are in [Configuration](/docs/configuration#session-containers).

## One agent per daemon

With `daemon.singleAgent` set to `true` (or `PASEO_SINGLE_AGENT=true`), the daemon holds at most one live agent:

- Creating, importing or resuming a second agent is refused with an error naming the live agent. The same holds for an agent's `create_agent` tool and a schedule that creates an agent.
- Forking is refused, and the daemon stops advertising it.
- Reloading or resuming the one agent works as usual. Archiving it makes room for the next.
- Once the host has its live agent, the web UI drops the fork menu, the workspace's "New agent" action, the tab launcher's agent entry, the command center's new-agent command and the new-agent shortcuts. When every host the UI knows is such a host, the sidebar's "Add project" and "Import session" go too.

## One member per session

A session runs as one member, the provider and model written `<provider>/<model>` such as `codex/gpt-6-astra`, and under one role. The controller that creates the container chooses both and passes them in `CVU_MEMBER` and `CVU_ROLE`. Setting `CVU_MEMBER`, even to an empty value, starts session mode:

- **Checked at startup.** `CVU_MEMBER` must match `^([a-z0-9-]+/)?[a-z0-9]([a-z0-9.-]*[a-z0-9])?$` within 128 characters, and `CVU_ROLE` must be `orchestrator`, `scout`, `implementer`, `validator` or `advisor`. Otherwise the daemon refuses to start. An empty `CVU_MEMBER` is a container whose creator did not set one.
- **Nothing starts for another member.** Every provider client sits behind one check, so no provider session or runtime starts unless it runs the member: creating, importing, resuming or reloading an agent, internal agents such as the branch-name generator, and switching a running agent's model are refused otherwise. An import is checked against the model the native session recorded. The agent's value is lowercased first (`GPT-6-Astra` matches `gpt-6-astra`) and otherwise compared as given: `claude-opus-5-5[1m]` is not `claude-opus-5-5`. An agent created without a model gets the provider's default model, which must be the member too. The refusal names the member and says a different model needs a new session.
- **Refused before anything changes.** A refused reload, model switch, create or resume leaves the agent, its running turn and its timeline as they were.
- **Discovery stays with the member.** Other providers show as unavailable and their catalogues, commands, features and importable sessions come back empty, without starting them.
- **A runtime that reports another model is stopped.** If a running agent's harness reports a model other than the member, for example after a `/model` command typed into it, the daemon ends its turn, closes it with the refusal as its error, and the MCP gateway answers its requests with `403`.
- **The MCP gateway sends both** as `X-Paseo-Member` and `X-Paseo-Role` on every request, whichever agent calls. See [the MCP gateway](/docs/mcp).

Without `CVU_MEMBER` the daemon sends neither header and launches any model. `CVU_ROLE` alone changes nothing.

## Ask whether stopping would lose anything

```http
GET /api/stop-readiness
```

```json
{
  "ready": false,
  "timeline": {
    "ready": true,
    "epoch": "6d9c…",
    "emitted_through": 412,
    "acknowledged_through": 412
  },
  "wip": { "ready": false, "reason": "WIP commit not pushed yet" }
}
```

- **Where the parts come from.** A plugin provides `timeline` and `wip` through a [stop-readiness provider](/docs/plugins/reference#stop-readiness).
- **`ready`** is `timeline.ready && wip.ready`. The daemon computes it; a provider cannot claim it.
- **No provider.** Both parts are `ready: false` with reason `no provider`. With a provider in more than one plugin the reason is `multiple providers`; when the provider fails, `provider failed`.
- **Unacknowledged items.** While any plugin has a timeline item it has not acknowledged, `timeline` is not ready, with reason `N timeline items not acknowledged`. This counts items still in flight and items whose handler threw. Its `epoch`, `emitted_through` and `acknowledged_through` then come from the daemon's own record of the most recently active agent and epoch. Each poll offers items that failed at least 2 seconds before to their plugin again, so a recorder that recovered catches up, and the timeline turns ready once those offers are acknowledged.
- **No credential.** An answer whose `ref` is not a plain ref name or whose `sha` is not a full commit id is refused as `invalid provider answer`. User information in a URL inside a `reason` is replaced with `[redacted]`.

## Begin stopping

```http
POST /api/begin-stopping
```

The daemon answers `202 {"stopping": true}` and from then on:

1. It refuses new agents and new turns.
2. It cancels the turns that are running.
3. It calls the provider's `stop` and `drain` together, for example to commit and push work in progress.

Poll `GET /api/stop-readiness` until it is ready, then stop the container. Repeating the request while that work runs starts nothing new. There is no way back short of a restart.

Both endpoints sit behind the same Host allowlist and daemon password as the rest of `/api`. With `PASEO_PASSWORD` set, send `Authorization: Bearer <password>`.

## Stop without losing timeline items

Shutdown first asks every agent's provider to close its session, so closed agents add no more timeline items. A close that fails, or does not finish within 5 seconds, leaves that agent running: it can still add items.

Then, within one deadline, `daemon.shutdown.timelineDrainMs` (default 300000 ms), the daemon:

1. offers once more every `agent.timeline_item` whose handler threw;
2. waits for the provider's `drain`;
3. waits until no `agent.timeline_item` delivery to any plugin is unacknowledged. Items delivered while it waits, such as those of an agent left running, are waited for too.

Only then, or at the deadline, does the daemon stop plugins. Until then a plugin can still send what it holds through
[`server.mcp.callTool()`](/docs/plugins/reference#gateway-calls) on behalf of the agents this
shutdown closed, with their identity, for example when its backend came back during the drain.

When something is left unfinished:

- The daemon logs `Timeline drain failed` with the plugin, agent, epoch and every unacknowledged `seq`, with the plugin whose `drain` did not finish, or with the agent left running and why its close did not finish (`rejected` or `deadline`). An agent left running fails the drain even when every item was acknowledged, because it could add items after the drain.
- The worker exits with status **75** instead of 0. The supervisor, and the Docker image's entrypoint, pass that status through.

The supervisor waits for the drain plus the rest of the teardown before it forces the worker down. Give the container's stop timeout the same room, for example `docker stop -t 330` or `stop_grace_period: 330s`. Otherwise the container runtime kills the daemon first.
