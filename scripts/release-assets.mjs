import { gunzipSync } from "node:zlib";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

// Reading a published release's real assets, for the provenance gate.
//
// The validator's r1 finding: the gate accepted copied tarballs renamed to the
// tag's version while every embedded `package.json` still said `0.11.2`, and it
// never looked at a tarball's bytes. A gate that only sees names cannot refuse
// that shape, so this module reads what is really in each asset: its embedded
// package identity, its digests, and its packed files.
//
// The tarball reader is Node's own zlib plus a small ustar parser, so the gate
// adds no dependency and runs anywhere the release does.

const BLOCK_BYTES = 512;

/** Parse a ustar/gzipped tar'ed buffer into `{name, body}` entries. */
export function readTarGzEntries(bytes) {
  const tar = gunzipSync(bytes);
  const entries = [];
  let offset = 0;
  while (offset + BLOCK_BYTES <= tar.length) {
    const header = tar.subarray(offset, offset + BLOCK_BYTES);
    // A zero block ends the archive; two of them pad it.
    if (header.every((byte) => byte === 0)) break;

    const name = readString(header, 0, 100);
    const sizeField = readString(header, 124, 12).trim();
    const typeflag = String.fromCharCode(header[156] ?? 0);
    const prefix = readString(header, 345, 155);
    const size = sizeField === "" ? 0 : Number.parseInt(sizeField, 8);
    if (!Number.isFinite(size) || size < 0) {
      throw new Error(`Malformed tar entry ${JSON.stringify(name)}: size ${JSON.stringify(sizeField)}`);
    }

    const fullName = prefix === "" ? name : `${prefix}/${name}`;
    const bodyStart = offset + BLOCK_BYTES;
    const body = tar.subarray(bodyStart, bodyStart + size);
    if (typeflag === "0" || typeflag === "\0" || typeflag === "7") {
      entries.push({ name: fullName, body });
    }
    offset = bodyStart + Math.ceil(size / BLOCK_BYTES) * BLOCK_BYTES;
  }
  return entries;
}

function readString(buffer, start, length) {
  const slice = buffer.subarray(start, start + length);
  const end = slice.indexOf(0);
  return slice.subarray(0, end < 0 ? slice.length : end).toString("utf8");
}

/** The `package.json` a tarball carries, which is its real, embedded identity. */
export function readPackedPackageJson(bytes) {
  const entry = readTarGzEntries(bytes).find((item) => item.name === "package/package.json");
  if (!entry) {
    throw new Error("The tarball carries no package/package.json");
  }
  return JSON.parse(entry.body.toString("utf8"));
}

/** Parse a `SHA256SUMS`-style file: `<hex digest><two spaces><file name>` per line. */
export function parseChecksumFile(text) {
  const entries = [];
  for (const rawLine of text.split("\n")) {
    const line = rawLine.trimEnd();
    if (line === "") continue;
    const match = /^([0-9a-fA-F]{64}|[0-9a-fA-F]{128})\s+\*?(.+)$/.exec(line);
    if (!match) {
      throw new Error(`A checksum line is malformed: ${JSON.stringify(rawLine)}`);
    }
    entries.push({ digest: match[1].toLowerCase(), file: match[2].trim() });
  }
  return entries;
}

export function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

export function sha512(bytes) {
  return createHash("sha512").update(bytes).digest("hex");
}

/**
 * Read a directory of published release assets into the manifest shape the
 * provenance gate checks. Every field comes from the real files: the digests
 * from their bytes, the versions from their embedded `package.json`.
 *
 * `expectedPackageNames` is the seven-package set the release must carry; the
 * files a release publishes are exactly those packages, SHA256SUMS, SHA512SUMS,
 * SOURCE_COMMIT and NODE_VERSION.
 */
export function readReleaseAssets({ releaseDir, expectedPackageNames }) {
  const files = readdirSync(releaseDir).sort();
  const packages = [];
  const digests = new Map();

  for (const file of files) {
    const full = path.join(releaseDir, file);
    if (!statSync(full).isFile()) continue;
    if (file.endsWith(".tgz")) {
      const bytes = readFileSync(full);
      const manifest = readPackedPackageJson(bytes);
      packages.push({ file, name: manifest.name, version: manifest.version });
      digests.set(file, { sha256: sha256(bytes), sha512: sha512(bytes) });
      continue;
    }
    if (file === "SHA256SUMS" || file === "SHA512SUMS") {
      // These files' own bytes are what `manifest_sha256` names, so their
      // digests are recorded exactly as a tarball's are.
      const bytes = readFileSync(full);
      digests.set(file, { sha256: sha256(bytes), sha512: sha512(bytes) });
    }
  }

  const readText = (name) => {
    try {
      return readFileSync(path.join(releaseDir, name), "utf8");
    } catch {
      return null;
    }
  };

  const sha256SumsText = readText("SHA256SUMS");
  const sha512SumsText = readText("SHA512SUMS");

  return {
    assetNames: files,
    packages,
    digests,
    hasAllPackages: expectedPackageNames.every((name) =>
      packages.some((item) => item.name === `@getpaseo/${name}`),
    ),
    checksum256: sha256SumsText === null ? null : parseChecksumFile(sha256SumsText),
    checksum512: sha512SumsText === null ? null : parseChecksumFile(sha512SumsText),
    manifestSha256: sha256SumsText === null ? null : sha256(Buffer.from(sha256SumsText, "utf8")),
    sourceCommit: readText("SOURCE_COMMIT")?.trim() ?? null,
    nodeVersion: readText("NODE_VERSION")?.trim() ?? null,
  };
}

/** Extract the server package's built `dist/server` from its tarball into `targetDir`. */
export function extractServerDist({ serverTarball, targetDir, mkdirSync, writeFileSync }) {
  const entries = readTarGzEntries(readFileSync(serverTarball));
  const prefix = "package/dist/server/";
  let written = 0;
  for (const entry of entries) {
    if (!entry.name.startsWith(prefix)) continue;
    const relative = entry.name.slice(prefix.length);
    const destination = path.join(targetDir, relative);
    mkdirSync(path.dirname(destination), { recursive: true });
    writeFileSync(destination, entry.body);
    written += 1;
  }
  if (written === 0) {
    throw new Error(`${serverTarball} carries no package/dist/server: the payload cannot be proven`);
  }
  return written;
}
