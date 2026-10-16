import type pino from "pino";
import { type SherpaOnnxModelId } from "./model-catalog.js";
export interface EnsureSherpaOnnxModelOptions {
    modelsDir: string;
    modelId: SherpaOnnxModelId;
    logger: pino.Logger;
    signal?: AbortSignal;
}
export declare function getSherpaOnnxModelDir(modelsDir: string, modelId: SherpaOnnxModelId): string;
export declare function isSherpaOnnxModelInstalled(modelsDir: string, modelId: SherpaOnnxModelId): Promise<boolean>;
export declare function ensureSherpaOnnxModel(options: EnsureSherpaOnnxModelOptions): Promise<string>;
export declare function ensureSherpaOnnxModels(options: {
    modelsDir: string;
    modelIds: SherpaOnnxModelId[];
    logger: pino.Logger;
    signal?: AbortSignal;
}): Promise<Record<SherpaOnnxModelId, string>>;
//# sourceMappingURL=model-downloader.d.ts.map