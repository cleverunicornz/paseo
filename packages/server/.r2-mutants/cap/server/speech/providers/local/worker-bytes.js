export function bufferToWorkerBytes(buffer) {
    const bytes = new Uint8Array(buffer.byteLength);
    bytes.set(buffer);
    return bytes.buffer;
}
export function workerBytesToBuffer(bytes) {
    return Buffer.from(bytes);
}
//# sourceMappingURL=worker-bytes.js.map