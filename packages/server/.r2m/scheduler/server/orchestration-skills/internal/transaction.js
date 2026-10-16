import { createHash, randomUUID } from "node:crypto";
import { cp, lstat, mkdir, readdir, readFile, readlink, realpath, rename, rm, stat, writeFile, } from "node:fs/promises";
import path from "node:path";
import { listManagedSkillNames, } from "./operations.js";
import { listFilesRecursive } from "./sync.js";
const MANIFEST_OWNER = "paseo-skills-transaction";
const MANIFEST_FILENAME = "transaction.json";
const TRANSACTION_PREFIX = ".paseo-skills-transaction-";
const RECOVERED_PREFIX = ".paseo-skills-recovered-";
const BACKUP_DIRNAME = "backup";
const MANAGED_FILES_MANIFEST = ".paseo-managed-files.json";
async function isDirectory(target) {
    const info = await stat(target).catch(() => null);
    return info?.isDirectory() === true;
}
function isSkillSelection(value) {
    if (typeof value !== "object" || value === null)
        return false;
    const selection = value;
    if (selection.mode === "all")
        return true;
    return (selection.mode === "custom" &&
        Array.isArray(selection.skills) &&
        selection.skills.every((name) => typeof name === "string"));
}
async function readManifest(transactionDir) {
    const raw = await readFile(path.join(transactionDir, MANIFEST_FILENAME), "utf8").catch(() => null);
    if (raw === null)
        return null;
    let parsed;
    try {
        parsed = JSON.parse(raw);
    }
    catch {
        return null;
    }
    if (typeof parsed !== "object" || parsed === null)
        return null;
    const manifest = parsed;
    if (manifest.owner !== MANIFEST_OWNER || manifest.version !== 1)
        return null;
    if (manifest.phase !== "capturing" && manifest.phase !== "converging")
        return null;
    if (!isSkillSelection(manifest.previousSelection) || !isSkillSelection(manifest.nextSelection)) {
        return null;
    }
    if (!Array.isArray(manifest.entries))
        return null;
    const validEntries = manifest.entries.every((entry) => typeof entry?.livePath === "string" &&
        (entry.kind === "add" || entry.kind === "update" || entry.kind === "delete") &&
        (entry.backupPath === null || typeof entry.backupPath === "string"));
    if (!validEntries)
        return null;
    const entries = manifest.entries;
    return {
        owner: MANIFEST_OWNER,
        version: 1,
        phase: manifest.phase,
        previousSelection: manifest.previousSelection,
        nextSelection: manifest.nextSelection,
        entries,
    };
}
async function writeManifest(transactionDir, manifest) {
    await writeFile(path.join(transactionDir, MANIFEST_FILENAME), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
}
function selectionsEqual(left, right) {
    if (left.mode !== right.mode)
        return false;
    if (left.mode === "all" || right.mode === "all")
        return true;
    return (left.skills.length === right.skills.length &&
        left.skills.every((name, index) => name === right.skills[index]));
}
async function validateEntries(targets, transactionDir, entries) {
    const names = new Set(await listManagedSkillNames(targets.sourceDir));
    const roots = [targets.agentsDir, targets.claudeDir, targets.codexDir];
    return entries.every((entry) => {
        const rootIndex = roots.findIndex((root) => path.dirname(entry.livePath) === root);
        if (rootIndex === -1)
            return false;
        const name = path.basename(entry.livePath);
        if (!names.has(name))
            return false;
        if (entry.backupPath === null)
            return true;
        const expected = path.join(BACKUP_DIRNAME, String(rootIndex), name);
        const sameFilesystemStage = path.join(roots[rootIndex], path.basename(transactionDir), name);
        if (entry.kind === "delete" && entry.backupPath === sameFilesystemStage)
            return true;
        return (entry.backupPath === expected &&
            path
                .resolve(transactionDir, entry.backupPath)
                .startsWith(`${path.resolve(transactionDir)}${path.sep}`));
    });
}
function resolveBackupPath(transactionDir, backupPath) {
    if (backupPath === null)
        return null;
    return path.isAbsolute(backupPath) ? backupPath : path.join(transactionDir, backupPath);
}
async function discardTransaction(transactionDir, entries) {
    const stagingDirs = new Set(entries.flatMap((entry) => entry.backupPath !== null && path.isAbsolute(entry.backupPath)
        ? [path.dirname(entry.backupPath)]
        : []));
    for (const stagingDir of stagingDirs) {
        await rm(stagingDir, { recursive: true, force: true });
    }
    await rm(transactionDir, { recursive: true, force: true });
}
async function listAllFiles(rootDir) {
    const files = [];
    async function walk(dir) {
        const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
        for (const entry of entries) {
            const full = path.join(dir, entry.name);
            if (entry.isDirectory())
                await walk(full);
            else if (entry.isFile())
                files.push(path.relative(rootDir, full));
        }
    }
    await walk(rootDir);
    return files;
}
async function expectedSyncedFiles(sourceDir, name) {
    const skillDir = path.join(sourceDir, name);
    const files = new Map();
    const hashes = {};
    for (const rel of await listFilesRecursive(skillDir)) {
        const contents = await readFile(path.join(skillDir, rel));
        files.set(rel, contents);
        hashes[rel] = createHash("sha256").update(contents).digest("hex");
    }
    files.set(MANAGED_FILES_MANIFEST, Buffer.from(`${JSON.stringify({ version: 1, files: hashes }, null, 2)}\n`));
    return files;
}
async function copyStagedEntry(source, target) {
    const info = await lstat(source);
    await mkdir(path.dirname(target), { recursive: true });
    await cp(source, target, {
        recursive: info.isDirectory(),
        preserveTimestamps: true,
        verbatimSymlinks: true,
    });
}
async function mergeBackupDirectory(livePath, backupPath) {
    if (backupPath === null)
        return false;
    const liveInfo = await lstat(livePath).catch(() => null);
    const destination = liveInfo?.isSymbolicLink() ? await realpath(livePath) : livePath;
    await mkdir(destination, { recursive: true });
    let hasConflict = false;
    async function mergeMissing(sourceDir, destinationDir) {
        for (const entry of await readdir(sourceDir, { withFileTypes: true })) {
            const source = path.join(sourceDir, entry.name);
            const target = path.join(destinationDir, entry.name);
            const sourceInfo = await lstat(source);
            const targetInfo = await lstat(target).catch(() => null);
            if (targetInfo === null) {
                await copyStagedEntry(source, target);
                continue;
            }
            if (sourceInfo.isDirectory() &&
                !sourceInfo.isSymbolicLink() &&
                targetInfo.isDirectory() &&
                !targetInfo.isSymbolicLink()) {
                if ((sourceInfo.mode & 0o777) !== (targetInfo.mode & 0o777))
                    hasConflict = true;
                await mergeMissing(source, target);
                continue;
            }
            if (sourceInfo.isFile() && targetInfo.isFile()) {
                const [sourceContents, targetContents] = await Promise.all([
                    readFile(source),
                    readFile(target),
                ]);
                if (!sourceContents.equals(targetContents) ||
                    (sourceInfo.mode & 0o777) !== (targetInfo.mode & 0o777)) {
                    hasConflict = true;
                }
                continue;
            }
            if (sourceInfo.isSymbolicLink() && targetInfo.isSymbolicLink()) {
                const [sourceTarget, targetTarget] = await Promise.all([
                    readlink(source),
                    readlink(target),
                ]);
                if (sourceTarget !== targetTarget)
                    hasConflict = true;
                continue;
            }
            hasConflict = true;
        }
    }
    await mergeMissing(backupPath, destination);
    return hasConflict;
}
function recoveryBase(transactionDir, livePath, backupPath) {
    const transactionId = path.basename(transactionDir).replace(TRANSACTION_PREFIX, "");
    // Update backups live inside the central transaction directory; delete stages
    // live beside their target root. Keep quarantine on the backup's filesystem
    // so preserving it remains an atomic rename across mounted agent homes.
    const recoveryParent = backupPath.startsWith(`${transactionDir}${path.sep}`)
        ? path.dirname(transactionDir)
        : path.dirname(livePath);
    return path.join(recoveryParent, `${RECOVERED_PREFIX}${path.basename(livePath)}-${transactionId}`);
}
async function findQuarantinedEntry(transactionDir, livePath, backupPath, claimed) {
    const base = recoveryBase(transactionDir, livePath, backupPath);
    const name = path.basename(base);
    const matches = (await readdir(path.dirname(base)).catch(() => []))
        .filter((entry) => entry === name || entry.startsWith(`${name}-`))
        .map((entry) => path.join(path.dirname(base), entry))
        .filter((entry) => !claimed.has(entry))
        .sort();
    return matches[0] ?? null;
}
async function quarantineStagedEntry(transactionDir, livePath, backupPath) {
    const base = recoveryBase(transactionDir, livePath, backupPath);
    let destination = base;
    for (let suffix = 1; await lstat(destination).catch(() => null); suffix += 1) {
        destination = `${base}-${suffix}`;
    }
    await rename(backupPath, destination);
}
async function restoreDeletedDirectory(transactionDir, livePath, backupPath) {
    if (backupPath === null)
        return;
    const liveInfo = await lstat(livePath).catch(() => null);
    if (liveInfo === null) {
        await mkdir(path.dirname(livePath), { recursive: true });
        await rename(backupPath, livePath);
        return;
    }
    const backupInfo = await lstat(backupPath);
    if (backupInfo.isDirectory() && !backupInfo.isSymbolicLink() && (await isDirectory(livePath))) {
        const hasConflict = await mergeBackupDirectory(livePath, backupPath);
        if (hasConflict)
            await quarantineStagedEntry(transactionDir, livePath, backupPath);
        return;
    }
    // A concurrent writer recreated the path with an incompatible type. Keep its
    // entry live and move the staged original outside transaction cleanup so
    // neither side is overwritten and later controller operations can proceed.
    await quarantineStagedEntry(transactionDir, livePath, backupPath);
}
async function restoreStagedEntry(liveRoot, backupRoot, rel) {
    const live = path.join(liveRoot, rel);
    const backup = backupRoot && path.join(backupRoot, rel);
    await rm(live, { recursive: true, force: true });
    if (backup === null || !(await lstat(backup).catch(() => null)))
        return;
    await copyStagedEntry(backup, live);
}
async function undoSyncedDirectory(transactionDir, livePath, backupPath, expectedFiles) {
    for (const rel of await listAllFiles(livePath)) {
        const target = path.join(livePath, rel);
        const current = await readFile(target).catch(() => null);
        const expected = expectedFiles.get(rel);
        if (current === null || expected === undefined || !current.equals(expected))
            continue;
        await restoreStagedEntry(livePath, backupPath, rel);
    }
    // Sync can prune files that an older managed-files manifest owned. Restore
    // missing staged entries with their type and metadata, but never overwrite a
    // path another writer recreated.
    const hasConflict = await mergeBackupDirectory(livePath, backupPath);
    if (hasConflict && backupPath !== null) {
        await quarantineStagedEntry(transactionDir, livePath, backupPath);
    }
    if ((await readdir(livePath).catch(() => [])).length === 0) {
        await rm(livePath, { recursive: true, force: true });
    }
}
async function restore(targets, transactionDir, manifest) {
    // Nothing was converged yet, so the live tree is already the pre-save state.
    if (manifest.phase === "capturing")
        return;
    const expectedByName = new Map();
    const claimedQuarantines = new Set();
    for (const entry of manifest.entries) {
        const backup = resolveBackupPath(transactionDir, entry.backupPath);
        if (backup !== null && !(await lstat(backup).catch(() => null))) {
            // Atomic rename leaves either the live path or its stage. If neither is
            // present, an external actor deleted it; there is nothing this
            // transaction can restore. Other captured entries still need rollback.
            if (entry.kind === "delete")
                continue;
            const quarantined = await findQuarantinedEntry(transactionDir, entry.livePath, backup, claimedQuarantines);
            if (quarantined !== null) {
                claimedQuarantines.add(quarantined);
                continue;
            }
            throw new Error(`Skills transaction backup is missing: ${backup}`);
        }
        if (entry.kind === "delete") {
            await restoreDeletedDirectory(transactionDir, entry.livePath, backup);
            continue;
        }
        const liveInfo = await lstat(entry.livePath).catch(() => null);
        if (liveInfo !== null && !(await isDirectory(entry.livePath))) {
            // Add/update rollback has the same conflict state as delete rollback. A
            // recreated file or file symlink belongs to the external writer; preserve
            // it, and preserve any captured original outside transaction cleanup.
            if (backup !== null) {
                await quarantineStagedEntry(transactionDir, entry.livePath, backup);
            }
            continue;
        }
        const backupInfo = backup && (await lstat(backup).catch(() => null));
        if (backupInfo && !backupInfo.isDirectory()) {
            if (liveInfo !== null && (await isDirectory(entry.livePath))) {
                // The captured file was replaced by a directory after the transaction
                // started. Preserve the external tree and quarantine the captured entry
                // instead of recursively deleting the replacement during recovery.
                await quarantineStagedEntry(transactionDir, entry.livePath, backup);
                continue;
            }
            await restoreStagedEntry(entry.livePath, backup, ".");
            continue;
        }
        const name = path.basename(entry.livePath);
        let expected = expectedByName.get(name);
        if (!expected) {
            expected = await expectedSyncedFiles(targets.sourceDir, name);
            expectedByName.set(name, expected);
        }
        await undoSyncedDirectory(transactionDir, entry.livePath, backup, expected);
    }
}
function transactionParents(targets) {
    return [
        ...new Set([targets.agentsDir, targets.claudeDir, targets.codexDir].map((root) => path.dirname(root))),
    ];
}
/**
 * Finishes what an interrupted save started. A transaction directory only exists
 * while a save is mid-flight, so finding one means the process died between
 * mutating the directories and committing the selection — the staged copies are
 * the only place the user's files still exist. Restore them, then drop the
 * transaction. Anything without our manifest is left where it is.
 */
export async function recoverInterruptedSkillTransactions(targets, committedSelection) {
    for (const parent of transactionParents(targets)) {
        const entries = await readdir(parent).catch(() => []);
        for (const entry of entries) {
            if (!entry.startsWith(TRANSACTION_PREFIX))
                continue;
            const transactionDir = path.join(parent, entry);
            const manifest = await readManifest(transactionDir);
            if (!manifest)
                continue;
            if (!(await validateEntries(targets, transactionDir, manifest.entries)))
                continue;
            if (selectionsEqual(committedSelection, manifest.nextSelection)) {
                await discardTransaction(transactionDir, manifest.entries);
                continue;
            }
            if (!selectionsEqual(committedSelection, manifest.previousSelection)) {
                throw new Error(`Cannot safely recover interrupted skills transaction at ${transactionDir}`);
            }
            await restore(targets, transactionDir, manifest);
            await discardTransaction(transactionDir, manifest.entries);
        }
    }
}
/**
 * Captures the managed skill directories so a failed save can put the machine
 * back exactly as it was — including files the user added inside them, which
 * re-running an install cannot reconstruct.
 */
export async function beginSkillsTransaction(targets, previousSelection, nextSelection, ops) {
    const roots = [targets.agentsDir, targets.claudeDir, targets.codexDir];
    const seenRoots = new Set();
    const uniqueRoots = [];
    for (const [rootIndex, root] of roots.entries()) {
        const identity = await realpath(root).catch(() => path.resolve(root));
        if (seenRoots.has(identity))
            continue;
        seenRoots.add(identity);
        uniqueRoots.push({ root, rootIndex });
    }
    // Staged next to the skills tree rather than inside it: same filesystem, so a
    // restore is a local copy, and never a directory a skill scan walks into.
    const transactionDir = path.join(path.dirname(roots[0]), `${TRANSACTION_PREFIX}${randomUUID()}`);
    const entries = [];
    async function discard() {
        await discardTransaction(transactionDir, entries);
    }
    await mkdir(transactionDir, { recursive: true });
    await writeManifest(transactionDir, {
        owner: MANIFEST_OWNER,
        version: 1,
        phase: "capturing",
        previousSelection,
        nextSelection,
        entries: [],
    });
    try {
        for (const { root, rootIndex } of uniqueRoots) {
            for (const op of ops) {
                const name = op.name;
                const livePath = path.join(root, name);
                const liveInfo = await lstat(livePath).catch(() => null);
                if (liveInfo === null) {
                    entries.push({ livePath, kind: op.kind, backupPath: null });
                    continue;
                }
                const liveIsDirectory = await isDirectory(livePath);
                const backupPath = op.kind === "delete"
                    ? path.join(root, path.basename(transactionDir), name)
                    : path.join(BACKUP_DIRNAME, String(rootIndex), name);
                if (op.kind !== "delete") {
                    const captureSource = liveInfo.isSymbolicLink() && liveIsDirectory ? await realpath(livePath) : livePath;
                    const captureInfo = await lstat(captureSource);
                    await cp(captureSource, resolveBackupPath(transactionDir, backupPath), {
                        recursive: captureInfo.isDirectory(),
                        preserveTimestamps: true,
                        verbatimSymlinks: true,
                    });
                }
                entries.push({ livePath, kind: op.kind, backupPath });
            }
        }
        await writeManifest(transactionDir, {
            owner: MANIFEST_OWNER,
            version: 1,
            phase: "converging",
            previousSelection,
            nextSelection,
            entries,
        });
    }
    catch (error) {
        // Nothing has been converged yet, so failing to stage means failing the save
        // before it touches anything.
        await discard();
        throw error;
    }
    try {
        // Each delete is staged inside its own skills root, so rename stays atomic
        // even when the agent homes are symlinks or mounts on different filesystems.
        // Any writer
        // holding the old directory keeps writing into the staged inode; any writer
        // recreating the old path remains live and is merged on rollback. The later
        // convergence plan deliberately omits deletes.
        for (const entry of entries) {
            if (entry.kind !== "delete" || entry.backupPath === null)
                continue;
            const backup = resolveBackupPath(transactionDir, entry.backupPath);
            await mkdir(path.dirname(backup), { recursive: true });
            await rename(entry.livePath, backup);
        }
    }
    catch (error) {
        await restore(targets, transactionDir, {
            owner: MANIFEST_OWNER,
            version: 1,
            phase: "converging",
            previousSelection,
            nextSelection,
            entries,
        });
        await discard();
        throw error;
    }
    return {
        commit: discard,
        async rollback() {
            await restore(targets, transactionDir, {
                owner: MANIFEST_OWNER,
                version: 1,
                phase: "converging",
                previousSelection,
                nextSelection,
                entries,
            });
            await discard();
        },
    };
}
//# sourceMappingURL=transaction.js.map