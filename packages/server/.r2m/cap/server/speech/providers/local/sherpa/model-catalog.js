import { z } from "zod";
export const SHERPA_ONNX_MODEL_CATALOG = {
    "parakeet-tdt-0.6b-v2-int8": {
        kind: "stt-offline",
        archiveUrl: "https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-nemo-parakeet-tdt-0.6b-v2-int8.tar.bz2",
        extractedDir: "sherpa-onnx-nemo-parakeet-tdt-0.6b-v2-int8",
        requiredFiles: ["encoder.int8.onnx", "decoder.int8.onnx", "joiner.int8.onnx", "tokens.txt"],
        description: "NVIDIA Parakeet TDT v2 (offline NeMo transducer, English).",
        defaultFor: "stt",
    },
    "parakeet-tdt-0.6b-v3-int8": {
        kind: "stt-offline",
        archiveUrl: "https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-nemo-parakeet-tdt-0.6b-v3-int8.tar.bz2",
        extractedDir: "sherpa-onnx-nemo-parakeet-tdt-0.6b-v3-int8",
        requiredFiles: ["encoder.int8.onnx", "decoder.int8.onnx", "joiner.int8.onnx", "tokens.txt"],
        description: "NVIDIA Parakeet TDT v3 (offline NeMo transducer, 25 European languages, auto-detected).",
    },
    "kokoro-en-v0_19": {
        kind: "tts",
        archiveUrl: "https://github.com/k2-fsa/sherpa-onnx/releases/download/tts-models/kokoro-en-v0_19.tar.bz2",
        extractedDir: "kokoro-en-v0_19",
        requiredFiles: ["model.onnx", "voices.bin", "tokens.txt", "espeak-ng-data"],
        description: "Kokoro TTS (higher quality; larger).",
        defaultFor: "tts",
    },
};
const ALL_MODEL_IDS = Object.keys(SHERPA_ONNX_MODEL_CATALOG).filter((k) => k in SHERPA_ONNX_MODEL_CATALOG);
function isLocalSttModelId(id) {
    return SHERPA_ONNX_MODEL_CATALOG[id].kind !== "tts";
}
function isLocalTtsModelId(id) {
    return SHERPA_ONNX_MODEL_CATALOG[id].kind === "tts";
}
export const LOCAL_STT_MODEL_IDS = ALL_MODEL_IDS.filter(isLocalSttModelId);
export const LOCAL_TTS_MODEL_IDS = ALL_MODEL_IDS.filter(isLocalTtsModelId);
function resolveDefaultModelId(role) {
    const match = ALL_MODEL_IDS.find((id) => {
        const entry = SHERPA_ONNX_MODEL_CATALOG[id];
        return entry.defaultFor === role;
    });
    if (!match) {
        throw new Error(`No default model configured for role '${role}'`);
    }
    return match;
}
export const DEFAULT_LOCAL_STT_MODEL = resolveDefaultModelId("stt");
export const DEFAULT_LOCAL_TTS_MODEL = resolveDefaultModelId("tts");
function createModelIdSchema(modelIds) {
    const validIds = new Set(modelIds);
    return z
        .string()
        .trim()
        .toLowerCase()
        .refine((value) => validIds.has(value), {
        message: "Invalid model id",
    })
        .transform((value) => value);
}
export const LocalSttModelIdSchema = createModelIdSchema(LOCAL_STT_MODEL_IDS);
export const LocalTtsModelIdSchema = createModelIdSchema(LOCAL_TTS_MODEL_IDS);
export function listSherpaOnnxModels() {
    return ALL_MODEL_IDS.map((id) => Object.assign({ id }, SHERPA_ONNX_MODEL_CATALOG[id]));
}
export function getSherpaOnnxModelSpec(id) {
    const spec = SHERPA_ONNX_MODEL_CATALOG[id];
    if (!spec) {
        throw new Error(`Unknown local speech model id: ${id}`);
    }
    return {
        id,
        ...spec,
    };
}
//# sourceMappingURL=model-catalog.js.map