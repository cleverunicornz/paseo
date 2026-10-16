import { runGitCommand } from "../utils/run-git-command.js";
export async function fetchWorkspaceGitRemote(cwd, observer, run = runGitCommand) {
    let before = null;
    let after = null;
    let error = null;
    try {
        before = await readWorkspaceGitRefs(cwd, run);
        observer.onRefSnapshot("before");
    }
    catch (caught) {
        error = caught;
    }
    try {
        await run(["fetch", "origin", "--prune"], {
            cwd,
            envOverlay: { GIT_TERMINAL_PROMPT: "0" },
            timeout: 120000,
        });
    }
    catch (caught) {
        error ?? (error = caught);
    }
    try {
        after = await readWorkspaceGitRefs(cwd, run);
    }
    catch (caught) {
        error ?? (error = caught);
    }
    if (!before || !after) {
        return { changes: null, error };
    }
    const diff = diffWorkspaceGitRefs(before, after);
    const result = {
        changes: diff.remoteChanges,
        nonRemoteRefsChanged: diff.nonRemoteRefsChanged,
        remoteRefs: collectWorkspaceGitRemoteRefs(after),
        error,
    };
    observer.onRefSnapshot("after");
    return result;
}
function collectWorkspaceGitRemoteRefs(refs) {
    const remotePrefix = "refs/remotes/";
    return new Set([...refs.keys()]
        .filter((ref) => ref.startsWith(remotePrefix))
        .map((ref) => ref.slice(remotePrefix.length)));
}
async function readWorkspaceGitRefs(cwd, run) {
    const { stdout } = await run(["for-each-ref", "--format=%(refname)%00%(objectname)"], {
        cwd,
    });
    return parseWorkspaceGitRefs(stdout);
}
export function parseWorkspaceGitRefs(stdout) {
    const refs = new Map();
    for (const line of stdout.split("\n")) {
        const [ref, objectId] = line.split("\0");
        if (ref?.startsWith("refs/") && objectId) {
            refs.set(ref, objectId);
        }
    }
    return refs;
}
export function diffWorkspaceGitRefs(before, after) {
    const remotePrefix = "refs/remotes/";
    const beforeRemote = new Map();
    const afterRemote = new Map();
    let nonRemoteRefsChanged = false;
    for (const [ref, objectId] of before) {
        if (ref.startsWith(remotePrefix)) {
            beforeRemote.set(ref.slice(remotePrefix.length), objectId);
        }
        else if (after.get(ref) !== objectId) {
            nonRemoteRefsChanged = true;
        }
    }
    for (const [ref, objectId] of after) {
        if (ref.startsWith(remotePrefix)) {
            afterRemote.set(ref.slice(remotePrefix.length), objectId);
        }
        else if (!before.has(ref)) {
            nonRemoteRefsChanged = true;
        }
    }
    return {
        remoteChanges: diffWorkspaceGitRemoteRefs(beforeRemote, afterRemote),
        nonRemoteRefsChanged,
    };
}
export function diffWorkspaceGitRemoteRefs(before, after) {
    const changes = [];
    for (const [ref, objectId] of after) {
        const beforeOid = before.get(ref);
        if (beforeOid === undefined) {
            changes.push({ kind: "added", ref, afterOid: objectId });
        }
        else if (beforeOid !== objectId) {
            changes.push({ kind: "moved", ref, beforeOid, afterOid: objectId });
        }
    }
    for (const [ref, beforeOid] of before) {
        if (!after.has(ref)) {
            changes.push({ kind: "deleted", ref, beforeOid });
        }
    }
    return changes;
}
//# sourceMappingURL=workspace-git-fetch.js.map