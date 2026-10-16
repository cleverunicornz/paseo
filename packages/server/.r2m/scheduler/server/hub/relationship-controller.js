import { createHash, randomBytes, randomUUID } from "node:crypto";
import { existsSync, readFileSync, renameSync, rmSync } from "node:fs";
import path from "node:path";
import { z } from "zod";
import { ensurePrivateFile, writePrivateFileAtomicSync } from "../private-files.js";
import { isDaemonPermission, parseDaemonPermissions, permissionsForLegacyHubScopes, } from "../authorization/index.js";
import { HubEnrollmentRejectedError } from "./relationship-remote.js";
import { BoundedExponentialHubRetryPolicy } from "./relationship-retry.js";
const FILE_NAME = "hub-relationship.json";
const HubOriginSchema = z
    .string()
    .url()
    .superRefine((value, context) => {
    try {
        normalizeHubUrl(value);
    }
    catch (error) {
        context.addIssue({
            code: "custom",
            message: error instanceof Error ? error.message : "Invalid Hub URL",
        });
    }
});
const DaemonPermissionsSchema = z
    .array(z.string())
    .superRefine((permissions, context) => {
    for (const permission of permissions) {
        if (!isDaemonPermission(permission)) {
            context.addIssue({ code: "custom", message: `Invalid daemon permission: ${permission}` });
        }
    }
})
    .transform(parseDaemonPermissions);
