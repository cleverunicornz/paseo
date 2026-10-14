# Heap soak harness

The H1 soak for P-000269: a four-hour leaking-load qualification on a throwaway daemon of the
built package, plus the analyzer that judges it. Ported from the advisor's executable harness
(`/state/handoff/paseo-leak-advisor.md` section 3). The fixture and load are fixed by P-000269 H1
and must not drift.

- `soak.mjs` — the load driver. Writes one JSON record per line to stdout.
- `worker.mjs` — the daemon under test. Separate process, own `/tmp` home, OS-assigned loopback
  port, a 768 MiB old-space bound. It never touches a real home or a fixed port.
- `fake-agent-client.mjs` — deterministic agent provider, transpiled from the repository's own
  `packages/server/src/server/test-utils/fake-agent-client.ts`. Regenerate it after that source
  changes (see below).
- `analyze.mjs` — reads a run's JSONL and prints, and exits non-zero on failure of, the H1
  numbers.
- `analyze.test.mjs` — unit tests for `analyze.mjs` on small synthetic series.

No model runs: `worker.mjs` feeds synthetic stream events straight into the real Claude
`TimelineAssembler` and disables the SDK query path.

## Stage the package under test

`soak.mjs` and `worker.mjs` load the daemon from `PASEO_DIAGNOSTIC_MODULES`, an isolated module
directory holding all seven `@getpaseo` workspace packages built from **one commit**. Never point
it at a checkout's own `node_modules` and never at an installed package directory you do not own.

```sh
# 1. Build the seven packages in a checkout of the commit under test.
git worktree add --detach /tmp/soak-src <commit-sha>
cd /tmp/soak-src
npm ci
npm run build:server            # builds protocol, relay, client, highlight, plugin, server, cli

# 2. Assemble an isolated module directory. Symlinks are enough; a copy works too.
mkdir -p /tmp/soak-modules/node_modules/@getpaseo
for p in protocol client highlight plugin relay server cli; do
  ln -sfn /tmp/soak-src/packages/$p /tmp/soak-modules/node_modules/@getpaseo/$p
done
# ws and pino are the two runtime dependencies these scripts require directly.
for m in ws pino; do ln -sfn /tmp/soak-src/node_modules/$m /tmp/soak-modules/node_modules/$m; done
```

Node must support `--expose-gc` (24.x is what the advisor's evidence used; 24.16.0 here).

## Run

```sh
export PASEO_DIAGNOSTIC_MODULES=/tmp/soak-modules/node_modules

# A fixed run: 4 h of load, 5 min rest, default reads over the 8 idle agents.
node scripts/heap-soak/soak.mjs \
  --seconds 14400 --rest-seconds 300 --message-seconds 1800 --connections-per-minute 27 \
  --label "<commit + package set>" > run.jsonl 2> run.err

# The second fixed run: reads spread uniformly over all 15 agents.
node scripts/heap-soak/soak.mjs \
  --seconds 14400 --rest-seconds 300 --message-seconds 1800 --connections-per-minute 27 \
  --read-streaming-agents > run-uniform.jsonl 2> run-uniform.err

# The control: the same fixture and load on the unfixed build.
node scripts/heap-soak/soak.mjs \
  --seconds 14400 --rest-seconds 300 --message-seconds 1800 --connections-per-minute 27 \
  --control > run-control.jsonl 2> run-control.err
```

To survive a Paseo worker restart that may interrupt the driving agent, start each run detached
with its own files, then read the files when it finishes:

```sh
setsid nohup node scripts/heap-soak/soak.mjs ... > run.jsonl 2> run.err < /dev/null &
```

## Judge

```sh
node scripts/heap-soak/analyze.mjs run.jsonl            # fixed run: exit 0 pass, 1 fail, 2 inconclusive
node scripts/heap-soak/analyze.mjs --control run-control.jsonl
node --test scripts/heap-soak/analyze.test.mjs
```

`analyze.mjs` computes P-000269 H1's numbers: the baseline; the max sample minus baseline
(≤ 64 MiB); the last-hour least-squares slope (< 16 MiB/h); the post-rest sample against the last
load sample; RPC errors and worker deaths; the calls per minute and the 15/9/2/1 mix per minute
with every off-protocol minute listed; and the streaming-agent count. For `--control` it reports
whether the run rose more than 500 MB above its own baseline or reached the worker's heap bound
within the 4 hours. A protocol break (an off-protocol minute, fewer than 7 streaming agents, a
missing sample, a run cut short) exits 2 — inconclusive — because the run does not qualify a
release.

## Diagnostics only

`--boundary-copy` reattaches each emitted streaming suffix to a fresh string, reproducing the
advisor's control. It is an experiment, not a production source patch, and must never be used for
a release-qualification run.

## Regenerate `fake-agent-client.mjs`

It is transpiled from the repository's own test utility, so it stays faithful to the provider the
daemon tests use:

```sh
node_modules/.bin/esbuild packages/server/src/server/test-utils/fake-agent-client.ts \
  --bundle=false --format=esm --platform=node --target=node24 --outfile=/tmp/fake.mjs
# Then replace the one bare import so it resolves through PASEO_DIAGNOSTIC_MODULES:
#   import { isLikelyExternalToolName } from "@getpaseo/protocol/tool-name-normalization";
# becomes
#   const { isLikelyExternalToolName } = await import(
#     (process.env.PASEO_DIAGNOSTIC_MODULES || "/opt/gh-runners/node-global/lib/node_modules")
#     + "/@getpaseo/protocol/dist/tool-name-normalization.js");
```
