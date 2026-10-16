import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
const MANAGED_FILES_MANIFEST = ".paseo-managed-files.json";
async function writeFileIfChanged(srcPath, dstPath) {
    const src = await fs.readFile(srcPath);
    const dst = await fs.readFile(dstPath).catch(() => null);
    if (dst && src.equals(dst))
        return false;
    await fs.mkdir(path.dirname(dstPath), { recursive: true });
    await fs.writeFile(dstPath, src);
    return true;
}
export async function listFilesRecursive(rootDir) {
    const out = [];
    async function walk(dir) {
        const entries = await fs.readdir(dir, { withFileTypes: true });
        for (const entry of entries) {
            const full = path.join(dir, entry.name);
            const rel = path.relative(rootDir, full);
            if (rel === MANAGED_FILES_MANIFEST)
                continue;
            if (entry.isDirectory()) {
                await walk(full);
            }
            else if (entry.isFile()) {
                out.push(rel);
            }
        }
    }
    await walk(rootDir);
    return out;
}
export async function readManagedFilesManifest(dstDir) {
    const raw = await fs
        .readFile(path.join(dstDir, MANAGED_FILES_MANIFEST), "utf-8")
        .catch(() => null);
    if (!raw)
        return null;
    const parsed = safeParseJson(raw);
    if (!parsed)
        return null;
    if (parsed.version !== 1 || typeof parsed.files !== "object" || parsed.files === null)
        return null;
    return { version: 1, files: parsed.files };
}
function safeParseJson(raw) {
    try {
        return JSON.parse(raw);
    }
    catch {
        return null;
    }
}
async function hashFile(filePath) {
    const buf = await fs.readFile(filePath);
    return createHash("sha256").update(buf).digest("hex");
}
async function writeManifestIfChanged(dstDir, files) {
    const manifest = { version: 1, files };
    const next = `${JSON.stringify(manifest, null, 2)}\n`;
    const manifestPath = path.join(dstDir, MANAGED_FILES_MANIFEST);
    const current = await fs.readFile(manifestPath, "utf-8").catch(() => null);
    if (current === next)
        return false;
    await fs.mkdir(dstDir, { recursive: true });
    await fs.writeFile(manifestPath, next);
    return true;
}
async function pruneEmptyParentDirs(rootDir, rels) {
    const dirs = new Set();
    for (const rel of rels) {
        let dir = path.dirname(rel);
        while (dir !== ".") {
            dirs.add(dir);
            dir = path.dirname(dir);
        }
    }
    const deepestFirst = [...dirs].sort((a, b) => b.split(path.sep).length - a.split(path.sep).length);
    for (const rel of deepestFirst) {
        await fs.rmdir(path.join(rootDir, rel)).catch(() => { });
    }
}
async function assertManagedPathsStayInsideSkill(rootDir, rels) {
    for (const rel of rels) {
        const normalized = path.normalize(rel);
        if (path.isAbsolute(normalized) ||
            normalized === ".." ||
            normalized.startsWith(`..${path.sep}`)) {
            throw new Error(`Cannot sync managed path outside skill directory: ${rel}`);
        }
        let current = rootDir;
        for (const segment of normalized.split(path.sep)) {
            current = path.join(current, segment);
            const info = await fs.lstat(current).catch((error) => {
                if (error.code === "ENOENT")
                    return null;
                throw error;
            });
            if (info === null)
                break;
            if (info.isSymbolicLink()) {
                throw new Error(`Cannot sync through symbolic link: ${current}`);
            }
        }
    }
}
async function syncDirectoryFiles(srcDir, dstDir) {
    const files = await listFilesRecursive(srcDir);
    const srcFileSet = new Set(files);
    const srcHashes = {};
    for (const rel of files) {
        srcHashes[rel] = await hashFile(path.join(srcDir, rel));
    }
    await assertManagedPathsStayInsideSkill(dstDir, [MANAGED_FILES_MANIFEST]);
    const previousManifest = await readManagedFilesManifest(dstDir);
    await assertManagedPathsStayInsideSkill(dstDir, [
        MANAGED_FILES_MANIFEST,
        ...files,
        ...Object.keys(previousManifest?.files ?? {}),
    ]);
    let changed = 0;
    for (const rel of files) {
        if (await writeFileIfChanged(path.join(srcDir, rel), path.join(dstDir, rel))) {
            changed++;
        }
    }
    const deletedRels = [];
    for (const [rel, previousHash] of Object.entries(previousManifest?.files ?? {})) {
        if (srcFileSet.has(rel))
            continue;
        const dstPath = path.join(dstDir, rel);
        const currentHash = await hashFile(dstPath).catch(() => null);
        if (currentHash !== previousHash)
            continue;
        await fs.rm(dstPath, { force: true });
        deletedRels.push(rel);
        changed++;
    }
    await pruneEmptyParentDirs(dstDir, deletedRels);
    if (await writeManifestIfChanged(dstDir, srcHashes))
        changed++;
    return changed;
}
export async function removeSkill(skillName, targets) {
    const paths = [
        path.join(targets.agentsDir, skillName),
        path.join(targets.claudeDir, skillName),
        path.join(targets.codexDir, skillName),
    ];
    for (const p of paths) {
        await fs.rm(p, { recursive: true, force: true });
    }
}
async function isSameDirectory(a, b) {
    const [realA, realB] = await Promise.all([a, b].map((p) => fs.realpath(p).catch(() => null)));
    return realA !== null && realA === realB;
}
/**
 * Codex also discovers .agents/skills, so its dedicated copy is a leftover. When
 * the Codex skill directory resolves to the shared or Claude copy, it is that
 * copy, and retiring it would delete the install.
 */
