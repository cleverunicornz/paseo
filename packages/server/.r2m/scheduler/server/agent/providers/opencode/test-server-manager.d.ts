import type { OpenCodeServerAcquisition, OpenCodeServerManagerLike } from "./server-manager.js";
export interface TestOpenCodeServerAcquisition {
    kind: "current" | "new" | "dedicated" | "existing";
    env?: Record<string, string>;
    url?: string;
    released: boolean;
}
export declare class TestOpenCodeServerManager implements OpenCodeServerManagerLike {
    readonly acquisitions: TestOpenCodeServerAcquisition[];
    readonly server: {
        port: number;
        url: string;
    };
    acquireCurrent(): Promise<OpenCodeServerAcquisition>;
    acquireNew(): Promise<OpenCodeServerAcquisition>;
    acquireDedicated(env: Record<string, string>): Promise<OpenCodeServerAcquisition>;
    acquireExisting(url: string): OpenCodeServerAcquisition | null;
    private recordAcquisition;
    shutdown(): Promise<void>;
}
export declare function createTestOpenCodeServerManager(): TestOpenCodeServerManager;
//# sourceMappingURL=test-server-manager.d.ts.map