import { createHash, randomUUID } from "node:crypto";
import { readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { writeFileAtomic } from "../server/atomic-file.js";
import { getImageDimensions, getProjectIcon } from "./project-icon.js";
const MAX_ICON_BYTES = 512 * 1024;
const ICON_TOO_LARGE_ERROR = "Icon must be 512 KB or smaller";
// A save validates, writes bytes, and updates the registry. Two concurrent
// saves for one project would interleave those steps.
const inFlightSaves = new Map();
/**
 * The only writer of custom project icons. The client owns image acquisition;
 * this boundary accepts bytes, validates them, and replaces whatever was stored.
 */
export async function setProjectCustomIcon(input) {
    return serialize(input.projectId, async () => {
        if (!(await input.projects.get(input.projectId)))
            throw new Error("Project not found");
        let customIconRevision = null;
        if (input.source.type === "automatic") {
            await removeProjectCustomIcon(input);
        }
        else {
            const bytes = Buffer.from(input.source.data, "base64");
            validateIcon(bytes);
            await writeFileAtomic(cachePath(input.paseoHome, input.projectId), bytes);
            customIconRevision = randomUUID();
        }
        const updated = await input.projects.update(input.projectId, (current) => ({
            ...current,
            customIconRevision,
            updatedAt: new Date().toISOString(),
        }));
        if (!updated) {
            // The project was removed mid-save, so its own cleanup missed these bytes.
            await removeProjectCustomIcon(input);
            throw new Error("Project not found");
        }
        return updated;
    });
}
/** Resolves the icon a project renders with, whichever mode it is in. */
export async function readProjectIcon(input) {
    return (await readProjectIconSnapshot(input)).icon;
}
/** Keeps the icon bytes served by a session aligned with its advertised revision. */
export class ProjectIconReader {
    constructor(paseoHome) {
        this.paseoHome = paseoHome;
        this.snapshots = new Map();
    }
    async snapshot(project) {
        const snapshot = await readProjectIconSnapshot({ paseoHome: this.paseoHome, project });
        this.snapshots.set(project.projectId, snapshot);
        return snapshot;
    }
    async read(project) {
        return (this.snapshots.get(project.projectId) ?? (await this.snapshot(project))).icon;
    }
}
/** Reads the effective icon and gives that exact result a stable identity. */
export async function readProjectIconSnapshot(input) {
    if (input.project.customIconRevision) {
        let icon = null;
        try {
            icon = validateIcon(await readFile(cachePath(input.paseoHome, input.project.projectId)));
        }
        catch {
            // A missing/corrupt custom icon is itself a cacheable result until the
            // registry revision changes.
        }
        return {
            icon,
            revision: icon
                ? iconRevision("custom", icon)
                : `custom:none:${input.project.customIconRevision}`,
        };
    }
    const icon = await getProjectIcon(input.project.rootPath);
    if (!icon)
        return { icon: null, revision: "automatic:none:v1" };
    return { icon, revision: iconRevision("automatic", icon) };
}
function iconRevision(source, icon) {
    const fingerprint = createHash("sha256")
        .update(icon.mimeType)
        .update("\0")
        .update(icon.data)
        .digest("hex");
    return `${source}:${fingerprint}`;
}
export async function removeProjectCustomIcon(input) {
    await rm(cachePath(input.paseoHome, input.projectId), { force: true });
}
async function serialize(projectId, save) {
    const previous = inFlightSaves.get(projectId) ?? Promise.resolve();
    const next = previous.catch(() => undefined).then(save);
    inFlightSaves.set(projectId, next);
    try {
        return await next;
    }
    finally {
        if (inFlightSaves.get(projectId) === next)
            inFlightSaves.delete(projectId);
    }
}
function cachePath(paseoHome, projectId) {
    const key = createHash("sha256").update(projectId).digest("hex");
    return join(paseoHome, "projects", "icons", `${key}.bin`);
}
function detectMimeType(buffer) {
    if (buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
        return "image/png";
    }
    if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff)
        return "image/jpeg";
    const header = buffer.toString("ascii", 0, 6);
    if (header === "GIF87a" || header === "GIF89a")
        return "image/gif";
    if (buffer.toString("ascii", 0, 4) === "RIFF" && buffer.toString("ascii", 8, 12) === "WEBP") {
        return "image/webp";
    }
    if (buffer.length >= 22 &&
        buffer.readUInt16LE(0) === 0 &&
        buffer.readUInt16LE(2) === 1 &&
        buffer.readUInt16LE(4) > 0) {
        return "image/x-icon";
    }
    return null;
}
function validateIcon(buffer) {
    if (buffer.length === 0 || buffer.length > MAX_ICON_BYTES) {
        throw new Error(ICON_TOO_LARGE_ERROR);
    }
    const mimeType = detectMimeType(buffer);
    if (!mimeType)
        throw new Error("Unsupported or invalid icon file");
    const size = getImageDimensions(buffer, mimeType);
    if (!size || size.width <= 0 || size.width !== size.height || size.width > 1024) {
        throw new Error("Icon must be a square image up to 1024×1024");
    }
    return { data: buffer.toString("base64"), mimeType };
}
//# sourceMappingURL=project-custom-icon.js.map