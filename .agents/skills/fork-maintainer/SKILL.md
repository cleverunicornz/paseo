---
name: fork-maintainer
description: Maintain cleverunicornz/paseo against getpaseo/paseo. Use for every scheduled or manual upstream synchronization, fork compatibility fix, or upstream stable-release mirror.
user-invocable: true
---

# Fork maintainer

You are the maintainer of `cleverunicornz/paseo`. Complete routine upstream maintenance without human involvement. Work through a pull request, prove the maintained fork contract, and merge when the result has one clear correct interpretation.

GitHub workflows are manually dispatched execution tools. They do not decide scope, create pull requests, merge, release, or invoke other workflows. Never add an automatic `push`, `pull_request`, `merge_group`, `workflow_run`, `schedule`, or tag trigger to an enabled workflow in this fork.

## Fixed repository facts

- Fork: `cleverunicornz/paseo`
- Upstream: `getpaseo/paseo`
- Fork default branch: `main`
- Upstream branch tracked daily: `main`
- Stable-release tracking baseline: `v0.4.0`. Do not backfill it.
- Beta and other prerelease upstream releases never trigger a fork release.
- One upstream-maintenance pull request may be open at a time.
- Never push directly to `main`, force-push, amend a pushed commit, or rewrite shared history.

## Maintained fork contract

Every synchronization preserves these facts:

1. `yeet-code` remains a first-class provider in protocol configuration, the provider manifest, icons, the server registry, snapshots, and persisted configuration.
2. Paseo connects to Yeet Code through the remote ACP v2 HTTP/SSE client.
3. Gateway owns upstream-provider credentials, provider routing, execution, sessions, transcripts, and tools. Paseo receives only the Gateway endpoint and its client bearer.
4. The remote ACP v2 implementation does not replace or modify Paseo's process-backed ACP v1 providers.
5. Session creation, rich prompts, tools, reasoning, usage, cancellation, listing, resume/replay, and close remain supported.
6. Desktop release artifacts target `cleverunicornz/paseo`, may build from an explicit checkout ref, and retain the configured signing fallback.
7. No public website, Nix, Docker, Android, app deployment, or relay deployment is operated by this fork unless a human changes this contract.

The current fork-owned implementation is concentrated in:

- `packages/server/src/server/agent/providers/remote-acp-v2-agent.ts`
- `packages/server/src/server/agent/providers/yeet-code-agent.ts`
- `packages/server/src/server/agent/provider-registry.ts`
- `packages/server/src/server/persisted-config.ts`
- `packages/protocol/src/provider-config.ts`
- `packages/protocol/src/provider-icon-names.ts`
- `packages/protocol/src/provider-manifest.ts`
- `packages/app/src/components/provider-icons.ts`
- their focused tests, package metadata, lockfile, and provider documentation
- `.github/workflows/desktop-release.yml`

Treat direct path overlap as evidence to inspect, not an automatic blocker. Also inspect semantic overlap in provider lifecycle, agent management, prompts, sessions, ACP, protocol schemas, package dependencies, and desktop packaging.

## One daily cycle

### 1. Establish clean state

Use an isolated worktree. Fetch `origin` and `upstream`. Read the current fork `main`, upstream `main`, open maintenance pull requests, upstream checks, upstream releases, and fork releases.

If a maintenance pull request is already open, resume and finish it. Do not create a competing pull request.

If upstream `main` is already an ancestor of fork `main`, there is no source sync. Continue only if a new eligible upstream stable release needs handling.

### 2. Verify upstream provenance and assurance

Resolve an exact upstream SHA. Require completed green upstream checks for that SHA before running its code on a self-hosted runner. Record the upstream check-run URLs in the pull request.

Upstream assurance is authoritative for unchanged upstream behavior. Do not repeat upstream's Playwright, Windows, macOS, desktop, or broad package matrix.

If required upstream checks are pending, wait once within the current run. If they fail or remain incomplete, stop without creating compatibility changes and report the upstream blocker.

### 3. Inspect the incoming change

Review every upstream commit since the last integrated upstream SHA. Produce:

- upstream base and target SHAs;
- commit subjects;
- changed paths;
- direct overlap with fork-owned paths;
- semantic overlap with the maintained fork contract;
- added or renamed GitHub workflow files;
- the newest non-draft, non-prerelease upstream release.

Do not infer test scope from filenames alone. Read the changed implementation and its callers.

### 4. Merge and preserve ancestry

Create or reuse `sync/upstream-<short-sha>` from fork `main`. Merge the exact upstream SHA with a normal merge commit. Never squash upstream history.

Resolve routine conflicts when the fork's intended behavior remains clear. Put compatibility fixes in ordinary follow-up commits. Do not hide conflict resolution inside the upstream merge commit.

### 5. Choose assurance

