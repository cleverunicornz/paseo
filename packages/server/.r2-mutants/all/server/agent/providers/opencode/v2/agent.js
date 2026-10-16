import { OpenCodeV2Session } from "./session.js";
import { V2_CAPABILITIES } from "./capabilities.js";
import { features, permissionRules, applyResumeOverrides, requiresDedicatedV2Server, } from "./configuration.js";
import { commands } from "./commands.js";
import { waitForLocationReady, awaitPaseoPlugin } from "./readiness.js";
import { createProviderEnv, } from "../../../provider-launch-config.js";
import { importSessionFromPersistence } from "../../../provider-session-import.js";
import { resolveOpenCodeHomeDir } from "../paths.js";
import { V2Runtime } from "./runtime.js";
import { modelRef, modesFromV2, modelsFromV2 } from "./mapping.js";
export class OpenCodeV2AgentClient {
    constructor(options) {
        this.options = options;
        this.provider = "opencode";
        this.connections = new Map();
        this.capabilities = { ...V2_CAPABILITIES, supportsNativePaseoTools: Boolean(options.bridge) };
        this.runtime =
            options.runtime ??
                new V2Runtime({
                    ...options,
                    decorateEnv: options.bridge ? (env) => options.bridge.decorateV2ServerEnv(env) : undefined,
                });
    }
    async isAvailable() {
        return true;
    }
    async shutdown() {
        await this.runtime.shutdown();
    }
    async fetchCatalog(options, context) {
        const connection = await this.runtime.acquire({
            fresh: options.force,
            signal: context?.signal,
        });
        const location = {
            directory: options.scope === "workspace" ? options.cwd : resolveOpenCodeHomeDir(),
        };
        const request = { signal: context?.signal };
        const activity = (name, operation) => context ? context.runActivity(name, operation) : operation();
        try {
            await activity("plugin.list", () => waitForLocationReady({ client: connection.client, location, signal: request.signal }));
            const [models, agents, providers] = await Promise.all([
                activity("model.list", () => connection.client.model.list({ location }, request)),
                activity("agent.list", () => connection.client.agent.list({ location }, request)),
                activity("provider.list", () => connection.client.provider.list({ location }, request)),
            ]);
            if (!providers.data.length)
                throw new Error("OpenCode has no connected providers. Authenticate using opencode auth login.");
            return { models: modelsFromV2(models.data), modes: modesFromV2(agents.data) };
        }
        finally {
            await connection.release();
        }
    }
    async createSession(config, launch, options) {
        const connection = await this.runtime.acquire(requiresDedicatedV2Server(config, launch) ? { env: launch?.env, dedicated: true } : {});
        try {
            const info = await connection.client.session.create({
                location: { directory: config.cwd },
                title: config.title,
                agent: config.modeId ?? "build",
                model: config.model ? modelRef(config.model, config.thinkingOptionId) : undefined,
                permissions: permissionRules(config),
            });
            return await this.attach(connection, info, config, launch, options?.persistSession !== false);
        }
        catch (error) {
            await connection.release();
            throw error;
        }
    }
    async resumeSession(handle, overrides, launch) {
        const cwd = overrides?.cwd ?? handle.metadata?.cwd;
        if (typeof cwd !== "string")
            throw new Error("OpenCode resume requires the original working directory");
        const config = {
            ...handle.metadata,
            ...overrides,
            provider: "opencode",
            cwd,
        };
        const connection = this.connections.get(handle.nativeHandle ?? handle.sessionId)?.retain() ??
            (await this.runtime.acquire(requiresDedicatedV2Server(config, launch) ? { env: launch?.env, dedicated: true } : {}));
        try {
            const info = await connection.client.session.get({
                sessionID: handle.nativeHandle ?? handle.sessionId,
            });
            await applyResumeOverrides(connection.client, info, overrides);
            return await this.attach(connection, info, config, launch, true);
        }
        catch (error) {
            await connection.release();
            throw error;
        }
    }
    async attach(connection, info, config, launch, persist) {
        const acquire = () => this.runtime.acquire(requiresDedicatedV2Server(config, launch) ? { env: launch?.env, dedicated: true } : {});
        let ownedConnection = connection;
        const unbind = this.options.bridge?.bindSession({
            sessionId: info.id,
            env: launch?.env ?? {},
            tools: launch?.paseoTools,
        });
        const bound = new Map();
        const bindChild = (childId) => {
            this.connections.set(childId, ownedConnection);
            if (bound.has(childId))
                return;
            const childUnbind = this.options.bridge?.bindSession({
                sessionId: childId,
                env: launch?.env ?? {},
                tools: launch?.paseoTools,
            });
            if (childUnbind)
                bound.set(childId, childUnbind);
        };
        this.connections.set(info.id, connection);
        const releaseBindings = () => {
            unbind?.();
            for (const cleanup of bound.values())
                cleanup();
            for (const [id, owner] of this.connections)
                if (owner === ownedConnection)
                    this.connections.delete(id);
        };
        const moved = (next) => {
            for (const [id, owner] of this.connections)
                if (owner === ownedConnection)
                    this.connections.set(id, next);
            ownedConnection = next;
        };
        const session = new OpenCodeV2Session(connection, info, config, this.options.logger, persist, Boolean(this.options.bridge), releaseBindings, bindChild, acquire, moved);
        try {
            if (this.options.bridge) {
                const location = { directory: config.cwd };
                await awaitPaseoPlugin({ client: connection.client, location });
            }
            await session.initialize(launch?.env
                ? createProviderEnv({ runtimeSettings: this.options.settings, overlays: [launch.env] })
                : undefined);
            return session;
        }
        catch (error) {
            await session.close();
            throw error;
        }
    }
    async listFeatures(config) {
        return features(config);
    }
    async listCommands(config) {
        const connection = await this.runtime.acquire();
        try {
            return await commands(connection.client, config.cwd);
        }
        finally {
            await connection.release();
        }
    }
    async listImportableSessions(options = {}) {
        const connection = await this.runtime.acquire();
        try {
            const sessions = [];
            let cursor;
            const scanLimit = Math.min(options.scanLimit ?? 100, 500);
            do {
                const page = await connection.client.session.list({
                    ...(cursor ? { cursor } : { directory: options.cwd, search: options.query }),
                    limit: Math.min(50, scanLimit - sessions.length),
                });
                sessions.push(...page.data);
                cursor = page.cursor.next ?? undefined;
            } while (cursor && sessions.length < scanLimit);
            return sessions
                .filter((info) => !info.parentID && !info.time.archived)
                .slice(0, options.limit ?? 50)
                .map((info) => ({
                providerHandleId: info.id,
                cwd: info.location.directory,
                title: info.title ?? null,
                firstPromptPreview: null,
                lastPromptPreview: null,
                lastActivityAt: new Date(info.time.updated),
            }));
        }
        finally {
            await connection.release();
        }
    }
    async importSession(input, context) {
        const connection = await this.runtime.acquire();
        try {
            const info = await connection.client.session.get({ sessionID: input.providerHandleId });
            return await importSessionFromPersistence({
                provider: "opencode",
                request: input,
                context,
                resumeSession: this.resumeSession.bind(this),
                config: {
                    title: info.title,
                    modeId: info.agent,
                    model: info.model ? `${info.model.providerID}/${info.model.id}` : undefined,
                },
            });
        }
        finally {
            await connection.release();
        }
    }
}
//# sourceMappingURL=agent.js.map