export async function isLegacyCodexCopy(skillName, targets) {
    const codexSkillDir = path.join(targets.codexDir, skillName);
    for (const root of [targets.agentsDir, targets.claudeDir]) {
        if (await isSameDirectory(codexSkillDir, path.join(root, skillName)))
            return false;
    }
    return true;
}
async function retireManagedSkill(dstDir) {
    const info = await fs.lstat(dstDir).catch(() => null);
    if (!info?.isDirectory())
        return 0;
    const manifest = await readManagedFilesManifest(dstDir);
    if (!manifest)
        return 0;
    const files = Object.keys(manifest.files);
    await assertManagedPathsStayInsideSkill(dstDir, [MANAGED_FILES_MANIFEST, ...files]);
    const removed = [];
    for (const [rel, previousHash] of Object.entries(manifest.files)) {
        const filePath = path.join(dstDir, rel);
        const currentHash = await hashFile(filePath).catch(() => null);
        if (currentHash !== previousHash)
            continue;
        await fs.rm(filePath);
        removed.push(rel);
    }
    await pruneEmptyParentDirs(dstDir, removed);
    await fs.rm(path.join(dstDir, MANAGED_FILES_MANIFEST));
    await fs.rmdir(dstDir).catch((error) => {
        if (error.code !== "ENOTEMPTY" && error.code !== "ENOENT")
            throw error;
    });
    return removed.length + 1;
}
export async function syncSkills(options) {
    let changedFiles = 0;
    let processedSkills = 0;
    for (const skillName of options.skillNames) {
        const bundleSkillDir = path.join(options.sourceDir, skillName);
        const bundleStat = await fs.stat(bundleSkillDir).catch(() => null);
        if (!bundleStat?.isDirectory())
            continue;
        try {
            changedFiles += await syncDirectoryFiles(bundleSkillDir, path.join(options.agentsDir, skillName));
            changedFiles += await syncDirectoryFiles(bundleSkillDir, path.join(options.claudeDir, skillName));
            // Retain user edits to the old dedicated Codex copy.
            if (await isLegacyCodexCopy(skillName, options)) {
                changedFiles += await retireManagedSkill(path.join(options.codexDir, skillName));
            }
            processedSkills++;
        }
        catch (error) {
            if (!options.onSkillError)
                throw error;
            options.onSkillError(skillName, error);
        }
    }
    return { changedFiles, processedSkills };
}
//# sourceMappingURL=sync.js.map