# Console release checklist

What a release the console runs must satisfy before it is consumed by the
running kit. This is the gate that a wrong-line release slipped through on
2026-10-16: `v0.11.2-cvu.2` was published from `internal/main` (the v2 line,
base `0.10.3`) carrying neither upstream 0.11.2 nor the console's heap fix,
while its tag named the console's line. Nothing pinned or deployed it; the
corrective release is `v0.11.2-cvu.3` from `console/main`.

The console runs upstream v0.11.2 with the fork's leak fix (infra-v2
P-000269 H2) and, from `0.11.2-cvu.3`, the bounded git scheduler
(infra-v2 P-000289 H1–H3). Both fixes must be in the built payload, not only
in the tag's ancestry.

## The full commits this release is made of

A gate that names a fix by an abbreviation cannot certify it. These are the
full commit ids; `git merge-base --is-ancestor <id> HEAD` must hold for each
ancestor before the operator is asked, and the payload behavior below must
hold for each port.

| Role                                                                        | Full commit (ancestor of the release)      |
| --------------------------------------------------------------------------- | ------------------------------------------ |
| Upstream 0.11.2, the console line's merge base                              | `75953250959979b8f088bbca8dbd6ee61d0151b1` |
| Heap fix: detach streamed suffixes and capped prefixes                      | `d282eb2edb418d6988f10837c826d652c1596c4f` |
| Port H1: bound the git scheduler queue and yield background sweeps          | `6e26eee129c9dbeb60be8f7324e353e84a52694a` |
| Port H2: reconcile from a warm checkout cache, not a Git read per workspace | `6b2a53a7b60bd46c4602853279d369ea9fbae0c0` |
| Port H3: expose the loop-blocker series beside the loop-delay gauge         | `8b5559630203c7f2dd616b5ea13cdba35d394e8b` |
| Validated scheduler source (paseo PR #23), the ports' origin                | `98c30ca59bb42c8bd803f4ec4bc1716e61249633` |

The three port commits are on `console/main` through the pull request that
made them; a document committed in that same pull request cannot name its own
commits, so they are listed here for a human to resolve and proven
mechanically by the payload's behavior, not by a string.

## What the scripts check, and how

`scripts/console-release-provenance.mjs` has two halves, and they mean
different things:

- **Prepublication identity** (`assertPrepublicationProvenance`) runs on the
  release dispatch before anything is published. The run's head, the commit
  the tag would name and `SOURCE_COMMIT` are one commit; the release is on the
  console's line; and the built payload's behavior is proven.
- **Postpublication qualification** (`assertReleaseProvenance`, run by the
  `qualify-published` CI job from the downloaded release) checks the real
  assets: each of the seven tarballs' OWN embedded `package.json` carries the
  tag's version, `SHA256SUMS`/`SHA512SUMS` cover exactly the seven tarballs and
  match their bytes, `manifest_sha256` is the `SHA256SUMS` bytes, and
  `SOURCE_COMMIT` is the tag's commit.

The payload rule is **behavioral**, never a marker search. The r1 validation
disabled the scheduler's bound and reverted either heap-detach helper in turn,
each with every marker string still in the compiled tree, and a substring gate
accepted all three. `scripts/console-payload-probes/*.mjs` instead RUN the
built code: the built scheduler must refuse its overflow, the built limiter and
streamer must not retain their sources, and the built loop monitor must report
its series. Those probes run against the built dist in the `daemon` job and
against the installed payload in `qualify-published`.

`scripts/console-release-provenance.test.mjs`, `scripts/release-assets.test.mjs`
and `scripts/console-ci-workflow.test.mjs` prove these rules; they run in the
workflow's `Check the release rules` step.

## Before the operator approves the kit

Ask only with a receipt for the kit actually selected and the release actually
published. A passing build is not that receipt.

- [ ] **The release is from the console line.** The tag's commit is on
      `console/main` or `candidate/console-heap-0.11.2`, and its merge base with
      upstream is `759532509` (upstream 0.11.2's release cut). A tag naming
      another line refuses: `scripts/console-release-channel.mjs guard` checks
      the repository, the ref, the tag's shape and the base version before
      anything is built.
- [ ] **Every commit in the table above is an ancestor of the released commit.**
      The heap fix and upstream 0.11.2 are checked by the `daemon` job's ancestry
      step; the three ports by name here.
- [ ] **The packed assets carry the tag's version in their contents.** Read each
      tarball's own `package.json`, not its file name: `npm pack` views, or
      `tar -xzOf <tarball> package/package.json`. A renamed copy keeps the
      version it was packed with.
- [ ] **The published release is downloaded and qualified.** The
      `qualify-published` job's run, from the downloaded assets: seven packages
      at the tag's version, both checksum tables matching the tarballs' bytes,
      `manifest_sha256` equal to the `SHA256SUMS` bytes, `SOURCE_COMMIT` equal to
      the tag's commit.
- [ ] **Both fixes' behavior is proven in that downloaded payload.** The
      `qualify-published` job runs the behavior probes against the INSTALLED
      server's `dist/server`; its log names all four probes. `manifest_sha256`
      and the per-tarball digests from that run are the receipt.
- [ ] **The selected kit's receipt binds this release.** `pct current` (kit
      version and kit sha) on `cvu-console-1`, and the privileged-container
      image and repo-pod digest the kit pins, must name `v0.11.2-cvu.3`, its
      `SOURCE_COMMIT` and the Paseo version the image's receipt reports. A kit or
      image naming another version, or no receipt, is not this release.
- [ ] **The image builds from that pin and keeps the managed-update anchors.**
      `scripts/check-managed-update-anchors.mjs` passes on the built server; the
      anchors are checked by the consumer's own rule, not by byte-identity
      (P-000289 H3 necessarily adds to `websocket-server.js`).

## After the release is published

- [ ] The runner-images pin (`images/repo-pod/paseo-release.json`) names the
      release, its version and its `SOURCE_COMMIT`; `qualify-published` passed
      for that release.
- [ ] The image builds from that pin and the built server keeps the
      managed-update anchors by the consumer's rule.

## Never

- Never consume a release whose tag's line and whose payload's line disagree —
  check the payload, not the tag.
- Never accept a marker string as proof of a fix: a reverted fix can carry
  every marker. Prove the behavior, or bind the exact built bytes to the
  qualified source.
- Never ask the operator with an abbreviation or a partial commit id: the table
  above is the identity, and the kit/image receipt is the evidence.
- Never reuse, move or delete a published tag, however wrong its payload. A
  replacement is a new version. `v0.11.2-cvu.2` stays a prerelease with its
  warning and is never consumed.
