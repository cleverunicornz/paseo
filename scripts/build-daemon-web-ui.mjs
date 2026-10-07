import { spawn } from "node:child_process";
import { createReadStream, createWriteStream } from "node:fs";
import { cp, mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";
import { constants as zlibConstants, createBrotliCompress, createGzip } from "node:zlib";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");
const APP_DIR = path.join(REPO_ROOT, "packages", "app");
const SOURCE_DIST = path.join(APP_DIR, "dist");
const TARGET_DIST = path.join(REPO_ROOT, "packages", "server", "dist", "server", "web-ui");
const COMPRESS_EXTENSIONS = new Set([".html", ".js", ".css", ".json", ".svg", ".map"]);
// The export is built with this Expo baseUrl, then each occurrence is rewritten
// so the daemon decides the base path at runtime (`daemon.web.basePath`).
const BASE_PATH_SENTINEL = "/__paseo_base_path__";
const RUNTIME_BASE_PATH = '(globalThis.__PASEO_WEB_BASE_PATH__||"")';

function fmtMiB(bytes) {
  return `${(bytes / 1024 / 1024).toFixed(2)} MiB`;
}

function run(command, args, options) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: "inherit",
      shell: false,
      ...options,
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`Command failed with exit code ${code}: ${command} ${args.join(" ")}`));
        return;
      }
      resolve();
    });
  });
}

async function exportBrowserWebApp() {
  console.log("Exporting browser web app...");
  await run("npm", ["run", "build:web", "--workspace=@getpaseo/app"], {
    cwd: REPO_ROOT,
    env: { ...process.env, PASEO_WEB_BASE_URL: BASE_PATH_SENTINEL },
  });
}

async function cleanTarget() {
  console.log(`Cleaning ${path.relative(REPO_ROOT, TARGET_DIST)}...`);
  await rm(TARGET_DIST, { recursive: true, force: true });
  await mkdir(TARGET_DIST, { recursive: true });
}

async function copyAssets() {
  console.log(`Copying assets to ${path.relative(REPO_ROOT, TARGET_DIST)}...`);
  await cp(SOURCE_DIST, TARGET_DIST, { recursive: true, force: true });
}

async function listFiles(dir) {
  const entries = await readdir(dir, { withFileTypes: true, recursive: true });
  return entries
    .filter((entry) => entry.isFile())
    .map((entry) => path.join(entry.parentPath, entry.name));
}

function describeContext(text, index) {
  return JSON.stringify(text.slice(Math.max(0, index - 40), index + 60));
}

/**
 * Expo writes the base URL into the index, the router and every asset URL as
 * string literals starting with the sentinel. A literal becomes an expression
 * that reads the base path the daemon injects into the page. Any other shape
 * fails the build rather than ship a bundle that ignores the base path.
 */
function rewriteJavaScript(text, filePath) {
  let rewritten = text.replaceAll(`\\"${BASE_PATH_SENTINEL}\\"`, '\\"\\"');
  let index = rewritten.indexOf(`"${BASE_PATH_SENTINEL}`);
  while (index !== -1) {
    const end = rewritten.indexOf('"', index + 1);
    if (end === -1 || rewritten[end + 1] === ":") {
      throw new Error(
        `Unexpected base path literal in ${filePath}: ${describeContext(rewritten, index)}`,
      );
    }
    const replacement = `${RUNTIME_BASE_PATH}+"`;
    rewritten = `${rewritten.slice(0, index)}${replacement}${rewritten.slice(index + 1 + BASE_PATH_SENTINEL.length)}`;
    index = rewritten.indexOf(`"${BASE_PATH_SENTINEL}`, index + replacement.length);
  }
  const leftover = rewritten.indexOf(BASE_PATH_SENTINEL);
  if (leftover !== -1) {
    throw new Error(`Unexpected base path in ${filePath}: ${describeContext(rewritten, leftover)}`);
  }
  return rewritten;
}

