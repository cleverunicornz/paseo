import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  parseChecksumFile,
  readPackedPackageJson,
  readReleaseAssets,
  readTarGzEntries,
  sha256,
  sha512,
} from "./release-assets.mjs";

const PACKAGES = ["highlight", "relay", "protocol", "client", "plugin", "server", "cli"];

/** A directory of real packed packages, as `npm pack` makes them. */
function packedRelease({ version = "0.11.2-cvu.3", renameTo = null } = {}) {
  const root = mkdtempSync(path.join(os.tmpdir(), "release-assets-"));
  for (const name of PACKAGES) {
    const packageDir = path.join(root, `src-${name}`);
    mkdirSync(packageDir, { recursive: true });
    writeFileSync(
      path.join(packageDir, "package.json"),
      JSON.stringify({ name: `@getpaseo/${name}`, version }),
    );
    execFileSync("npm", ["pack", "--pack-destination", root], { cwd: packageDir, stdio: "pipe" });
  }
  if (renameTo !== null) {
    // Renaming the files leaves their contents alone: the r1 renamed-copy shape.
    for (const name of PACKAGES) {
      const from = path.join(root, `getpaseo-${name}-${version}.tgz`);
      const to = path.join(root, `getpaseo-${name}-${renameTo}.tgz`);
      writeFileSync(to, readFileSync(from));
      rmSync(from);
    }
  }
  return root;
}

test("a real tarball's embedded identity is read from its bytes", () => {
  const root = packedRelease();
  try {
    const packed = readPackedPackageJson(
      readFileSync(path.join(root, "getpaseo-server-0.11.2-cvu.3.tgz")),
    );
    assert.deepEqual(packed, { name: "@getpaseo/server", version: "0.11.2-cvu.3" });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a renamed tarball still carries the version it was packed with", () => {
  // The r1 control: seven real `0.11.2` tarballs renamed to `-0.11.2-cvu.3.tgz`.
  const root = packedRelease({ version: "0.11.2", renameTo: "0.11.2-cvu.3" });
  try {
    const assets = readReleaseAssets({ releaseDir: root, expectedPackageNames: PACKAGES });
    assert.deepEqual(
      assets.packages.map((item) => item.file).sort(),
      PACKAGES.map((name) => `getpaseo-${name}-0.11.2-cvu.3.tgz`).sort(),
    );
    // The names are the tag's; the contents are still 0.11.2.
    for (const packed of assets.packages) {
      assert.equal(packed.version, "0.11.2");
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("the checksum tables bind the tarballs' own bytes", () => {
  const root = packedRelease();
  try {
    const sums = PACKAGES.map(
      (name) =>
        `${sha256(readFileSync(path.join(root, `getpaseo-${name}-0.11.2-cvu.3.tgz`)))}  getpaseo-${name}-0.11.2-cvu.3.tgz`,
    );
    writeFileSync(path.join(root, "SHA256SUMS"), `${sums.join("\n")}\n`);
    writeFileSync(path.join(root, "SOURCE_COMMIT"), `${"a".repeat(40)}\n`);
    writeFileSync(path.join(root, "NODE_VERSION"), `${process.version}\n`);

    const assets = readReleaseAssets({ releaseDir: root, expectedPackageNames: PACKAGES });
    assert.equal(assets.checksum256.length, PACKAGES.length);
    for (const entry of assets.checksum256) {
      assert.equal(assets.digests.get(entry.file)?.sha256, entry.digest);
    }
    // `manifest_sha256` is the SHA256SUMS file's own bytes.
    assert.equal(assets.manifestSha256, assets.digests.get("SHA256SUMS")?.sha256);
    assert.equal(assets.sourceCommit, "a".repeat(40));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a tarball with no package.json is refused, not skipped", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "release-assets-empty-"));
  try {
    // A valid gzipped tar holding one file that is not package/package.json.
    writeFileSync(path.join(root, "other.txt"), "no package here\n");
    const tar = execFileSync("tar", ["-czf", "-", "other.txt"], { cwd: root, encoding: "buffer" });
    writeFileSync(path.join(root, "getpaseo-server-0.11.2-cvu.3.tgz"), tar);
    assert.throws(
      () =>
        readPackedPackageJson(readFileSync(path.join(root, "getpaseo-server-0.11.2-cvu.3.tgz"))),
      /carries no package\/package\.json/,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("the tar reader returns each entry's own bytes", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "release-assets-tar-"));
  try {
    writeFileSync(path.join(root, "a.txt"), "alpha\n");
    writeFileSync(path.join(root, "b.txt"), "beta\n");
    const tar = execFileSync("tar", ["-czf", "-", "a.txt", "b.txt"], {
      cwd: root,
      encoding: "buffer",
    });
    const entries = readTarGzEntries(tar);
    const byName = new Map(entries.map((entry) => [entry.name, entry.body]));
    assert.equal(byName.get("a.txt").toString("utf8"), "alpha\n");
    assert.equal(byName.get("b.txt").toString("utf8"), "beta\n");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a malformed checksum line refuses", () => {
  assert.throws(() => parseChecksumFile("not-a-checksum\n"), /malformed/);
  assert.throws(() => parseChecksumFile("deadbeef  short-digest.tgz\n"), /malformed/);
});

test("the digests are the bytes'", () => {
  const bytes = Buffer.from("release bytes\n");
  assert.equal(sha256(bytes), createHash("sha256").update(bytes).digest("hex"));
  assert.equal(sha512(bytes), createHash("sha512").update(bytes).digest("hex"));
});
