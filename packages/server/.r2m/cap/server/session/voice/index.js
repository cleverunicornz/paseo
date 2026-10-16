import { VoiceSession } from "./voice-session.js";
/** Audio conversations belong to their requesting socket, including bootstrap and finalization. */
export class VoiceSessions {
    constructor(options, delivery, demandChanged) {
        this.options = options;
        this.delivery = delivery;
        this.demandChanged = demandChanged;
        this.sources = new Map();
    }
    get hasDemand() {
        return [...this.sources.values()].some((source) => !source.closing);
    }
    isActiveForAgent(agentId) {
        return [...this.sources.values()].some((source) => !source.closing && source.voice.isActiveForAgent(agentId));
    }
    handleMessage(message) {
        const source = this.delivery.currentSource;
        if (!source)
            throw new Error("Voice request has no source");
        const existing = this.sources.get(source);
        if (existing?.closing)
            return existing.owner.release().then(() => this.handleMessage(message));
        const active = existing ?? this.startSource(source);
        const pending = Promise.resolve().then(() => {
            return active.closing ? undefined : this.dispatch(active.voice, message);
        });
        active.pending.add(pending);
        const finished = () => {
            active.pending.delete(pending);
            this.releaseIdle(active);
            return undefined;
        };
        void pending.then(finished, finished);
        return pending;
    }
    startSource(source) {
        const owner = this.delivery.operation(isVoiceOutput, async () => {
            active.closing = true;
            this.demandChanged();
            // Cancel input immediately; restore agent configuration after bootstrap has settled.
            try {
                active.voice.cancel();
            }
            finally {
                await Promise.allSettled(active.pending);
                await active.voice.cleanup();
            }
            if (this.sources.get(source) === active)
                this.sources.delete(source);
        });
        const active = {
            owner,
            pending: new Set(),
            closing: false,
            voice: new VoiceSession({
                ...this.options,
                host: { ...this.options.host, emit: (message) => owner.emit(message) },
                onIdle: () => this.releaseIdle(active),
            }),
        };
        this.sources.set(source, active);
        this.demandChanged();
        return active;
    }
    releaseIdle(source) {
        if (source.closing || source.pending.size > 0 || source.voice.hasDemand)
            return;
        void source.owner
            .release()
            .catch((error) => this.options.logger.error({ err: error }, "Failed to release voice source"));
    }
    async dispatch(voice, message) {
        switch (message.type) {
            case "voice_audio_chunk":
                return voice.handleAudioChunk(message);
            case "abort_request":
                return voice.handleAbort();
            case "audio_played":
                return voice.handleAudioPlayed(message.id);
            case "set_voice_mode":
                return voice.handleSetVoiceMode(message.enabled, message.agentId, message.requestId);
            case "dictation_stream_start":
                return voice.handleDictationStreamStart(message);
            case "dictation_stream_chunk":
                return voice.handleDictationChunk({
                    dictationId: message.dictationId,
                    seq: message.seq,
                    audioBase64: message.audio,
                    format: message.format,
                });
            case "dictation_stream_finish":
                return voice.handleDictationFinish(message.dictationId, message.finalSeq);
            case "dictation_stream_cancel":
                return voice.handleDictationCancel(message.dictationId);
        }
    }
}
function isVoiceOutput(message) {
    switch (message.type) {
        case "audio_output":
        case "transcription_result":
        case "voice_input_state":
        case "set_voice_mode_response":
        case "dictation_stream_ack":
        case "dictation_stream_partial":
        case "dictation_stream_final":
        case "dictation_stream_error":
        case "dictation_stream_finish_accepted":
        case "activity_log":
            return true;
        default:
            return false;
    }
}
//# sourceMappingURL=index.js.map