async function rewriteBasePathSentinel(dir) {
  let rewrittenFiles = 0;
  for (const filePath of await listFiles(dir)) {
    const extension = path.extname(filePath).toLowerCase();
    if (![".html", ".js", ".css", ".json", ".map"].includes(extension)) continue;
    const text = await readFile(filePath, "utf8");
    if (!text.includes(BASE_PATH_SENTINEL)) continue;
    let rewritten;
    if (extension === ".js") {
      rewritten = rewriteJavaScript(text, filePath);
    } else if (extension === ".html") {
      // Back to root-absolute; the daemon prefixes the index per request.
      rewritten = text.replaceAll(`"${BASE_PATH_SENTINEL}/`, '"/');
    } else if (extension === ".map") {
      rewritten = text.replaceAll(BASE_PATH_SENTINEL, "");
    } else {
      throw new Error(`Unexpected base path in ${filePath}`);
    }
    if (rewritten.includes(BASE_PATH_SENTINEL)) {
      throw new Error(`Base path sentinel left in ${filePath}`);
    }
    await writeFile(filePath, rewritten);
    if (extension === ".js") {
      await run(process.execPath, ["--check", filePath], { cwd: REPO_ROOT });
    }
    rewrittenFiles += 1;
  }
  if (rewrittenFiles === 0) {
    throw new Error(
      "The web export carries no base path sentinel; was PASEO_WEB_BASE_URL applied?",
    );
  }
  console.log(`Rewrote the base path in ${rewrittenFiles} files`);
}

async function compressFile(filePath) {
  const brotliPath = `${filePath}.br`;
  const gzipPath = `${filePath}.gz`;
  await Promise.all([
    pipeline(
      createReadStream(filePath),
      createBrotliCompress({
        params: {
          [zlibConstants.BROTLI_PARAM_QUALITY]: zlibConstants.BROTLI_MAX_QUALITY,
        },
      }),
      createWriteStream(brotliPath),
    ),
    pipeline(createReadStream(filePath), createGzip(), createWriteStream(gzipPath)),
  ]);
}

async function precompressAssets(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = entries.filter((entry) => entry.isFile());
  const dirs = entries.filter((entry) => entry.isDirectory());

  for (const file of files) {
    const filePath = path.join(dir, file.name);
    if (COMPRESS_EXTENSIONS.has(path.extname(file.name).toLowerCase())) {
      await compressFile(filePath);
    }
  }

  for (const subdir of dirs) {
    await precompressAssets(path.join(dir, subdir.name));
  }
}

async function measureBundle(dir) {
  let raw = 0;
  let gzip = 0;
  let brotli = 0;

  async function walk(current) {
    const entries = await readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      const entryPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        await walk(entryPath);
        continue;
      }
      const info = await stat(entryPath);
      const ext = path.extname(entry.name).toLowerCase();
      if (ext === ".br") {
        brotli += info.size;
      } else if (ext === ".gz") {
        gzip += info.size;
      } else {
        raw += info.size;
      }
    }
  }

  await walk(dir);
  return { raw, gzip, brotli };
}

async function main() {
  await exportBrowserWebApp();

  const sourceStat = await stat(SOURCE_DIST).catch(() => null);
  if (!sourceStat?.isDirectory()) {
    throw new Error(`Browser web export not found at ${SOURCE_DIST}`);
  }

  await cleanTarget();
  await copyAssets();
  await rewriteBasePathSentinel(TARGET_DIST);
  await precompressAssets(TARGET_DIST);

  const sizes = await measureBundle(TARGET_DIST);
  console.log("Daemon web UI bundle:");
  console.log(`  raw:    ${fmtMiB(sizes.raw)}`);
  console.log(`  gzip:   ${fmtMiB(sizes.gzip)}`);
  console.log(`  brotli: ${fmtMiB(sizes.brotli)}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
