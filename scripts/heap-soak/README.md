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
- `schema.mjs` — one schema per record type the driver writes; `analyze.mjs` checks every record
  against it before any analysis.
- `analyze.test.mjs` — unit tests for `analyze.mjs`, on runs built the way the driver records them.

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

The exit code is the verdict: 0 PASS, 1 FAIL, 2 INCONCLUSIVE. No exception decides it: any internal
error, from reading the file to printing the report, prints an INCONCLUSIVE verdict naming the
error and exits 2. The verdict's code is used only once stdout has taken the whole report; a failed
write (a full disk, a closed pipe) exits 2 and says so on stderr. A run that never reached its baseline (the worker did not start, or seeding the
fixture failed) is INCONCLUSIVE.

`analyze.mjs` computes P-000269 H1's numbers: the baseline; the max sample minus baseline
(≤ 64 MiB); the last-hour least-squares slope (< 16 MiB/h); the post-rest sample against the last
load sample; RPC errors and worker deaths; the calls per minute and the 15/9/2/1 mix per minute
with every off-protocol minute listed; and the streaming-agent count. For `--control` it reports
whether the run rose more than 500 MB above its own baseline or reached the worker's heap bound
(a sample at `heap_size_limit`, or a timed worker exit whose stderr shows the V8 heap-limit abort)
within the 4 hours, and judges the control's record only up to that leak point.

A run qualifies only on a complete, consistent record. A protocol break (an off-protocol minute,
fewer than 7 streaming agents, a missing sample, a run cut short) exits 2, inconclusive. So does
anything malformed, absent, duplicated or contradictory, checked in two layers: each record against
its schema, then the records against each other. `--control` judges only a run recorded with
`--control`.

### Schema (checked first)

`schema.mjs` holds one schema per record type `soak.mjs` writes, derived from its `logger` calls
and `worker.mjs`'s `metrics()`, and checked against the real runs' files. Every record must have
exactly its type's fields: none missing, none unknown, exact types, counts as integers ≥ 0, and
the invariants below. A violation exits 2, inconclusive, naming the record (its position among the
non-empty lines, from 1) and the rule; the run is not analysed.

