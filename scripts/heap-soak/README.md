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
(a sample at `heap_size_limit`, or a timed worker exit whose stderr shows the V8 heap-limit abort)
within the 4 hours, and judges the control's record only up to that leak point.

A run qualifies only on a complete, consistent record. A protocol break (an off-protocol minute,
fewer than 7 streaming agents, a missing sample, a run cut short) exits 2, inconclusive. So does
anything absent, duplicated or contradictory: every field the analyzer reads is checked against
another record of the same run, within the tolerance below. `--control` judges only a run recorded
with `--control`.

The driver writes two clocks on its records. `time` is the wall clock when the line is logged.
`elapsed` is seconds since the load started, from the same `Date.now()`; the load starts as the
baseline is logged. A record's offset, `time − baseline.time − elapsed`, is how long after the
moment it records the line was written. Every lower bound of 0 below allows 0.5 s of clock jitter.
An unparseable line is inconclusive.

| Record      | Field                                                       | Read for                                                | Checked against (else inconclusive)                                                                                                                                                                |
| ----------- | ----------------------------------------------------------- | ------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| baseline    | `time`                                                      | the clock's origin                                      | required; every other record's offset is measured from it                                                                                                                                          |
| baseline    | `label`, `control`, `readStreaming`, `boundaryCopy`         | run identity                                            | label present; `control` equals `--control`; reads idle agents (`false`) for a control; `boundaryCopy` is `false`                                                                                  |
| baseline    | `protocol.*`, `fixture.*`                                   | the protocol                                            | equal to P-000269 H1 (4 h, 300 s rest, 27/min in 15/9/2/1, 1800 s messages, 15/7/8 agents, 10,900 rows of 2048 B, 13 clients, 2 subscribed, 7 streaming)                                           |
| baseline    | `baseline.memory.heapUsed`                                  | the baseline                                            | present                                                                                                                                                                                            |
| baseline    | `baseline.agents` (total, running, idle, rows)              | fixture seeded before load                              | 15, 7, 8 and at least 10,900 rows                                                                                                                                                                  |
| baseline    | `heapSizeLimitBytes`                                        | the control's heap bound                                | present                                                                                                                                                                                            |
| sample      | `elapsed`                                                   | its 30 s slot                                           | one sample per slot, within 2 s after it, every slot due in the window; none after load-end; none after 14,400 s in a full run                                                                     |
| sample      | `time`                                                      | —                                                       | offset 0 to 30 s (its stream, call and forced GC)                                                                                                                                                  |
| sample      | `memory.heapUsed`                                           | bound, slope, leak                                      | present                                                                                                                                                                                            |
| sample      | `agents.byLifecycle.running`                                | 7 streaming agents                                      | equals 7                                                                                                                                                                                           |
| sample      | `calls`, `byKind`                                           | the call mix                                            | counts; `byKind` sums to `calls`; between the minute buckets before its minute and through it; never decreasing                                                                                    |
| sample      | `minutes`                                                   | —                                                       | equals the index of the bucket holding its last call                                                                                                                                               |
| sample      | `streamChunks`                                              | delivered streaming                                     | exactly `7 × floor(elapsed / 1800 × 2048)`, at most that after a stream error; never decreasing                                                                                                    |
| sample      | `rpcErrors`, `streamErrors`, `workerDeaths`, `errorsByKind` | errors and deaths                                       | each equals the events logged by its `time` (rpc-error events, those of kind `stream`, those of each kind, worker exits other than the harness's stop)                                             |
| minute      | `index`, `elapsedStart`, `elapsedEnd`                       | per-minute rate and mix                                 | integer 0–240, unique, no hole; start at `index × 60` (±2 s); each ends where the next starts; every whole minute ends at `(index + 1) × 60` (±2 s); the last ends exactly at load-end's `elapsed` |
| minute      | `calls`, `byKind`                                           | per-minute rate and mix                                 | sum to each other; 27 in 15/9/2/1 for every whole minute in the window; their totals equal the samples' and end records' counts                                                                    |
| minute      | `time`                                                      | —                                                       | offset 0 to 30 s; the last bucket (closed at load end) within 0.5 s                                                                                                                                |
| rpc-error   | `elapsed`                                                   | dispatch moment: before or after a control's leak point | offset at least 0 (logged at or after dispatch)                                                                                                                                                    |
| rpc-error   | `time`, `kind`                                              | which counters must count it                            | counted by every later record's counters                                                                                                                                                           |
| rpc-error   | `time`                                                      | a control's excused failure                             | excused only if logged at or after a heap-limit worker-exit and after the last good sample, and dispatched no earlier than that sample; the message is never read                                  |
| worker-exit | `elapsed`, `time`                                           | the death's moment                                      | offset within 0.5 s                                                                                                                                                                                |
| worker-exit | `oom`, `reason`                                             | heap-limit abort                                        | `reason` shows the V8 heap-limit banner and `oom` is not `false`; any other death up to the leak point is inconclusive                                                                             |
| worker-exit | `stopping`                                                  | the harness's own stop                                  | not before the run's end                                                                                                                                                                           |
| load-end    | `elapsed`                                                   | end of load                                             | within 2 s of 14,400 s for a full run; no sample or leak evidence after it                                                                                                                         |
| load-end    | `time`                                                      | start of the rest                                       | offset 0 to the run's slowest periodic sample + 0.5 s (its forced GC)                                                                                                                              |
| load-end    | `memory.heapUsed`                                           | last load point (slope, post-rest)                      | present for a full run                                                                                                                                                                             |
| load-end    | `calls`, `byKind`, `minutes`                                | —                                                       | equal the minute buckets' totals and count                                                                                                                                                         |
| load-end    | `streamChunks`                                              | delivery through the end                                | between the last sample's count and the schedule at load end; at least the schedule 2 s before the window's end                                                                                    |
| load-end    | error counters, `errorsByKind`                              | —                                                       | as for a sample; all present for a full run                                                                                                                                                        |
| post-rest   | `time`, `elapsed`                                           | the rest                                                | offset within 0.5 s; rest 300 s ± 2 s on both clocks: wall clock from load-end's `time`, and elapsed difference less load-end's own offset                                                         |
| post-rest   | `memory.heapUsed`                                           | post-rest check                                         | present                                                                                                                                                                                            |
| post-rest   | `calls`, `byKind`, `streamChunks`, error counters           | no load during the rest                                 | equal the minute totals, load-end's chunks, and the events logged by then                                                                                                                          |
| cleanup     | `time`                                                      | the run finished                                        | present, and logged last                                                                                                                                                                           |
| cleanup     | `calls`, `byKind`, `streamChunks`, error counters           | every event counted                                     | as post-rest                                                                                                                                                                                       |

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
