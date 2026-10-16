import { PiExtensionHost } from "./host.js";
import type { Logger } from "pino";
import type { PiExtension } from "./contract.js";
export declare const piExtensionRuntimeBridge: string;
export type { PiExtensionHost } from "./host.js";
export type { PiExtensionEventOutput } from "./host.js";
export declare function createPiExtensionHost(logger?: Pick<Logger, "warn">, extensions?: readonly PiExtension[], hydrationByteBudget?: number): PiExtensionHost;
//# sourceMappingURL=index.d.ts.map