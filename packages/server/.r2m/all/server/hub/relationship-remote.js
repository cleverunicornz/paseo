import { WebSocket } from "ws";
import { z } from "zod";
export class HubEnrollmentRejectedError extends Error {
    constructor(statusCode) {
        super(`Hub enrollment failed (${statusCode})`);
        this.statusCode = statusCode;
        this.name = "HubEnrollmentRejectedError";
    }
}
const EnrollmentResultSchema = z.object({
    daemonId: z.string(),
    permissions: z.array(z.string()),
    webSocketUrl: z
        .string()
        .url()
        .refine((value) => ["ws:", "wss:"].includes(new URL(value).protocol), {
        message: "Hub WebSocket URL must use ws or wss",
    })
        .refine((value) => new URL(value).hash === "", {
        message: "Hub WebSocket URL cannot include a fragment",
    }),
});
function ensureWebSocketMatchesHubOrigin(hubOrigin, webSocketUrl) {
    const hub = new URL(hubOrigin);
    const socket = new URL(webSocketUrl);
    const expectedProtocol = hub.protocol === "https:" ? "wss:" : "ws:";
    if (socket.protocol !== expectedProtocol || socket.host !== hub.host) {
        throw new Error("Hub WebSocket URL must match the Hub origin");
    }
}
export class DirectHubRelationshipRemote {
    constructor(options = {}) {
        this.requestTimeoutMs = options.requestTimeoutMs ?? 15000;
    }
    async enroll(input) {
        return this.withRequestTimeout(async (signal) => {
            const response = await fetch(`${input.hubOrigin}/api/daemons/enroll`, {
                method: "POST",
                headers: {
                    "content-type": "application/json",
                    authorization: `Bearer ${input.token}`,
                },
                body: JSON.stringify({
                    daemonId: input.daemonId,
                    idempotencyKey: input.idempotencyKey,
                    hostname: input.hostname,
                    serverId: input.serverId,
                    daemonPublicKey: input.daemonPublicKey,
                    credentialVerifier: input.credentialVerifier,
                    permissions: input.permissions,
                }),
                signal,
            });
            if (!response.ok) {
                if (response.status === 401 || response.status === 403) {
                    throw new HubEnrollmentRejectedError(response.status);
                }
                throw new Error(`Hub enrollment failed (${response.status})`);
            }
            const enrollment = EnrollmentResultSchema.parse(await response.json());
            ensureWebSocketMatchesHubOrigin(input.hubOrigin, enrollment.webSocketUrl);
            return enrollment;
        });
    }
    async updatePermissions(input) {
        return this.withRequestTimeout(async (signal) => {
            const response = await fetch(`${input.hubOrigin}/api/daemons/${encodeURIComponent(input.daemonId)}`, {
                method: "PATCH",
                headers: {
                    "content-type": "application/json",
                    authorization: `Bearer ${input.credential}`,
                },
                body: JSON.stringify({ permissions: input.permissions }),
                signal,
            });
            if (!response.ok)
                throw new Error(`Hub permission update failed (${response.status})`);
            return z.object({ permissions: z.array(z.string()) }).parse(await response.json());
        });
    }
    async revoke(input) {
        await this.withRequestTimeout(async (signal) => {
            const response = await fetch(`${input.hubOrigin}/api/daemons/${encodeURIComponent(input.daemonId)}`, {
                method: "DELETE",
                headers: { authorization: `Bearer ${input.credential}` },
                signal,
            });
            if (!response.ok && ![401, 403, 404].includes(response.status)) {
                throw new Error(`Hub revocation failed (${response.status})`);
            }
        });
    }
    openSocket(input, events) {
        let sessionProtocol = "legacy";
        const socket = new WebSocket(input.webSocketUrl, {
            handshakeTimeout: this.requestTimeoutMs,
            headers: {
                authorization: `Bearer ${input.credential}`,
                "x-paseo-daemon-id": input.daemonId,
                "x-paseo-session-protocol": "1",
            },
        });
        let settled = false;
        socket.once("upgrade", (response) => {
            if (response.headers["x-paseo-session-protocol"] === "1") {
                sessionProtocol = "session-v1";
            }
        });
        socket.once("open", () => {
            if (!settled)
                events.connected(socket, sessionProtocol);
        });
        socket.once("unexpected-response", (_request, response) => {
            if (settled) {
                response.destroy();
                return;
            }
            settled = true;
            response.destroy();
            socket.terminate();
            if (response.statusCode === 401 || response.statusCode === 403) {
                events.rejected(response.statusCode);
                return;
            }
            events.closed(1006);
        });
        socket.once("close", (code) => {
            if (settled)
                return;
            settled = true;
            events.closed(code);
        });
        socket.once("error", (error) => {
            if (settled)
                return;
            settled = true;
            socket.terminate();
            events.failed(error);
        });
        return socket;
    }
    async withRequestTimeout(operation) {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), this.requestTimeoutMs);
        timeout.unref?.();
        try {
            return await operation(controller.signal);
        }
        catch (error) {
            if (controller.signal.aborted)
                throw new Error("Hub request timed out", { cause: error });
            throw error;
        }
        finally {
            clearTimeout(timeout);
        }
    }
}
//# sourceMappingURL=relationship-remote.js.map