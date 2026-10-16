import { randomBytes } from "node:crypto";
import { mkdir, readFile, readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { StoredScheduleSchema, } from "@getpaseo/protocol/schedule/types";
import { writeJsonFileAtomic } from "../atomic-file.js";
function generateScheduleId() {
    return randomBytes(4).toString("hex");
}
function canonicalize(value) {
    if (Array.isArray(value)) {
        return value.map(canonicalize);
    }
    if (value && typeof value === "object") {
        const source = value;
        return Object.fromEntries(Object.keys(source)
            .sort()
            .map((key) => [key, canonicalize(source[key])]));
    }
    return value;
}
function normalizeScheduleName(name) {
    const trimmed = name.trim();
    if (!trimmed) {
        throw new Error("Schedule name is required");
    }
    return trimmed;
}
function normalizeOptionalScheduleName(name) {
    if (name === null) {
        return null;
    }
    const trimmed = name.trim();
    return trimmed ? trimmed : null;
}
function targetIdentity(target) {
    if (target.type === "agent") {
        return {
            type: target.type,
            agentId: target.agentId,
        };
    }
    return {
        type: target.type,
        config: target.config,
    };
}
function nameTargetIdentityKey(name, target) {
    return JSON.stringify(canonicalize({
        name: normalizeScheduleName(name),
        target: targetIdentity(target),
    }));
}
function matchesNameAndTarget(schedule, name, target) {
    const scheduleName = normalizeOptionalScheduleName(schedule.name);
    return (schedule.status !== "completed" &&
        scheduleName !== null &&
        scheduleName === normalizeScheduleName(name) &&
        nameTargetIdentityKey(scheduleName, schedule.target) === nameTargetIdentityKey(name, target));
}
function parseStoredSchedule(content) {
    let json;
    try {
        json = JSON.parse(content);
    }
    catch (error) {
        return { success: false, error };
    }
    return StoredScheduleSchema.safeParse(json);
}
export class ScheduleStore {
    constructor(dir, logger) {
        this.dir = dir;
        this.logger = logger;
        this.scheduleMutations = new Map();
        this.identityMutations = new Map();
        this.reportedInvalidFiles = new Set();
    }
    filePath(id) {
        return join(this.dir, `${id}.json`);
    }
    async ensureDir() {
        await mkdir(this.dir, { recursive: true });
    }
    // The service lists schedules on every tick, so a file that is not a valid schedule is
    // reported when it first appears rather than once per second.
    async list() {
        await this.ensureDir();
        const entries = await readdir(this.dir, { withFileTypes: true });
        const files = await Promise.all(entries
            .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
            .map(async (entry) => {
            const filePath = join(this.dir, entry.name);
            return { filePath, parsed: parseStoredSchedule(await readFile(filePath, "utf-8")) };
        }));
        const schedules = [];
        const invalidFiles = new Set();
        for (const { filePath, parsed } of files) {
            if (parsed.success) {
                schedules.push(parsed.data);
                continue;
            }
            invalidFiles.add(filePath);
            if (!this.reportedInvalidFiles.has(filePath)) {
                this.logger.error({ err: parsed.error, filePath }, "Skipping invalid schedule file");
            }
        }
        this.reportedInvalidFiles = invalidFiles;
        return schedules.sort((left, right) => left.createdAt.localeCompare(right.createdAt));
    }
    async get(id) {
        await this.ensureDir();
        try {
            const content = await readFile(this.filePath(id), "utf-8");
            return StoredScheduleSchema.parse(JSON.parse(content));
        }
        catch (error) {
            if (error.code === "ENOENT") {
                return null;
            }
            throw error;
        }
    }
    async create(schedule) {
        const created = StoredScheduleSchema.parse({ ...schedule, id: generateScheduleId() });
        await this.write(created);
        return created;
    }
    async update(id, updater) {
        return this.serializeScheduleMutation(id, async () => {
            const current = await this.get(id);
            if (!current) {
                return null;
            }
            const next = await updater(current);
            if (next === current) {
                return current;
            }
            if (next.id !== id) {
                throw new Error(`Schedule update cannot change id: ${id}`);
            }
            const updated = StoredScheduleSchema.parse(next);
            await this.write(updated);
            return updated;
        });
    }
    async upsertByNameAndTarget(name, target, options) {
        const identity = nameTargetIdentityKey(name, target);
        return this.serializeIdentityMutation(identity, async () => {
            while (true) {
                const existing = (await this.list()).find((schedule) => matchesNameAndTarget(schedule, name, target));
                if (!existing) {
                    const created = StoredScheduleSchema.parse({
                        ...(await options.create()),
                        id: generateScheduleId(),
                    });
                    if (!matchesNameAndTarget(created, name, target)) {
                        throw new Error("Created schedule does not match requested identity");
                    }
                    await this.write(created);
                    return created;
                }
                const updated = await this.updateMatchedSchedule(existing.id, name, target, options.update);
                if (updated) {
                    return updated;
                }
            }
        });
    }
    async write(schedule) {
        await this.ensureDir();
        await writeJsonFileAtomic(this.filePath(schedule.id), schedule);
    }
    async delete(id) {
        await this.serializeScheduleMutation(id, async () => {
            await this.ensureDir();
            await rm(this.filePath(id), { force: true });
        });
    }
    async serializeScheduleMutation(scheduleId, mutation) {
        return this.serializeMutation(this.scheduleMutations, scheduleId, mutation);
    }
    async serializeIdentityMutation(identity, mutation) {
        return this.serializeMutation(this.identityMutations, identity, mutation);
    }
    async serializeMutation(promises, key, mutation) {
        const previous = promises.get(key) ?? Promise.resolve();
        const next = previous.catch(() => undefined).then(mutation);
        promises.set(key, next);
        try {
            return await next;
        }
        finally {
            if (promises.get(key) === next) {
                promises.delete(key);
            }
        }
    }
    async updateMatchedSchedule(id, name, target, updater) {
        return this.serializeScheduleMutation(id, async () => {
            const current = await this.get(id);
            if (!current || !matchesNameAndTarget(current, name, target)) {
                return null;
            }
            const next = await updater(current);
            if (next.id !== id) {
                throw new Error(`Schedule update cannot change id: ${id}`);
            }
            const updated = StoredScheduleSchema.parse(next);
            if (!matchesNameAndTarget(updated, name, target)) {
                throw new Error("Updated schedule does not match requested identity");
            }
            await this.write(updated);
            return updated;
        });
    }
}
//# sourceMappingURL=store.js.map