const RelationshipSchema = z.object({
    daemonId: z.string().min(1),
    idempotencyKey: z.string().min(1),
    hubOrigin: HubOriginSchema,
    createdAt: z.string(),
    permissions: DaemonPermissionsSchema,
});
const SanitizedRelationshipSchema = RelationshipSchema.omit({ idempotencyKey: true });
const CredentialSchema = z.object({ secret: z.string().min(1) });
const TransportSchema = z.object({
    kind: z.literal("direct_websocket"),
    webSocketUrl: z
        .string()
        .url()
        .refine((value) => ["ws:", "wss:"].includes(new URL(value).protocol))
        .refine((value) => new URL(value).hash === ""),
});
const PendingSchema = z.object({
    version: z.literal(2),
    state: z.literal("pending"),
    relationship: RelationshipSchema,
    credential: CredentialSchema,
    enrollment: z.object({ token: z.string().min(1) }),
    identity: z.object({ serverId: z.string().min(1), daemonPublicKey: z.string().min(1) }),
});
const ActiveSchema = z.object({
    version: z.literal(2),
    state: z.literal("active"),
    relationship: RelationshipSchema,
    credential: CredentialSchema,
    transport: TransportSchema,
});
const DisconnectingSchema = z.object({
    version: z.literal(2),
    state: z.literal("disconnecting"),
    relationship: RelationshipSchema,
    credential: CredentialSchema,
    transport: TransportSchema.optional(),
});
const RevokedSchema = z.object({
    version: z.literal(2),
    state: z.literal("revoked"),
    relationship: SanitizedRelationshipSchema,
    transport: TransportSchema.optional(),
    reason: z.string().optional(),
});
const CurrentRecordSchema = z
    .discriminatedUnion("state", [PendingSchema, ActiveSchema, DisconnectingSchema, RevokedSchema])
    .superRefine((record, context) => {
    if (!("transport" in record) || !record.transport)
        return;
    const hub = new URL(record.relationship.hubOrigin);
    const socket = new URL(record.transport.webSocketUrl);
    const expectedProtocol = hub.protocol === "https:" ? "wss:" : "ws:";
    if (socket.protocol === expectedProtocol && socket.host === hub.host)
        return;
    context.addIssue({
        code: "custom",
        path: ["transport", "webSocketUrl"],
        message: "Hub WebSocket URL must match the Hub origin",
    });
});
const RecordSchema = z.preprocess(migrateLegacyRecord, CurrentRecordSchema);
const systemClock = {
    now: () => new Date(),
    schedule(delayMs, task) {
        const timer = setTimeout(task, delayMs);
        timer.unref?.();
        return { cancel: () => clearTimeout(timer) };
    },
};
function normalizeHubUrl(value) {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
        throw new Error("Hub URL must use HTTP or HTTPS");
    }
    if (url.username || url.password) {
        throw new Error("Hub URL cannot include credentials");
    }
    if (url.search || url.hash) {
        throw new Error("Hub URL cannot include a query or fragment");
    }
    url.pathname = url.pathname.replace(/\/$/, "");
    return url.toString().replace(/\/$/, "");
}
export class HubRelationshipController {
    constructor(options) {
        this.options = options;
        this.state = "not_connected";
        this.connectedAt = null;
        this.lastError = null;
        this.socket = null;
        this.retry = null;
        this.generation = 0;
        this.enrollmentGeneration = 0;
        this.retryAttempt = 0;
        this.inFlightEnrollments = new Set();
        this.executionAgents = null;
        this.filePath = path.join(options.paseoHome, FILE_NAME);
        this.clock = options.clock ?? systemClock;
        this.retryPolicy = options.retryPolicy ?? new BoundedExponentialHubRetryPolicy();
        this.record = this.load();
        if (this.record?.state === "disconnecting") {
            // COMPAT(hubUnilateralDisconnect): added in v0.4.0, remove after 2027-02-13 once legacy records have aged out.
            this.options.logger.warn({ daemonId: this.record.relationship.daemonId }, "Removed legacy disconnecting Hub relationship during startup");
            rmSync(this.filePath, { force: true });
            this.record = null;
        }
        if (this.record?.state === "revoked") {
            this.state = "revoked";
            this.lastError = this.record.reason ?? null;
        }
        else if (this.record)
            this.state = "connecting";
    }
    async start() {
        if (this.record?.state === "active")
            this.openSocket(this.record, false);
        if (this.record?.state === "pending") {
            const enrollmentGeneration = this.beginEnrollmentAttempt();
            try {
                await this.tryEnrollment(this.record, enrollmentGeneration);
            }
            catch (error) {
                if (!(error instanceof HubEnrollmentRejectedError))
                    throw error;
                this.options.logger.warn({ statusCode: error.statusCode }, "Discarded rejected pending Hub enrollment during startup");
            }
        }
    }
    async stop() {
        const pendingExecutionCleanup = this.retireExecutionAgents();
        this.cancelLifecycle();
        this.socket?.close();
        this.socket = null;
        await pendingExecutionCleanup;
    }
    status() {
        return {
            state: this.state,
            daemonId: this.record?.relationship.daemonId ?? null,
            hubOrigin: this.record?.relationship.hubOrigin ?? null,
            permissions: this.record?.relationship.permissions.slice() ?? [],
            connectedAt: this.connectedAt,
            lastError: this.lastError,
        };
    }
    async connect(input) {
        const permissions = parseDaemonPermissions(input.permissions);
        if (this.record?.state === "pending") {
            if (normalizeHubUrl(input.hubUrl) !== this.record.relationship.hubOrigin) {
                throw new Error("A pending Hub enrollment already exists for a different Hub");
            }
            this.record = { ...this.record, enrollment: { token: input.token } };
            const enrollmentGeneration = this.beginEnrollmentAttempt();
            this.persist(this.record);
            this.state = "connecting";
            this.lastError = null;
            await this.tryEnrollment(this.record, enrollmentGeneration);
            return this.status();
        }
        if (this.record && this.record.state !== "revoked") {
            throw new Error("This daemon already has a Hub relationship");
        }
        const pending = {
            version: 2,
            state: "pending",
            relationship: {
                daemonId: this.options.createDaemonId?.() ?? randomUUID(),
                idempotencyKey: randomUUID(),
                hubOrigin: normalizeHubUrl(input.hubUrl),
                createdAt: this.clock.now().toISOString(),
                permissions,
            },
            credential: { secret: randomBytes(32).toString("base64url") },
            enrollment: { token: input.token },
            identity: { serverId: this.options.serverId, daemonPublicKey: this.options.daemonPublicKey },
        };
        this.persist(pending);
        this.record = pending;
        this.state = "connecting";
        this.lastError = null;
        await this.tryEnrollment(pending, this.beginEnrollmentAttempt());
        return this.status();
    }
    async updatePermissions(input) {
        if (!this.record || this.record.state !== "active") {
            throw new Error("This daemon is not connected to a Hub");
        }
        const grant = parseDaemonPermissions(input.grant);
        const revoke = parseDaemonPermissions(input.revoke);
        const permissions = parseDaemonPermissions([
            ...this.record.relationship.permissions.filter((permission) => !revoke.includes(permission)),
            ...grant,
        ]);
        const result = await this.options.remote.updatePermissions({
            daemonId: this.record.relationship.daemonId,
            hubOrigin: this.record.relationship.hubOrigin,
            credential: this.record.credential.secret,
            permissions,
        });
        if (!samePermissions(result.permissions, permissions)) {
            throw new Error("Hub permission response did not match the local grant");
        }
        this.record = {
            ...this.record,
            relationship: { ...this.record.relationship, permissions },
        };
        this.persist(this.record);
        this.options.updateAttachedPermissions(hubPrincipalId(this.record), permissions);
        return this.status();
    }
    async disconnect(input) {
        const waitForEnrollment = this.record?.state === "pending";
        const pendingCreateCleanup = this.retireExecutionAgents();
        this.cancelLifecycle();
        this.socket?.close();
        this.socket = null;
        if (!this.record || this.record.state === "revoked") {
            this.remove();
            await pendingCreateCleanup;
            return { status: this.status() };
        }
        const disconnecting = {
            version: 2,
            state: "disconnecting",
            relationship: this.record.relationship,
            credential: this.record.credential,
            ...(this.record.state === "active" ? { transport: this.record.transport } : {}),
        };
        this.persist(disconnecting);
        this.record = disconnecting;
        this.state = "disconnecting";
        if (waitForEnrollment && !input.force) {
            await Promise.all(this.inFlightEnrollments);
        }
        let warning;
        if (!input.force) {
            try {
                await this.options.remote.revoke({
                    daemonId: disconnecting.relationship.daemonId,
                    hubOrigin: disconnecting.relationship.hubOrigin,
                    credential: disconnecting.credential.secret,
                });
            }
            catch (error) {
                this.options.logger.warn({ err: error, daemonId: disconnecting.relationship.daemonId }, "Failed to notify Hub before removing local relationship");
                warning =
                    "Hub could not be reached; local relationship removed, but server-side revocation may remain pending.";
            }
        }
        this.remove();
        await pendingCreateCleanup;
        return { status: this.status(), ...(warning ? { warning } : {}) };
    }
    async tryEnrollment(pending, enrollmentGeneration) {
        if (enrollmentGeneration !== this.enrollmentGeneration)
            return;
        const verifier = createHash("sha256").update(pending.credential.secret).digest("base64url");
        const request = this.options.remote.enroll({
            daemonId: pending.relationship.daemonId,
            idempotencyKey: pending.relationship.idempotencyKey,
            hubOrigin: pending.relationship.hubOrigin,
            token: pending.enrollment.token,
            hostname: this.options.hostname,
            serverId: pending.identity.serverId,
            daemonPublicKey: pending.identity.daemonPublicKey,
            credentialVerifier: verifier,
            permissions: pending.relationship.permissions,
        });
        const settled = request.then(() => undefined, () => undefined);
        this.inFlightEnrollments.add(settled);
        try {
            const enrollment = await request;
            if (enrollmentGeneration !== this.enrollmentGeneration)
                return;
            if (enrollment.daemonId !== pending.relationship.daemonId ||
                !samePermissions(enrollment.permissions, pending.relationship.permissions)) {
                throw new Error("Hub enrollment response did not match the pending relationship");
            }
            const active = {
                version: 2,
                state: "active",
                relationship: pending.relationship,
                credential: pending.credential,
                transport: { kind: "direct_websocket", webSocketUrl: enrollment.webSocketUrl },
            };
            this.persist(active);
            this.record = active;
            this.retry = null;
            this.retryAttempt = 0;
            this.openSocket(active, false);
        }
        catch (error) {
            if (enrollmentGeneration !== this.enrollmentGeneration)
                return;
            if (error instanceof HubEnrollmentRejectedError) {
                this.remove();
                throw error;
            }
            this.lastError = error instanceof Error ? error.message : String(error);
            this.scheduleEnrollment(pending, enrollmentGeneration);
        }
        finally {
            this.inFlightEnrollments.delete(settled);
        }
    }
    openSocket(record, reconnecting) {
        const generation = ++this.generation;
        this.state = reconnecting ? "reconnecting" : "connecting";
        const events = {
            connected: (socket, sessionProtocol) => this.socketConnected(generation, record, socket, sessionProtocol),
            rejected: (statusCode) => this.socketRejected(generation, statusCode),
            closed: (code) => this.socketClosed(generation, record, code),
            failed: (error) => this.socketFailed(generation, record, error),
        };
        this.socket = this.options.remote.openSocket({
            daemonId: record.relationship.daemonId,
            webSocketUrl: record.transport.webSocketUrl,
            credential: record.credential.secret,
        }, events);
    }
    socketConnected(generation, record, socket, sessionProtocol) {
        if (generation !== this.generation) {
            socket.close();
            return;
        }
        this.retryAttempt = 0;
        this.state = "connected";
        this.connectedAt = this.clock.now().toISOString();
        this.lastError = null;
        void this.options.attachSocket(socket, {
            daemonId: record.relationship.daemonId,
            principalId: hubPrincipalId(record),
            permissions: record.relationship.permissions,
            agents: this.executionAgentsFor(record.relationship.daemonId),
            sessionProtocol,
        });
    }
    executionAgentsFor(daemonId) {
        if (this.executionAgents?.daemonId === daemonId)
            return this.executionAgents.value;
        const value = this.options.createExecutionAgents(daemonId);
        this.executionAgents = { daemonId, value };
        return value;
    }
    retireExecutionAgents() {
        const executionAgents = this.executionAgents;
        this.executionAgents = null;
        return executionAgents?.value.invalidateAuthority() ?? Promise.resolve();
    }
    socketRejected(generation, statusCode) {
        if (generation !== this.generation)
            return;
        this.revoke(`Hub rejected socket authentication (${statusCode})`);
    }
    socketClosed(generation, record, code) {
        if (generation !== this.generation)
            return;
        if (code === 4403) {
            this.revoke("Hub revoked this relationship");
            return;
        }
        if (this.record?.state === "active")
            this.scheduleSocket(record);
    }
    socketFailed(generation, record, error) {
        if (generation !== this.generation)
            return;
        this.lastError = error.message;
        if (this.record?.state === "active")
            this.scheduleSocket(record);
    }
    scheduleSocket(record) {
        this.state = "reconnecting";
        this.schedule(() => this.openSocket(record, true));
    }
    scheduleEnrollment(record, enrollmentGeneration) {
        if (enrollmentGeneration !== this.enrollmentGeneration)
            return;
        this.state = "reconnecting";
        this.retry?.cancel();
        const delay = this.retryPolicy.delay(this.retryAttempt++);
        this.retry = this.clock.schedule(delay, () => {
            if (enrollmentGeneration !== this.enrollmentGeneration)
                return;
            void this.tryEnrollment(record, enrollmentGeneration).catch((error) => {
                if (error instanceof HubEnrollmentRejectedError)
                    return;
                this.options.logger.error({ err: error }, "Scheduled Hub enrollment retry failed");
            });
        });
    }
    schedule(task) {
        this.retry?.cancel();
        const generation = this.generation;
        const delay = this.retryPolicy.delay(this.retryAttempt++);
        this.retry = this.clock.schedule(delay, () => {
            if (generation === this.generation)
                task();
        });
    }
    revoke(reason) {
        void this.retireExecutionAgents();
        this.cancelLifecycle();
        if (!this.record)
            return;
        const revoked = {
            version: 2,
            state: "revoked",
            relationship: {
                daemonId: this.record.relationship.daemonId,
                hubOrigin: this.record.relationship.hubOrigin,
                createdAt: this.record.relationship.createdAt,
                permissions: this.record.relationship.permissions,
            },
            transport: "transport" in this.record ? this.record.transport : undefined,
            reason,
        };
        this.persist(revoked);
        this.record = revoked;
        this.state = "revoked";
        this.lastError = reason;
    }
    cancelLifecycle() {
        ++this.generation;
        ++this.enrollmentGeneration;
        this.retry?.cancel();
        this.retry = null;
    }
    beginEnrollmentAttempt() {
        this.retry?.cancel();
        this.retry = null;
        this.retryAttempt = 0;
        return ++this.enrollmentGeneration;
    }
    persist(record) {
        writePrivateFileAtomicSync(this.filePath, `${JSON.stringify(record, null, 2)}\n`);
    }
    remove() {
        void this.retireExecutionAgents();
        this.cancelLifecycle();
        rmSync(this.filePath, { force: true });
        this.record = null;
        this.state = "not_connected";
        this.connectedAt = null;
        this.lastError = null;
    }
    load() {
        if (!existsSync(this.filePath))
            return null;
        let record;
        try {
            const raw = JSON.parse(readFileSync(this.filePath, "utf8"));
            record = RecordSchema.parse(raw);
            if (isLegacyRecord(raw))
                this.persist(record);
        }
        catch (error) {
            const quarantinePath = path.join(path.dirname(this.filePath), `hub-relationship.invalid-${this.clock.now().getTime()}-${randomUUID()}.json`);
            renameSync(this.filePath, quarantinePath);
            ensurePrivateFile(quarantinePath);
            this.options.logger.error({ err: error, quarantinePath }, "Quarantined invalid Hub relationship authority");
            return null;
        }
        ensurePrivateFile(this.filePath);
        return record;
    }
}
function hubPrincipalId(record) {
    const credentialFingerprint = createHash("sha256")
        .update(record.credential.secret)
        .digest("base64url");
    return `hub:${record.relationship.daemonId}:${credentialFingerprint}`;
}
function samePermissions(actual, expected) {
    return actual.length === expected.length && expected.every((scope) => actual.includes(scope));
}
function isLegacyRecord(value) {
    return typeof value === "object" && value !== null && Reflect.get(value, "version") === 1;
}
function migrateLegacyRecord(value) {
    if (!isLegacyRecord(value))
        return value;
    const relationship = Reflect.get(value, "relationship");
    if (typeof relationship !== "object" || relationship === null)
        return value;
    const scopes = Reflect.get(relationship, "scopes");
    if (!Array.isArray(scopes) || !scopes.every((scope) => typeof scope === "string"))
        return value;
    const { scopes: _legacyScopes, ...relationshipWithoutScopes } = relationship;
    return {
        ...value,
        version: 2,
        relationship: {
            ...relationshipWithoutScopes,
            permissions: permissionsForLegacyHubScopes(scopes),
        },
    };
}
//# sourceMappingURL=relationship-controller.js.map