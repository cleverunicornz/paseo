import pino from "pino";
import { getLocalSpeechModelDir } from "./models.js";
import { SherpaOfflineRecognizerEngine } from "./sherpa/sherpa-offline-recognizer.js";
import { SherpaOnnxParakeetSTT } from "./sherpa/sherpa-parakeet-stt.js";
import { SherpaParakeetRealtimeTranscriptionSession } from "./sherpa/sherpa-parakeet-realtime-session.js";
import { SherpaOnnxTTS } from "./sherpa/sherpa-tts.js";
import { ensureSileroVadModel, SherpaSileroTurnDetectionProvider, } from "./sherpa/silero-vad-provider.js";
import { bufferToWorkerBytes, workerBytesToBuffer } from "./worker-bytes.js";
process.title = "Paseo Voice";
const logger = pino({
    level: process.env.PASEO_LOG_LEVEL ?? "info",
}).child({ module: "speech", component: "local-worker" });
const sttEngines = new Map();
const sttProviders = new Map();
const ttsProviders = new Map();
const sessions = new Map();
const unsubscribeBySessionId = new Map();
let ipcClosing = false;
function sendToParent(message) {
    if (ipcClosing || !process.connected || !process.send) {
        return;
    }
    try {
        process.send(message, (error) => {
            if (error) {
                ipcClosing = true;
            }
        });
    }
    catch {
        ipcClosing = true;
    }
}
function sttModelId(config, model) {
    return (model === "voice" ? config.voiceSttModel : config.dictationSttModel);
}
function ttsModelId(config) {
    return config.voiceTtsModel;
}
function sttEngineKey(config, modelId) {
    return `${config.modelsDir}:${modelId}`;
}
function ttsKey(config) {
    return [
        config.modelsDir,
        config.voiceTtsModel,
        config.voiceTtsSpeakerId ?? 0,
        config.voiceTtsSpeed ?? 1,
    ].join(":");
}
function getSttEngine(config, model) {
    const modelId = sttModelId(config, model);
    const key = sttEngineKey(config, modelId);
    const existing = sttEngines.get(key);
    if (existing) {
        return existing;
    }
    const modelDir = getLocalSpeechModelDir(config.modelsDir, modelId);
    const created = new SherpaOfflineRecognizerEngine({
        model: {
            kind: "nemo_transducer",
            encoder: `${modelDir}/encoder.int8.onnx`,
            decoder: `${modelDir}/decoder.int8.onnx`,
            joiner: `${modelDir}/joiner.int8.onnx`,
            tokens: `${modelDir}/tokens.txt`,
        },
        numThreads: 2,
        debug: 0,
    }, logger);
    sttEngines.set(key, created);
    return created;
}
function getSttProvider(config, model) {
    const modelId = sttModelId(config, model);
    const key = sttEngineKey(config, modelId);
    const existing = sttProviders.get(key);
    if (existing) {
        return existing;
    }
    const created = new SherpaOnnxParakeetSTT({ engine: getSttEngine(config, model) }, logger);
    sttProviders.set(key, created);
    return created;
}
function getTtsProvider(config) {
    const key = ttsKey(config);
    const existing = ttsProviders.get(key);
    if (existing) {
        return existing;
    }
    const modelDir = getLocalSpeechModelDir(config.modelsDir, ttsModelId(config));
    const created = new SherpaOnnxTTS({
        preset: ttsModelId(config),
        modelDir,
        speakerId: config.voiceTtsSpeakerId,
        speed: config.voiceTtsSpeed,
    }, logger);
    ttsProviders.set(key, created);
    return created;
}
function cleanupSession(sessionId) {
    const unsubscribe = unsubscribeBySessionId.get(sessionId);
    if (unsubscribe) {
        for (const fn of unsubscribe) {
            try {
                fn();
            }
            catch {
                // ignore
            }
        }
    }
    unsubscribeBySessionId.delete(sessionId);
    const session = sessions.get(sessionId);
    sessions.delete(sessionId);
    try {
        session?.close();
    }
    catch {
        // ignore
    }
}
function trackTranscriptionSession(sessionId, session) {
    session.on("committed", (payload) => {
        sendToParent({ type: "session.committed", sessionId, payload });
    });
    session.on("transcript", (payload) => {
        sendToParent({ type: "session.transcript", sessionId, payload });
    });
    session.on("error", (err) => {
        sendToParent({
            type: "session.error",
            sessionId,
            error: err instanceof Error ? err.message : String(err),
        });
    });
    unsubscribeBySessionId.set(sessionId, []);
}
function trackTurnDetectionSession(sessionId, session) {
    session.on("speech_started", () => {
        sendToParent({ type: "session.speech_started", sessionId });
    });
    session.on("speech_stopped", () => {
        sendToParent({ type: "session.speech_stopped", sessionId });
    });
    session.on("error", (err) => {
        sendToParent({
            type: "session.error",
            sessionId,
            error: err instanceof Error ? err.message : String(err),
        });
    });
    unsubscribeBySessionId.set(sessionId, []);
}
async function createSession(message) {
    cleanupSession(message.sessionId);
    if (message.kind === "vad") {
        let vadModelPath;
        try {
            vadModelPath = await ensureSileroVadModel(message.config.modelsDir, logger);
        }
        catch (err) {
            logger.warn({ err }, "Failed to provision Silero VAD model, falling back to bundled");
        }
        const provider = new SherpaSileroTurnDetectionProvider({ modelPath: vadModelPath }, logger);
        const session = provider.createSession({ logger });
        trackTurnDetectionSession(message.sessionId, session);
        await session.connect();
        sessions.set(message.sessionId, session);
        return { requiredSampleRate: session.requiredSampleRate };
    }
    const model = message.kind === "voiceStt" ? "voice" : "dictation";
    const engine = getSttEngine(message.config, model);
    const session = message.kind === "voiceStt"
        ? getSttProvider(message.config, "voice").createSession({ logger })
        : new SherpaParakeetRealtimeTranscriptionSession({ engine });
    trackTranscriptionSession(message.sessionId, session);
    await session.connect();
    sessions.set(message.sessionId, session);
    return { requiredSampleRate: session.requiredSampleRate };
}
function sendOk(requestId, result) {
    sendToParent({ type: "response", requestId, ok: true, result });
}
function handleSessionRequest(message) {
    if (message.type === "session.close") {
        cleanupSession(message.sessionId);
        sendOk(message.requestId);
        return;
    }
    const session = sessions.get(message.sessionId);
    switch (message.type) {
        case "session.append":
            session?.appendPcm16(workerBytesToBuffer(message.audio));
            break;
        case "session.commit":
            if (session && "commit" in session) {
                session.commit();
            }
            break;
        case "session.clear":
            if (session && "clear" in session) {
                session.clear();
            }
            break;
        case "session.flush":
            if (session && "flush" in session) {
                session.flush();
            }
            break;
        case "session.reset":
            if (session && "reset" in session) {
                session.reset();
            }
            break;
    }
    sendOk(message.requestId);
}
async function handleRequest(message) {
    if (message.type === "tts.synthesize") {
        const result = await getTtsProvider(message.config).synthesizeSpeech(message.text);
        const chunks = [];
        for await (const chunk of result.stream) {
            chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
        }
        sendOk(message.requestId, {
            audio: bufferToWorkerBytes(Buffer.concat(chunks)),
            format: result.format,
        });
        return;
    }
    if (message.type === "stt.transcribe") {
        const result = await getSttProvider(message.config, message.model).transcribeAudio(workerBytesToBuffer(message.audio), message.format);
        sendOk(message.requestId, result);
        return;
    }
    if (message.type === "session.create") {
        const result = await createSession(message);
        sendOk(message.requestId, result);
        return;
    }
    handleSessionRequest(message);
}
process.on("message", (message) => {
    void handleRequest(message).catch((error) => {
        sendToParent({
            type: "response",
            requestId: message.requestId,
            ok: false,
            error: error instanceof Error ? error.message : "Local speech worker request failed",
        });
    });
});
process.once("disconnect", () => {
    ipcClosing = true;
    for (const sessionId of Array.from(sessions.keys())) {
        cleanupSession(sessionId);
    }
    for (const tts of ttsProviders.values()) {
        try {
            tts.free();
        }
        catch {
            // ignore
        }
    }
    for (const engine of sttEngines.values()) {
        engine.free();
    }
});
//# sourceMappingURL=worker-process.js.map