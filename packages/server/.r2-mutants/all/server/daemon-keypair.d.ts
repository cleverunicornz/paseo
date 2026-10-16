import type pino from "pino";
import { type KeyPair } from "@getpaseo/relay/e2ee";
export interface DaemonKeyPairBundle {
    keyPair: KeyPair;
    publicKeyB64: string;
}
export declare function loadOrCreateDaemonKeyPair(paseoHome: string, logger?: pino.Logger): Promise<DaemonKeyPairBundle>;
//# sourceMappingURL=daemon-keypair.d.ts.map