Run only evidence that exercises the intersection between incoming upstream changes and the maintained fork contract.

The default fork contract is available through `.github/workflows/fork-maintenance.yml`:

```bash
gh workflow run fork-maintenance.yml \
  --repo cleverunicornz/paseo \
  --ref <branch> \
  -f ref=<exact-branch-or-sha> \
  -f task=fork-contract
```

Other manual tasks are `provider-tests`, `typecheck`, and `server-build`. Use the narrowest task that proves the change. Use `fork-contract` when upstream touches provider lifecycle, ACP, agent/session behavior, protocol/provider configuration, dependencies, or more than one fork-owned package.

Default daily native and browser work is zero:

- no Playwright;
- no Windows;
- no macOS;
- no desktop packaging;
- no deployment;
- no release.

A future fork change may justify one targeted browser or native check. Add or invoke only the check that observes that fork behavior.

Never rerun a failed SHA without reading the complete failure. Retry the same SHA once only when the evidence proves an external transient. Deterministic failures require a fix first.

### 6. Pull request, review, and merge

Open one pull request into fork `main`. The body records:

- previous and target upstream SHAs;
- upstream assurance URLs;
- changed-path and semantic overlap;
- conflict resolutions and compatibility fixes;
- fork-contract evidence with exact SHA and run URL;
- release decision;
- workflow-file review;
- resulting fork delta.

Review the complete candidate diff as maintainer. Merge the pull request with a normal merge commit and delete the branch when:

- upstream provenance and checks are sound;
- the maintained fork contract is preserved;
- required focused assurance is green;
- no strategic decision is present;
- no unreviewed workflow can become active.

Routine upstream synchronization does not wait for a human.

### 7. Clean up and report

Remove temporary worktrees and branches. Report the upstream SHA, pull request, merge SHA, checks invoked, fixes made, release result, and any remaining blocker.

## Human escalation

Stop with an unmerged pull request and a concrete decision memo when upstream:

- adopts ACP v2 in a way that overlaps or supersedes the fork's remote ACP v2 layer;
- adds an equivalent Yeet Code or Gateway provider;
- changes credential, provider, execution, session, transcript, or tool ownership across the Gateway boundary;
- makes deletion or material redesign of the fork plausible;
- forces a choice between new upstream behavior and the maintained fork contract;
- changes authentication, release-channel, supported-platform, or signing policy;
- presents multiple materially different correct resolutions;
- introduces a workflow that could execute automatically in this fork and cannot be disabled safely before merge.

Routine renames, dependency updates, lockfile reconciliation, obvious API adaptation, formatting, type fixes, and behavior-preserving test updates are not escalation conditions.

The escalation memo states the upstream change, the affected fork invariant, viable choices, consequences, and recommended human decision. Do not merge or release while that decision is open.

## Stable upstream release

Check releases before integrating later upstream commits. A release is eligible only when upstream marks it `draft: false` and `prerelease: false`, its tag is newer than the `v0.4.0` baseline, and the fork has not already published the corresponding release.

When no eligible stable release exists, never build or publish artifacts.

When one exists:

1. Resolve the exact upstream release tag and commit.
2. Construct a fork release candidate containing that exact upstream release tree plus the maintained fork delta. Do not include later unreleased upstream commits. If fork `main` has moved past the release commit, use a dedicated release branch from the exact upstream tag and apply the maintained fork changes there.
3. Prove the fork contract on the exact release candidate.
4. Preserve the established fork version, channel, and prerelease convention. Escalate rather than inventing a new convention.
5. Manually dispatch `desktop-release.yml` with the exact tag and checkout ref. Build Linux, macOS, and Windows because the fork artifacts contain code absent from upstream binaries.
6. Use the workflow's packaged-app smoke and artifacts as release evidence. Do not rerun upstream's native test matrix.
7. Manually dispatch `release-notes-sync.yml` when release notes need synchronization.
8. Verify every expected artifact and release URL before reporting the release complete.

Do not invoke the upstream `release-beta` or `release-stable` skills, npm publication flow, website deployment, or tag-driven automation as part of fork mirroring.

## Workflow controls

Enabled workflows are manually dispatched tools only. The intended enabled set is:

- `.github/workflows/fork-maintenance.yml`
- `.github/workflows/desktop-release.yml`
- `.github/workflows/desktop-rollout.yml`
- `.github/workflows/release-notes-sync.yml`

All upstream CI, deploy, Docker, Nix, Android, and update workflows remain disabled in the fork's Actions settings. Existing disabled workflows may retain upstream triggers because they are inert and kept close to upstream. Treat a newly added or renamed upstream workflow as a pre-merge review item.

`github-actions[bot]` is never an approved self-hosted-runner actor. A workflow never creates or dispatches another workflow.
