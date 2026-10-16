import type pino from "pino";
import type { KeyPair } from "@getpaseo/relay/e2ee";
import type { ExternalSocketMetadata } from "./websocket-server.js";
import { startRelayTransport, type RelaySocketLike } from "./relay-transport.js";
export interface RelayRuntimeConfig {
    enabled: boolean;
    endpoint: string;
    publicEndpoint: string;
    useTls: boolean;
    publicUseTls: boolean;
}
interface RelayRuntimeOptions {
    config: RelayRuntimeConfig;
    logger: pino.Logger;
    attachSocket(ws: RelaySocketLike, metadata?: ExternalSocketMetadata): Promise<void>;
    serverId: string;
    daemonKeyPair: KeyPair;
    startTransport?: typeof startRelayTransport;
}
export interface RelayRuntime {
    getConfig(): RelayRuntimeConfig;
    setEnabled(enabled: boolean): void;
    stop(): Promise<void>;
}
export declare function createRelayRuntime(options: RelayRuntimeOptions): RelayRuntime;
export {};
//# sourceMappingURL=relay-runtime.d.ts.map