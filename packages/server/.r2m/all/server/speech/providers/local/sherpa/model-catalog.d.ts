import { z } from "zod";
export type SherpaOnnxModelKind = "stt-offline" | "tts";
type DefaultModelRole = "stt" | "tts";
interface SherpaOnnxCatalogEntry {
    kind: SherpaOnnxModelKind;
    archiveUrl: string;
    extractedDir: string;
    requiredFiles: string[];
    description: string;
    defaultFor?: DefaultModelRole;
}
export declare const SHERPA_ONNX_MODEL_CATALOG: {
    readonly "parakeet-tdt-0.6b-v2-int8": {
        readonly kind: "stt-offline";
        readonly archiveUrl: "https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-nemo-parakeet-tdt-0.6b-v2-int8.tar.bz2";
        readonly extractedDir: "sherpa-onnx-nemo-parakeet-tdt-0.6b-v2-int8";
        readonly requiredFiles: ["encoder.int8.onnx", "decoder.int8.onnx", "joiner.int8.onnx", "tokens.txt"];
        readonly description: "NVIDIA Parakeet TDT v2 (offline NeMo transducer, English).";
        readonly defaultFor: "stt";
    };
    readonly "parakeet-tdt-0.6b-v3-int8": {
        readonly kind: "stt-offline";
        readonly archiveUrl: "https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-nemo-parakeet-tdt-0.6b-v3-int8.tar.bz2";
        readonly extractedDir: "sherpa-onnx-nemo-parakeet-tdt-0.6b-v3-int8";
        readonly requiredFiles: ["encoder.int8.onnx", "decoder.int8.onnx", "joiner.int8.onnx", "tokens.txt"];
        readonly description: "NVIDIA Parakeet TDT v3 (offline NeMo transducer, 25 European languages, auto-detected).";
    };
    readonly "kokoro-en-v0_19": {
        readonly kind: "tts";
        readonly archiveUrl: "https://github.com/k2-fsa/sherpa-onnx/releases/download/tts-models/kokoro-en-v0_19.tar.bz2";
        readonly extractedDir: "kokoro-en-v0_19";
        readonly requiredFiles: ["model.onnx", "voices.bin", "tokens.txt", "espeak-ng-data"];
        readonly description: "Kokoro TTS (higher quality; larger).";
        readonly defaultFor: "tts";
    };
};
export type SherpaOnnxModelId = keyof typeof SHERPA_ONNX_MODEL_CATALOG;
export type LocalSpeechModelId = SherpaOnnxModelId;
type ModelIdByKind<K extends SherpaOnnxModelKind> = {
    [Id in SherpaOnnxModelId]: (typeof SHERPA_ONNX_MODEL_CATALOG)[Id]["kind"] extends K ? Id : never;
}[SherpaOnnxModelId];
export type LocalSttModelId = ModelIdByKind<"stt-offline">;
export type LocalTtsModelId = ModelIdByKind<"tts">;
export declare const LOCAL_STT_MODEL_IDS: LocalSttModelId[];
export declare const LOCAL_TTS_MODEL_IDS: LocalTtsModelId[];
export declare const DEFAULT_LOCAL_STT_MODEL: LocalSttModelId;
export declare const DEFAULT_LOCAL_TTS_MODEL: "kokoro-en-v0_19";
export declare const LocalSttModelIdSchema: z.ZodType<LocalSttModelId, string, z.core.$ZodTypeInternals<LocalSttModelId, string>>;
export declare const LocalTtsModelIdSchema: z.ZodType<"kokoro-en-v0_19", string, z.core.$ZodTypeInternals<"kokoro-en-v0_19", string>>;
export type SherpaOnnxModelSpec = SherpaOnnxCatalogEntry & {
    id: SherpaOnnxModelId;
};
export declare function listSherpaOnnxModels(): SherpaOnnxModelSpec[];
export declare function getSherpaOnnxModelSpec(id: SherpaOnnxModelId): SherpaOnnxModelSpec;
export {};
//# sourceMappingURL=model-catalog.d.ts.map