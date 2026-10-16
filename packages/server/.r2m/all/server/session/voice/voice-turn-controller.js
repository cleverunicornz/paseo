import { Buffer } from "node:buffer";
import { v4 as uuidv4 } from "uuid";
import { Pcm16MonoResampler } from "../../agent/pcm16-resampler.js";
import { parsePcmRateFromFormat } from "../../speech/audio.js";
const VOICE_FINAL_TRANSCRIPT_TIMEOUT_MS = 10000;
const FILLER_PARTIAL_WORDS = new Set([
    "uh",
    "um",
    "ah",
    "eh",
    "er",
    "hmm",
    "mm",
    "mmm",
    "mhm",
    "huh",
    "uhhuh",
    "uh-huh",
    "oh",
]);
function isFillerOnlyPartial(transcript) {
    const tokens = transcript
        .toLowerCase()
        .replace(/[^\p{L}\p{N}\s'-]/gu, "")
        .split(/\s+/)
        .filter(Boolean);
    if (tokens.length === 0) {
        return true;
    }
    return tokens.every((token) => FILLER_PARTIAL_WORDS.has(token));
}
export function createVoiceTurnController(params) {
    const detector = params.turnDetection.createSession({
        logger: params.logger.child({ component: "turn-detection" }),
    });
    let state = { status: "idle" };
    let resampler = null;
    let sttSession = null;
    let sttResampler = null;
    let inputRate = detector.requiredSampleRate;
    let sttInputRate = 0;
    let queued = Promise.resolve();
    let activeTranscriptSegmentId = null;
    let partialTranscriptFired = false;
    let reconnectAttemptedForTurn = false;
    const sealedTranscriptSegmentIds = new Set();
    let currentFinalizingTurn = null;
    function fail(error) {
        params.callbacks.onError(error instanceof Error ? error : new Error(String(error)));
    }
    function firePartialTranscript(segmentId, transcript) {
        if (partialTranscriptFired || state.status !== "capturing") {
            return;
        }
        partialTranscriptFired = true;
        void runSerial(async () => {
            await params.callbacks.onPartialTranscript({ segmentId, transcript });
        });
    }
    function clearFinalizingTurnTimeout() {
        if (currentFinalizingTurn) {
            clearTimeout(currentFinalizingTurn.timeout);
        }
    }
    function getFinalizingTurnForSegment(segmentId) {
        if (!currentFinalizingTurn) {
            return null;
        }
        if (currentFinalizingTurn.committedSegmentIds.includes(segmentId)) {
            return currentFinalizingTurn;
        }
        if (currentFinalizingTurn.committedSegmentIds.length > 0) {
            return null;
        }
        if (activeTranscriptSegmentId && activeTranscriptSegmentId !== segmentId) {
            return null;
        }
        return currentFinalizingTurn;
    }
    function getOrderedFinalSegmentIds(turn) {
        if (turn.committedSegmentIds.length === 0) {
            return [...turn.finalTranscriptSegmentIds];
        }
        return turn.committedSegmentIds.filter((segmentId) => turn.finalTranscriptSegmentIds.has(segmentId));
    }
    function assembleFinalTranscript(turn) {
        const orderedFinalSegmentIds = getOrderedFinalSegmentIds(turn);
        const transcript = orderedFinalSegmentIds
            .map((segmentId) => turn.transcriptsBySegmentId.get(segmentId)?.trim() ?? "")
            .filter((segment) => segment.length > 0)
            .join(" ")
            .trim();
        const orderedFinalMeta = orderedFinalSegmentIds
            .map((segmentId) => turn.transcriptMetaBySegmentId.get(segmentId))
            .filter((meta) => Boolean(meta));
        const language = orderedFinalMeta.find((meta) => meta.language)?.language;
        const singleSegmentMeta = orderedFinalMeta.length === 1 ? orderedFinalMeta[0] : null;
        const allLowConfidence = orderedFinalMeta.length > 0 &&
            orderedFinalMeta.every((meta) => meta.isLowConfidence === true);
        return {
            segmentId: turn.committedSegmentIds[0] ?? orderedFinalSegmentIds[0] ?? turn.turnId,
            transcript,
            ...(language ? { language } : {}),
            ...(singleSegmentMeta?.avgLogprob !== undefined
                ? { avgLogprob: singleSegmentMeta.avgLogprob }
                : {}),
            ...(allLowConfidence ? { isLowConfidence: true } : {}),
            durationMs: Math.max(0, Date.now() - turn.startedAt),
        };
    }
    function fireFinalTranscript(turn, reason) {
        if (turn.fired || currentFinalizingTurn?.turnId !== turn.turnId) {
            return;
        }
        turn.fired = true;
        clearTimeout(turn.timeout);
        currentFinalizingTurn = null;
        const finalTranscript = assembleFinalTranscript(turn);
        if (reason === "timeout") {
            params.logger.warn({
                turnId: turn.turnId,
                committedSegments: turn.committedSegmentIds.length,
                receivedFinals: turn.finalTranscriptSegmentIds.size,
                timeoutMs: VOICE_FINAL_TRANSCRIPT_TIMEOUT_MS,
                transcriptLength: finalTranscript.transcript.length,
            }, "voice_turn.final_transcript_timeout");
        }
        void runSerial(async () => {
            await params.callbacks.onFinalTranscript(finalTranscript);
        });
    }
    function maybeFireFinalTranscript(turn) {
        if (turn.fired || turn.committedSegmentIds.length === 0) {
            return;
        }
        const allCommittedSegmentsFinal = turn.committedSegmentIds.every((segmentId) => turn.finalTranscriptSegmentIds.has(segmentId));
        if (allCommittedSegmentsFinal) {
            fireFinalTranscript(turn, "complete");
        }
    }
    async function reconnectSttSession() {
        const previousSession = sttSession;
        sttSession = null;
        sttResampler = null;
        sttInputRate = 0;
        previousSession?.close();
        try {
            const nextSession = createSttSession();
            await nextSession.connect();
            sttSession = nextSession;
            params.logger.info("voice_turn.stt_reconnected");
        }
        catch (error) {
            fail(error);
            params.logger.warn({ err: error }, "voice_turn.stt_reconnect_failed");
        }
    }
    function handleSttError(error) {
        fail(error);
        params.logger.warn({ err: error }, "voice_turn.stt_error");
        if (reconnectAttemptedForTurn) {
            sttSession?.close();
            sttSession = null;
            return;
        }
        reconnectAttemptedForTurn = true;
        void runSerial(reconnectSttSession);
    }
    function handleFinalSttTranscript(event) {
        const turn = getFinalizingTurnForSegment(event.segmentId);
        if (!turn || turn.fired) {
            return;
        }
        turn.transcriptsBySegmentId.set(event.segmentId, event.transcript);
        turn.finalTranscriptSegmentIds.add(event.segmentId);
        turn.transcriptMetaBySegmentId.set(event.segmentId, {
            ...(event.language ? { language: event.language } : {}),
            ...(event.avgLogprob !== undefined ? { avgLogprob: event.avgLogprob } : {}),
            ...(event.isLowConfidence !== undefined ? { isLowConfidence: event.isLowConfidence } : {}),
        });
        maybeFireFinalTranscript(turn);
    }
    function handlePartialSttTranscript(event) {
        if (state.status !== "capturing" || partialTranscriptFired) {
            return;
        }
        if (sealedTranscriptSegmentIds.has(event.segmentId)) {
            return;
        }
        if (activeTranscriptSegmentId && event.segmentId !== activeTranscriptSegmentId) {
            return;
        }
        const transcript = event.transcript.trim();
        if (!transcript) {
            return;
        }
        activeTranscriptSegmentId = event.segmentId;
        if (isFillerOnlyPartial(transcript)) {
            return;
        }
        firePartialTranscript(event.segmentId, transcript);
    }
    function handleSttTranscript(event) {
        if (event.isFinal) {
            handleFinalSttTranscript(event);
            return;
        }
        handlePartialSttTranscript(event);
    }
    function createSttSession() {
        const session = params.stt.createSession({
            logger: params.logger.child({ component: "stt" }),
            language: params.sttLanguage ?? "en",
        });
        session.on("transcript", handleSttTranscript);
        session.on("committed", ({ segmentId }) => {
            sealedTranscriptSegmentIds.add(segmentId);
            if (state.status === "capturing" && !activeTranscriptSegmentId) {
                activeTranscriptSegmentId = segmentId;
            }
            const turn = currentFinalizingTurn;
            if (turn && !turn.committedSegmentIds.includes(segmentId)) {
                turn.committedSegmentIds.push(segmentId);
                maybeFireFinalTranscript(turn);
            }
        });
        session.on("error", handleSttError);
        return session;
    }
    function runSerial(task) {
        queued = queued.then(task).catch((error) => {
            fail(error);
        });
        return queued;
    }
    function updateDetectorResampler(parsedInputRate) {
        if (parsedInputRate === inputRate) {
            return;
        }
        inputRate = parsedInputRate;
        resampler =
            inputRate === detector.requiredSampleRate
                ? null
                : new Pcm16MonoResampler({
                    inputRate,
                    outputRate: detector.requiredSampleRate,
                });
    }
    function updateSttResampler(session, parsedInputRate) {
        if (parsedInputRate === sttInputRate) {
            return;
        }
        sttInputRate = parsedInputRate;
        sttResampler =
            sttInputRate === session.requiredSampleRate
                ? null
                : new Pcm16MonoResampler({
                    inputRate: sttInputRate,
                    outputRate: session.requiredSampleRate,
                });
    }
    function pcmForDetector(pcm16) {
        return resampler === null ? pcm16 : resampler.processChunk(pcm16);
    }
    function pcmForStt(session, pcm16, detectorPcm16) {
        if (session.requiredSampleRate === detector.requiredSampleRate) {
            return detectorPcm16;
        }
        if (sttResampler === null) {
            return pcm16;
        }
        return sttResampler.processChunk(pcm16);
    }
    async function handleSpeechStarted() {
        if (state.status === "capturing") {
            return;
        }
        await params.callbacks.onSpeechStarted();
        const startedAt = Date.now();
        activeTranscriptSegmentId = null;
        partialTranscriptFired = false;
        reconnectAttemptedForTurn = false;
        clearFinalizingTurnTimeout();
        currentFinalizingTurn = null;
        state = {
            status: "capturing",
            utteranceId: uuidv4(),
            startedAt,
        };
        params.logger.info({
            utteranceId: state.utteranceId,
        }, "voice_turn.speech_started");
    }
    async function handleSpeechStopped() {
        if (state.status !== "capturing") {
            return;
        }
        const turnId = state.utteranceId;
        const startedAt = state.startedAt;
        const endedAt = Date.now();
        state = { status: "listening" };
        const finalizingTurn = {
            turnId,
            startedAt,
            committedSegmentIds: [],
            transcriptsBySegmentId: new Map(),
            finalTranscriptSegmentIds: new Set(),
            transcriptMetaBySegmentId: new Map(),
            timeout: setTimeout(() => {
                fireFinalTranscript(finalizingTurn, "timeout");
            }, VOICE_FINAL_TRANSCRIPT_TIMEOUT_MS),
            fired: false,
        };
        currentFinalizingTurn = finalizingTurn;
        detector.reset();
        try {
            sttSession?.commit();
        }
        catch (error) {
            handleSttError(error);
        }
        await params.callbacks.onSpeechStopped();
        params.logger.info({
            utteranceAgeMs: Math.max(0, endedAt - startedAt),
        }, "voice_turn.speech_stopped");
    }
    detector.on("speech_started", () => {
        void runSerial(handleSpeechStarted);
    });
    detector.on("speech_stopped", () => {
        void runSerial(handleSpeechStopped);
    });
    detector.on("error", fail);
    return {
        async start() {
            sttSession = createSttSession();
            await sttSession.connect();
            await detector.connect();
            state = { status: "listening" };
        },
        async stop() {
            await runSerial(async () => {
                clearFinalizingTurnTimeout();
                detector.close();
                sttSession?.close();
                resampler?.reset();
                sttResampler?.reset();
                resampler = null;
                sttResampler = null;
                sttSession = null;
                currentFinalizingTurn = null;
                state = { status: "idle" };
            });
        },
        async appendClientChunk(input) {
            await runSerial(async () => {
                if (state.status === "idle") {
                    return;
                }
                const pcm16 = Buffer.from(input.audioBase64, "base64");
                if (pcm16.length === 0) {
                    return;
                }
                const parsedInputRate = parsePcmRateFromFormat(input.format, detector.requiredSampleRate) ??
                    detector.requiredSampleRate;
                updateDetectorResampler(parsedInputRate);
                const currentSttSession = sttSession;
                if (currentSttSession) {
                    updateSttResampler(currentSttSession, parsedInputRate);
                }
                const detectorPcm16 = pcmForDetector(pcm16);
                const sttPcm16 = currentSttSession
                    ? pcmForStt(currentSttSession, pcm16, detectorPcm16)
                    : null;
                if (detectorPcm16.length === 0 && (!sttPcm16 || sttPcm16.length === 0)) {
                    return;
                }
                if (detectorPcm16.length > 0) {
                    detector.appendPcm16(detectorPcm16);
                }
                if (sttPcm16 && sttPcm16.length > 0) {
                    try {
                        currentSttSession?.appendPcm16(sttPcm16);
                    }
                    catch (error) {
                        handleSttError(error);
                    }
                }
            });
        },
    };
}
//# sourceMappingURL=voice-turn-controller.js.map