| Record (`stage`)                                                                                                       | Fields                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | Invariants within the record                                                                                                                                                                                                                                                                                                                                                                                                                         |
| ---------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| every record                                                                                                           | `time` (ISO-8601 UTC, milliseconds), `stage` (one of the types below)                                                                                                                                                                                                                                                                                                                                                                                                   | an unknown type, an unknown field (membership is by own property, so `constructor`, `__proto__` and the like are unknown too), or a line that is not a JSON object is a violation                                                                                                                                                                                                                                                                    |
| `baseline` (the header)                                                                                                | `root` (non-empty string), `port` (1–65535), `label` (string or null), `control`, `boundaryCopy`, `readStreaming` (booleans), `fixture` {`agents`, `running`, `idle`, `seededRows`, `rowBytes`, `persistentClients`, `subscribedClients`, `streamingAgents`}, `protocol` {`seconds`, `restSeconds`, `connectionsPerMinute`, `messageSeconds`, `mix` {`logs`, `inspect`, `ls`, `send`}}, `workerHeapBoundBytes`, `heapSizeLimitBytes`, `baseline` (a worker observation) | `heapSizeLimitBytes` = `baseline.heapStatistics.heap_size_limit` (the driver copies it); `fixture.running` + `idle` = `agents`; `mix` sums to `connectionsPerMinute`; the observation's invariants                                                                                                                                                                                                                                                   |
| worker observation (`metrics()`: the header's `baseline`, and spread into `sample`, a live `load-end` and `post-rest`) | `pid` (> 0), `memory` {`rss`, `heapTotal`, `heapUsed`, `external`, `arrayBuffers`}, `heapStatistics` (the 14 keys of `v8.getHeapStatistics()`), `agents` {`total`, `subscriptionCount`, `byLifecycle` {`running`, `idle`}, `withActiveForegroundTurn`, `timelineStats` {`totalItems`, `maxItemsPerAgent`}}, `resident`, `retainedParentStates`, `retainedRows`, `handles` (handle type → count)                                                                         | `agents.total` = `running` + `idle` = 15; `resident` = `agents.total`; `withActiveForegroundTurn` ≤ `total`; `maxItemsPerAgent` ≤ `totalItems` ≤ `agents.total` × `maxItemsPerAgent`; `heapUsed` ≤ `heapTotal`; `used_heap_size` ≤ `total_heap_size`; `does_zap_garbage` is 0 or 1                                                                                                                                                                   |
| counters (on `sample`, `load-end`, `post-rest`, `cleanup`)                                                             | `calls`, `byKind` {`logs`, `inspect`, `ls`, `send`}, `streamChunks`, `streamErrors`, `rpcErrors`, `workerDeaths`                                                                                                                                                                                                                                                                                                                                                        | `byKind` sums to `calls`; `streamErrors` ≤ `rpcErrors`; where present, `errorsByKind` {`logs`, `inspect`, `ls`, `send`, `stream`, `sample`, `other`} sums to `rpcErrors` and its `stream` = `streamErrors`                                                                                                                                                                                                                                           |
| `sample`                                                                                                               | `elapsed` (finite, ≥ 0), the counters, `minutes`, `errorsByKind`, the observation                                                                                                                                                                                                                                                                                                                                                                                       | as for the counters and the observation                                                                                                                                                                                                                                                                                                                                                                                                              |
| `minute`                                                                                                               | `index` (0–240), `elapsedStart`, `elapsedEnd` (finite, ≥ 0), `byKind`, `calls`                                                                                                                                                                                                                                                                                                                                                                                          | `byKind` sums to `calls`; `elapsedEnd` ≥ `elapsedStart`                                                                                                                                                                                                                                                                                                                                                                                              |
| `rpc-error` (a stream error is `kind: "stream"`)                                                                       | `elapsed`, `kind` (one of the seven error kinds), `message` (string)                                                                                                                                                                                                                                                                                                                                                                                                    | —                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `worker-exit`                                                                                                          | `elapsed`, `code` (count or null), `signal` (non-empty string or null), `stopping`, `oom` (booleans), `reason` (null or the V8 heap-limit banner: `Reached heap limit`, `heap out of memory`, `Allocation failed`)                                                                                                                                                                                                                                                      | exactly one of `code` and `signal` is set; `oom` is true exactly when `reason` is set                                                                                                                                                                                                                                                                                                                                                                |
| `load-end`                                                                                                             | `elapsed`, the counters, `minutes`; with the load-end sample (the worker alive) also `errorsByKind` and the observation                                                                                                                                                                                                                                                                                                                                                 | as for the counters (and the observation)                                                                                                                                                                                                                                                                                                                                                                                                            |
| `post-rest`                                                                                                            | `elapsed`, the counters, the observation                                                                                                                                                                                                                                                                                                                                                                                                                                | as for the counters and the observation                                                                                                                                                                                                                                                                                                                                                                                                              |
| `cleanup`                                                                                                              | `root`, `removed` (boolean), the counters                                                                                                                                                                                                                                                                                                                                                                                                                               | as for the counters                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `snapshot` (only with `--snapshot`)                                                                                    | `file` (string or null)                                                                                                                                                                                                                                                                                                                                                                                                                                                 | —                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| the run                                                                                                                | —                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | every observation's `pid` = the header's `baseline.pid` (one worker); every `heap_size_limit` = `heapSizeLimitBytes`; `cleanup.root` = the header's `root`; every observation's `totalItems` is at least the 10,900 seeded rows and at most 10,900 + 3 × (the 7 held prompts + its sends so far) + its delivered stream chunks (a prompt adds its user message and at most the fake provider's two assistant chunks; a stream chunk at most one row) |

### Cross-record checks

Every field the analyzer reads is also checked against another record of the same run, within the
tolerance below.

The driver writes two clocks on its records. `time` is the wall clock when the line is logged.
`elapsed` is seconds since the load started, from the same `Date.now()`; the load starts as the
baseline is logged. A record's offset, `time − baseline.time − elapsed`, is how long after the
moment it records the line was written. Every lower bound of 0 below allows 0.5 s of clock jitter.
An unparseable line is inconclusive.

| Record                     | Field                                                       | Read for                                                | Checked against (else inconclusive)                                                                                                                                                                                                                                                          |
| -------------------------- | ----------------------------------------------------------- | ------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| baseline                   | `time`                                                      | the clock's origin                                      | required; every other record's offset is measured from it                                                                                                                                                                                                                                    |
| baseline                   | `label`, `control`, `readStreaming`, `boundaryCopy`         | run identity                                            | label present; `control` equals `--control`; reads idle agents (`false`) for a control; `boundaryCopy` is `false`                                                                                                                                                                            |
| baseline                   | `protocol.*`, `fixture.*`                                   | the protocol                                            | equal to P-000269 H1 (4 h, 300 s rest, 27/min in 15/9/2/1, 1800 s messages, 15/7/8 agents, 10,900 rows of 2048 B, 13 clients, 2 subscribed, 7 streaming)                                                                                                                                     |
| baseline                   | `baseline.memory.heapUsed`                                  | the baseline                                            | present                                                                                                                                                                                                                                                                                      |
| baseline                   | `baseline.agents` (total, running, idle, rows)              | fixture seeded before load                              | 15, 7, 8 and at least 10,900 rows                                                                                                                                                                                                                                                            |
| baseline                   | `heapSizeLimitBytes`                                        | the control's heap bound                                | present                                                                                                                                                                                                                                                                                      |
| sample                     | `elapsed`                                                   | its 30 s slot                                           | one sample per slot, within 2 s after it, every slot due in the window; none after load-end; none after 14,400 s in a full run                                                                                                                                                               |
| sample                     | `time`                                                      | —                                                       | offset 0 to 30 s (its stream, call and forced GC)                                                                                                                                                                                                                                            |
| sample                     | `memory.heapUsed`                                           | bound, slope, leak                                      | present                                                                                                                                                                                                                                                                                      |
| sample, load-end           | `agents.byLifecycle.running`                                | 7 streaming agents                                      | 7 on every sample and on the live load-end (a control's up to its leak point); fewer, with recorded stream failures, fails a fixed run (its stream stopped); otherwise inconclusive                                                                                                          |
| baseline, sample, load-end | `handles.TCPSocketWrap`, `agents.subscriptionCount`         | the client fixture: 13 persistent clients, 2 subscribed | the baseline shows exactly 13 client sockets and 3 subscriptions (the 2 subscribed clients and the daemon's own persistence listener); every sample and the live load-end through the end of load (a control's up to its leak point) shows no fewer. A drop is a fixture break: inconclusive |
| sample                     | `calls`, `byKind`                                           | the call mix                                            | counts; `byKind` sums to `calls`; between the minute buckets before its minute and through it; never decreasing                                                                                                                                                                              |
| sample                     | `minutes`                                                   | —                                                       | equals the index of the bucket holding its last call                                                                                                                                                                                                                                         |
| sample                     | `streamChunks`                                              | delivered streaming                                     | exactly `7 × floor(elapsed / 1800 × 2048)`, at most that after a stream error; never decreasing                                                                                                                                                                                              |
| sample                     | `rpcErrors`, `streamErrors`, `workerDeaths`, `errorsByKind` | errors and deaths                                       | each equals the events logged by its `time` (rpc-error events, those of kind `stream`, those of each kind, worker exits other than the harness's stop)                                                                                                                                       |
| minute                     | `index`, `elapsedStart`, `elapsedEnd`                       | per-minute rate and mix                                 | integer 0–240, unique, no hole; start at `index × 60` (±2 s); each ends where the next starts; every whole minute ends at `(index + 1) × 60` (±2 s); the last ends exactly at load-end's `elapsed`                                                                                           |
| minute                     | `calls`, `byKind`                                           | per-minute rate and mix                                 | sum to each other; 27 in 15/9/2/1 for every whole minute in the window; their totals equal the samples' and end records' counts                                                                                                                                                              |
| minute                     | `time`                                                      | —                                                       | offset 0 to 30 s; the last bucket (closed at load end) within 0.5 s                                                                                                                                                                                                                          |
| rpc-error                  | `elapsed`                                                   | dispatch moment: before or after a control's leak point | offset at least 0 (logged at or after dispatch)                                                                                                                                                                                                                                              |
| rpc-error                  | `time`, `kind`                                              | which counters must count it                            | counted by every later record's counters                                                                                                                                                                                                                                                     |
| rpc-error                  | `time`                                                      | a control's excused failure                             | excused only if logged at or after a heap-limit worker-exit and after the last good sample, and dispatched no earlier than that sample; the message is never read                                                                                                                            |
| worker-exit                | `elapsed`, `time`                                           | the death's moment                                      | offset within 0.5 s                                                                                                                                                                                                                                                                          |
| worker-exit                | `oom`, `reason`                                             | heap-limit abort                                        | `reason` shows the V8 heap-limit banner and `oom` is not `false`; any other death up to the leak point is inconclusive                                                                                                                                                                       |
| worker-exit                | `stopping`                                                  | the harness's own stop                                  | not before the run's end                                                                                                                                                                                                                                                                     |
| worker-exit                | `time`                                                      | the worker's lifetime                                   | no record observes the worker after its exit; only cleanup follows it, except in a control whose leak point it does not precede, where the driver's death path follows (the failures the exit causes, the last minute bucket and the sample-less load-end)                                   |
| load-end                   | `elapsed`                                                   | end of load                                             | within 2 s of 14,400 s for a full run; no sample or leak evidence after it                                                                                                                                                                                                                   |
| load-end                   | `time`                                                      | start of the rest                                       | offset 0 to the run's slowest periodic sample + 0.5 s (its forced GC)                                                                                                                                                                                                                        |
| load-end                   | `memory.heapUsed`                                           | last load point (slope, post-rest)                      | present for a full run                                                                                                                                                                                                                                                                       |
| load-end                   | `calls`, `byKind`, `minutes`                                | —                                                       | equal the minute buckets' totals and count                                                                                                                                                                                                                                                   |
| load-end                   | `streamChunks`                                              | delivery through the end                                | between the last sample's count and the schedule at load end; at least the schedule 2 s before the window's end                                                                                                                                                                              |
| load-end                   | error counters, `errorsByKind`                              | —                                                       | as for a sample; all present for a full run                                                                                                                                                                                                                                                  |
| post-rest                  | `time`, `elapsed`                                           | the rest                                                | offset within 0.5 s; rest 300 s ± 2 s on both clocks: wall clock from load-end's `time`, and elapsed difference less load-end's own offset                                                                                                                                                   |
| post-rest                  | `memory.heapUsed`                                           | post-rest check                                         | present                                                                                                                                                                                                                                                                                      |
| post-rest                  | `calls`, `byKind`, `streamChunks`, error counters           | no load during the rest                                 | equal the minute totals, load-end's chunks, and the events logged by then                                                                                                                                                                                                                    |
| cleanup                    | `time`                                                      | the run finished                                        | present, and logged last                                                                                                                                                                                                                                                                     |
| cleanup                    | `calls`, `byKind`, `streamChunks`, error counters           | every event counted                                     | as post-rest                                                                                                                                                                                                                                                                                 |

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
