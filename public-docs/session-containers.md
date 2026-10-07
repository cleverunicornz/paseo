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
- a stop-readiness answer and a begin-stopping call;
- a shutdown that waits for timeline recorders.

The settings are in [Configuration](/docs/configuration#session-containers).

## One agent per daemon

With `daemon.singleAgent` set to `true` (or `PASEO_SINGLE_AGENT=true`), the daemon holds at most one live agent:

- Creating, importing or resuming a second agent is refused with an error naming the live agent. The same holds for an agent's `create_agent` tool and a schedule that creates an agent.
- Forking is refused, and the daemon stops advertising it.
- Reloading or resuming the one agent works as usual. Archiving it makes room for the next.
- The web UI drops the fork menu and the new-agent actions once the host has its live agent.

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
- **In-flight items.** While the daemon has timeline items in flight to the provider's plugin, `timeline` is not ready.
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

Shutdown first closes every agent. Plugins keep running until both of these finish, or until `daemon.shutdown.timelineDrainMs` (default 300000 ms) passes:

- every `agent.timeline_item` delivery still in flight;
- the provider's `drain`.

Only then does the daemon stop plugins.

When something is left unfinished:

- The daemon logs `Timeline drain failed` with the plugin, agent, epoch and the highest unacknowledged `seq`, or with the plugin whose `drain` did not finish.
- The worker exits with status **75** instead of 0. The supervisor, and the Docker image's entrypoint, pass that status through.

The supervisor waits for the drain plus the rest of the teardown before it forces the worker down. Give the container's stop timeout the same room, for example `docker stop -t 330` or `stop_grace_period: 330s`. Otherwise the container runtime kills the daemon first.
