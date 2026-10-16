// OOM backstop for a socket whose client stopped draining. A daemon normally has
// 1-10 physical sockets (tens at the outside), so 64 MiB bounds abandoned queues
// without treating ordinary large frames as a protocol or frame-size violation.
export const MAX_PHYSICAL_SOCKET_BUFFERED_BYTES = 64 * 1024 * 1024;
// Current clients ping every 10 seconds. Four delayed cycles fit inside the
// lease without making an abandoned application socket linger for minutes.
export const APPLICATION_SOCKET_LEASE_MS = 45000;
export const APPLICATION_SOCKET_LEASE_CHECK_INTERVAL_MS = 10000;
export class ApplicationSocketLease {
    constructor(clock = Date.now) {
        this.clock = clock;
        this.deadlines = new Map();
    }
    claim(socket) {
        this.deadlines.set(socket, this.clock() + APPLICATION_SOCKET_LEASE_MS);
    }
    renew(socket) {
        if (this.deadlines.has(socket)) {
            this.claim(socket);
        }
    }
    release(socket) {
        this.deadlines.delete(socket);
    }
    listExpired() {
        const now = this.clock();
        const expired = [];
        for (const [socket, deadline] of this.deadlines) {
            if (deadline > now)
                continue;
            expired.push(socket);
        }
        return expired;
    }
    clear() {
        this.deadlines.clear();
    }
}
export function outboundFrameByteLength(data) {
    if (typeof data === "string")
        return Buffer.byteLength(data);
    return data.byteLength;
}
export async function sendBoundedPhysicalFrameAndWait(params) {
    const { socket, frame, frameBytes = outboundFrameByteLength(frame), onHighWater } = params;
    if (socket.readyState !== 1)
        return false;
    if (!physicalSocketHasCapacity(socket, frameBytes)) {
        onHighWater();
        return false;
    }
    await new Promise((resolve, reject) => {
        let callbackUsed = false;
        const result = socket.send(frame, (error) => {
            callbackUsed = true;
            if (error)
                reject(error);
            else
                resolve();
        });
        if (result && typeof result.then === "function") {
            result.then(resolve, reject);
        }
        else if (socket.send.length < 2 && !callbackUsed) {
            resolve();
        }
    });
    return true;
}
export function physicalSocketHasCapacity(socket, frameBytes) {
    if (typeof socket.bufferedAmount !== "number")
        return true;
    return socket.bufferedAmount + frameBytes <= MAX_PHYSICAL_SOCKET_BUFFERED_BYTES;
}
export function sendBoundedPhysicalFrame(params) {
    const { socket, frame, frameBytes = outboundFrameByteLength(frame), onHighWater } = params;
    if (socket.readyState !== 1)
        return false;
    if (!physicalSocketHasCapacity(socket, frameBytes)) {
        onHighWater();
        return false;
    }
    const result = socket.send(frame);
    if (result && typeof result.then === "function") {
        void result.catch(() => undefined);
    }
    return true;
}
//# sourceMappingURL=physical-socket.js.map