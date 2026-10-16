export function getProcessMemoryDiagnostics() {
    const memory = process.memoryUsage();
    return {
        rss: memory.rss,
        heapTotal: memory.heapTotal,
        heapUsed: memory.heapUsed,
        external: memory.external,
        arrayBuffers: memory.arrayBuffers,
    };
}
export function getProcessUptimeSeconds() {
    return Math.round(process.uptime() * 1000) / 1000;
}
export function getProcessDiagnostics() {
    return {
        pid: process.pid,
        ppid: process.ppid,
        uptimeSeconds: getProcessUptimeSeconds(),
        memory: getProcessMemoryDiagnostics(),
    };
}
//# sourceMappingURL=process-diagnostics.js.map