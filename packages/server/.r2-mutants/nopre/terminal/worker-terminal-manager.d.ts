import type { TerminalManager } from "./terminal-manager.js";
import type { TerminalWorkerRequest, TerminalWorkerToParentMessage } from "./terminal-worker-protocol.js";
interface TerminalWorkerProcess {
    connected: boolean;
    killed: boolean;
    send(message: TerminalWorkerRequest, callback: (error: Error | null) => void): boolean;
    disconnect(): void;
    kill(): boolean;
    on(event: "message", listener: (message: TerminalWorkerToParentMessage) => void): this;
    on(event: "exit", listener: (code: number | null, signal: NodeJS.Signals | null) => void): this;
}
interface WorkerTerminalManagerOptions {
    requestTimeoutMs?: number;
    forkWorker?: () => TerminalWorkerProcess;
    getTerminalActivityUrl?: () => string | null;
}
export declare function createWorkerTerminalManager(managerOptions?: WorkerTerminalManagerOptions): TerminalManager;
export declare function terminateWorkerTerminalManager(manager: TerminalManager): void;
export {};
//# sourceMappingURL=worker-terminal-manager.d.ts.map