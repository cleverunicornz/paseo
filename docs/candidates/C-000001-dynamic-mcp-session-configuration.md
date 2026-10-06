# C-000001 — Dynamic MCP configuration for existing agent sessions

## State

Proposed. Recording possible responses only; no implementation is assigned.

## Evidence

A maintainer relay on 2026-10-04 reports two independently reproduced limits:

- Codex 0.159.2 rejects a thread when a per-agent HTTP MCP server uses the
  same name as a stdio server in the user configuration, with
  `url is not supported for stdio`.
- `reloadAgentSession` cannot apply new per-agent MCP overrides to an
  existing agent.

These are reported observations, not fresh qualification in this record.
The interim uses a distinct `-http` name for Codex and quiet stdio adapters.

## Possible responses

1. Allow a Codex thread to disable a named MCP server inherited from the
   user configuration before applying its per-agent HTTP server.
2. Allow reload/resume to rerun `agent.session_open` and apply per-agent
   overrides at a safe point without cancelling a running turn.

## Qualification needed

Before selection, demonstrate behavior with Codex 0.159.2 and persisted
sessions, including inherited-server collision, reload/resume and an active
turn. Judge preservation of existing tools, authoritative agent identity,
stored templates and running work. No response is selected by this record.
