import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { isLegacyCodexCopy, listFilesRecursive, readManagedFilesManifest, removeSkill, syncSkills, } from "./sync.js";
// Names the bundle used to ship. They are never selectable, but every scan still
// covers them so an older install's copies get cleaned up.
export const LEGACY_SKILL_NAMES = [
    "paseo-chat",
    "paseo-epic",
    "paseo-orchestrate",
    "paseo-orchestrator",
];
/**
 * The bundle directory is the catalog. Reading it instead of a hardcoded list is
 * what makes `all` pick up skills added in a later release with no code change.
 */
async function listBundledSkills(sourceDir) {
    const entries = await fs.readdir(sourceDir, { withFileTypes: true }).catch(() => []);
    return entries
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name)
        .sort(compareStrings);
}
/** Every name Paseo owns on disk: what it ships now plus what it used to ship. */
function managedSkillNames(available) {
    return [...new Set([...available, ...LEGACY_SKILL_NAMES])].sort(compareStrings);
}
/** The names a convergence may create, replace, or delete. */
export async function listManagedSkillNames(sourceDir) {
    return managedSkillNames(await listBundledSkills(sourceDir));
}
function resolveDesiredSkills(selection, available) {
    if (selection.mode === "all")
        return new Set(available);
    const chosen = new Set(selection.skills);
    return new Set(available.filter((name) => chosen.has(name)));
}
async function hashSkillDir(skillDir) {
    const stat = await fs.stat(skillDir).catch(() => null);
    if (!stat?.isDirectory())
        return null;
    const rels = await listFilesRecursive(skillDir);
    const files = new Map();
    for (const rel of rels) {
        const buf = await fs.readFile(path.join(skillDir, rel));
        const sha = createHash("sha256").update(buf).digest("hex");
        files.set(toPosix(rel), sha);
    }
    return files;
}
async function hashSkills(rootDir, names) {
    const out = new Map();
    for (const name of names) {
        const files = await hashSkillDir(path.join(rootDir, name));
        if (files !== null)
            out.set(name, files);
    }
    return out;
}
function diff(bundle, disks, names, desired) {
    const ops = [];
    for (const name of names) {
        const b = desired.has(name) ? bundle.get(name) : undefined;
        const targetFiles = disks.map((disk) => disk.get(name));
        const installedTargets = targetFiles.filter((files) => files !== undefined);
        if (b) {
            const missingTargets = installedTargets.length < disks.length;
            const changedTargets = installedTargets.some((files) => !bundleFilesMatch(b, files));
            if (missingTargets)
                ops.push({ kind: "add", name });
            else if (changedTargets)
                ops.push({ kind: "update", name });
        }
        else if (installedTargets.length > 0) {
            ops.push({ kind: "delete", name });
        }
    }
    ops.sort((a, b) => compareStrings(a.name, b.name));
    return ops;
}
function hasInstalledPaseoSkill(disks) {
    return disks.some((disk) => disk.size > 0);
}
function installedSkillNames(disks, names) {
    return names.filter((name) => disks.some((disk) => disk.has(name)));
}
function bundleFilesMatch(bundle, disk) {
    for (const [rel, sha] of bundle) {
        if (disk.get(rel) !== sha)
            return false;
    }
    return true;
}
function toPosix(p) {
    return p.split(path.sep).join("/");
}
function compareStrings(a, b) {
    if (a < b)
        return -1;
    if (a > b)
        return 1;
    return 0;
}
export async function getSkillsStatus(targets, selection) {
    const available = await listBundledSkills(targets.sourceDir);
    const names = managedSkillNames(available);
    const [bundle, agentsDisk, claudeDisk, codexDisk] = await Promise.all([
        hashSkills(targets.sourceDir, available),
        hashSkills(targets.agentsDir, names),
        hashSkills(targets.claudeDir, names),
        hashSkills(targets.codexDir, names),
    ]);
    const disks = [agentsDisk, claudeDisk];
    const desired = resolveDesiredSkills(selection, available);
    const ops = diff(bundle, disks, names, desired);
    for (const name of codexDisk.keys()) {
        if (ops.some((op) => op.name === name))
            continue;
        if (!(await isLegacyCodexCopy(name, targets)))
            continue;
        if (!desired.has(name))
            ops.push({ kind: "delete", name });
        else if (await readManagedFilesManifest(path.join(targets.codexDir, name))) {
            ops.push({ kind: "update", name });
        }
    }
    ops.sort((a, b) => compareStrings(a.name, b.name));
    const allDisks = [...disks, codexDisk];
    const installed = installedSkillNames(allDisks, names);
    if (!hasInstalledPaseoSkill(allDisks))
        return { state: "not-installed", ops, available, installed };
    if (ops.length === 0)
        return { state: "up-to-date", ops, available, installed };
    return { state: "drift", ops, available, installed };
}
async function applySkills(targets, selection, initialStatus) {
    const status = initialStatus ?? (await getSkillsStatus(targets, selection));
    const writes = status.ops
        .filter((op) => op.kind === "add" || op.kind === "update")
        .map((op) => op.name);
    if (writes.length > 0) {
        await syncSkills({
            sourceDir: targets.sourceDir,
            agentsDir: targets.agentsDir,
            claudeDir: targets.claudeDir,
            codexDir: targets.codexDir,
            skillNames: writes,
        });
    }
    for (const op of status.ops) {
        if (op.kind !== "delete")
            continue;
        await removeSkill(op.name, {
            agentsDir: targets.agentsDir,
            claudeDir: targets.claudeDir,
            codexDir: targets.codexDir,
        });
    }
    return getSkillsStatus(targets, selection);
}
export async function installSkills(targets, selection, 
/** Apply exactly this plan instead of rescanning, so a confirmed plan is the applied plan. */
plan) {
    return applySkills(targets, selection, plan);
}
export async function updateSkills(targets, selection) {
    const status = await getSkillsStatus(targets, selection);
    return applySkills(targets, selection, nonDestructivePlan(status));
}
function nonDestructivePlan(status) {
    return { ...status, ops: status.ops.filter((op) => op.kind !== "delete") };
}
export async function autoUpdateInstalledSkills(targets, selection) {
    const status = await getSkillsStatus(targets, selection);
    if (status.state !== "drift")
        return status;
    // Automatic maintenance may repair selected skills, but removal is an
    // interactive operation because managed directories can contain user files.
    return applySkills(targets, selection, nonDestructivePlan(status));
}
export async function uninstallSkills(targets, selection) {
    const available = await listBundledSkills(targets.sourceDir);
    for (const name of managedSkillNames(available)) {
        await removeSkill(name, {
            agentsDir: targets.agentsDir,
            claudeDir: targets.claudeDir,
            codexDir: targets.codexDir,
        });
    }
    return getSkillsStatus(targets, selection);
}
//# sourceMappingURL=operations.js.map