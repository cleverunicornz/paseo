import type { Logger } from "pino";
import type { TurnDetectionProvider, TurnDetectionSession } from "../../../turn-detection-provider.js";
import { type SherpaSileroVadSessionConfig } from "./silero-vad-session.js";
/**
 * Ensure the Silero VAD ONNX model exists in modelsDir where native code can
 * read it. The bundled asset lives inside Electron's app.asar which native C++
 * cannot open, so we copy it out on first run using Node.js fs (asar-aware).
 */
export declare function ensureSileroVadModel(modelsDir: string, logger: Logger): Promise<string>;
export declare class SherpaSileroTurnDetectionProvider implements TurnDetectionProvider {
    readonly id: "local";
    private readonly config;
    private readonly logger;
    constructor(config: SherpaSileroVadSessionConfig, logger: Logger);
    createSession(params: {
        logger: Logger;
    }): TurnDetectionSession;
}
//# sourceMappingURL=silero-vad-provider.d.ts.map