import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { defineSettings, settingsRpc } from "@getpaseo/plugin";
const envelopeSchema = z.object({ version: z.number().int().positive(), values: z.json() });
function message(error) {
    if (error instanceof z.ZodError)
        return error.issues.map((issue) => issue.message).join("\n");
    return error instanceof Error ? error.message : String(error);
}
const revisionOf = (raw) => createHash("sha256").update(raw).digest("hex");
function reportListenerError(id, error) {
    console.error(`Plugin settings subscriber failed for ${id}`, error);
}
function copySettingsState(state) {
    if (state.status === "invalid")
        return { ...state };
    return { ...state, values: structuredClone(state.values) };
}
/** One instance per installation. The subprocess lifetime gives writes a single owner. */
export class PluginSettingsStore {
    constructor(directory, changed) {
        this.definitions = new Map();
        this.queue = Promise.resolve();
        this.directory = directory;
        this.changed = changed;
    }
    register(definition) {
        defineSettings(definition);
        if (this.definitions.has(definition.id))
            throw new Error(`Duplicate settings: ${definition.id}`);
        this.definitions.set(definition.id, definition);
        const listeners = new Set();
        const notify = (state) => {
            for (const listener of listeners) {
                try {
                    void Promise.resolve(listener(copySettingsState(state))).catch((error) => reportListenerError(definition.id, error));
                }
                catch (error) {
                    reportListenerError(definition.id, error);
                }
            }
        };
        const rpc = settingsRpc(definition.id);
        const read = () => this.serial(() => this.read(definition, notify));
        const write = (input) => this.serial(() => this.write(definition, input.revision, input.values, "save", notify));
        const reset = (input) => this.serial(() => this.write(definition, input.revision, {}, "reset", notify));
        const settings = {
            read,
            subscribe(listener) {
                listeners.add(listener);
                return () => {
                    listeners.delete(listener);
                };
            },
        };
        return {
            settings,
            read: { contract: rpc.read, handle: read },
            write: { contract: rpc.write, handle: write },
            reset: { contract: rpc.reset, handle: reset },
        };
    }
    serial(work) {
        const pending = this.queue.then(work);
        this.queue = pending.catch(() => undefined);
        return pending;
    }
    async stored(id) {
        try {
            const raw = await readFile(path.join(this.directory, `${id}.json`), "utf8");
            return { raw, revision: revisionOf(raw) };
        }
        catch (error) {
            if (error && typeof error === "object" && "code" in error && error.code === "ENOENT")
                return { raw: null, revision: "missing" };
            throw error;
        }
    }
    async read(definition, notify) {
        const stored = await this.stored(definition.id);
        try {
            const envelope = stored.raw === null ? null : envelopeSchema.parse(JSON.parse(stored.raw));
            let values = envelope?.values ?? {};
            if (envelope && envelope.version !== definition.version) {
                if (envelope.version > definition.version)
                    throw new Error("Settings were saved by a newer plugin version");
                if (!definition.migrate)
                    throw new Error(`Settings version ${envelope.version} requires a migration`);
                values = await definition.migrate(values, envelope.version);
            }
            const parsed = await definition.schema.parseAsync(values);
            z.json().parse(parsed);
            const migrated = envelope !== null && envelope.version !== definition.version;
            const revision = migrated ? await this.persist(definition, parsed) : stored.revision;
            const result = {
                status: "ready",
                values: parsed,
                revision,
            };
            if (migrated) {
                notify(result);
                this.changed(definition.id);
            }
            return result;
        }
        catch (error) {
            return { status: "invalid", revision: stored.revision, error: message(error) };
        }
    }
    async write(definition, revision, values, intent, notify) {
        const stored = await this.stored(definition.id);
        if (stored.revision !== revision)
            return {
                status: "conflict",
                error: "Settings changed on another client. Reload before saving again.",
            };
        let parsed;
        try {
            if (intent === "save" && stored.raw !== null) {
                const envelope = envelopeSchema.parse(JSON.parse(stored.raw));
                if (envelope.version !== definition.version)
                    throw new Error("Reload or reset settings before saving a different schema version");
            }
            parsed = await definition.schema.parseAsync(values);
            z.json().parse(parsed);
        }
        catch (error) {
            return { status: "invalid", error: message(error) };
        }
        const nextRevision = await this.persist(definition, parsed);
        notify({ status: "ready", values: parsed, revision: nextRevision });
        this.changed(definition.id);
        return { status: "saved", values: parsed, revision: nextRevision };
    }
    async persist(definition, values) {
        const jsonValues = z.json().parse(values);
        await mkdir(this.directory, { recursive: true });
        const target = path.join(this.directory, `${definition.id}.json`);
        const temporary = `${target}.${randomUUID()}.tmp`;
        const raw = JSON.stringify({ version: definition.version, values: jsonValues });
        try {
            await writeFile(temporary, raw, { mode: 0o600 });
            await rename(temporary, target);
        }
        finally {
            await rm(temporary, { force: true });
        }
        return revisionOf(raw);
    }
}
//# sourceMappingURL=index.js.map