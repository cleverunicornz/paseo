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

`scripts/console-release-provenance.mjs` checks what can be checked
mechanically; `scripts/console-release-provenance.test.mjs` proves its rules.
The human items below are the ones a script cannot decide.

## Before the operator approves the kit

- [ ] **The release is from the console line.** The tag's commit is on
      `console/main` or `candidate/console-heap-0.11.2`, and its merge base with
      upstream is `759532509` (upstream 0.11.2's release cut). A tag naming
      another line refuses: `scripts/console-release-channel.mjs guard` checks
      the repository, the ref, the tag's shape and the base version before
      anything is built.
- [ ] **The heap fix is present.** `d282eb2ed` (detach streamed suffixes and
      capped prefixes from their source) is an ancestor of the released
      commit, and the built payload carries it.
- [ ] **The scheduler fix is present.** The built payload carries the ported
      scheduler bound. The original validated source is
      `98c30ca59bb42c8bd803f4ec4bc1716e61249633` (paseo PR #23, base
      `c5b81be0`); the port's own commits on the console line are named in the
      pull request that made them, and the payload markers prove the port
      landed.
- [ ] **The built payload carries both.** Not just the tag: the published
      server dist shows the port's markers and the heap fix's marker.
- [ ] **Provenance is internally consistent.** The workflow run's head, the
      tag's commit and the release's `SOURCE_COMMIT` asset are the same commit;
      the seven packages carry the tag's version; `SHA256SUMS` and `SHA512SUMS`
      match the published tarballs; `manifest_sha256` is the `SHA256SUMS` bytes.

## After the release is published

- [ ] `scripts/console-release-provenance.mjs` passes against the published
      tarballs and a clone at `SOURCE_COMMIT` (the console CI's `daemon` job
      runs it on the build; a validator re-runs it on the published assets).
- [ ] The runner-images pin ( `images/repo-pod/paseo-release.json` ) names the
      release, its version and its `SOURCE_COMMIT`.
- [ ] The image builds from that pin and the built server keeps the
      managed-update anchors byte-identical to upstream 0.11.2
      (`scripts/check-managed-update-anchors.mjs`).

## Never

- Never consume a release whose tag's line and whose payload's line disagree —
  check the payload, not the tag.
- Never reuse, move or delete a published tag, however wrong its payload. A
  replacement is a new version.
