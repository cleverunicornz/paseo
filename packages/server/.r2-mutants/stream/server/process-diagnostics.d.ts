export interface ProcessMemoryDiagnostics {
    rss: number;
    heapTotal: number;
    heapUsed: number;
    external: number;
    arrayBuffers: number;
}
export interface ProcessDiagnostics {
    pid: number;
    ppid: number;
    uptimeSeconds: number;
    memory: ProcessMemoryDiagnostics;
}
export declare function getProcessMemoryDiagnostics(): ProcessMemoryDiagnostics;
export declare function getProcessUptimeSeconds(): number;
export declare function getProcessDiagnostics(): ProcessDiagnostics;
//# sourceMappingURL=process-diagnostics.d.ts.map