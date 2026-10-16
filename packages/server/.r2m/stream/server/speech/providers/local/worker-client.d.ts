import { EventEmitter } from "node:events";
import { Readable } from "node:stream";
import type pino from "pino";
import type { SpeechStreamResult, SpeechToTextProvider, StreamingTranscriptionSession, TextToSpeechProvider } from "../../speech-provider.js";
import type { TurnDetectionProvider, TurnDetectionSession } from "../../turn-detection-provider.js";
import type { LocalSpeechSessionKind, LocalSpeechTranscriptionResult, LocalSpeechWorkerConfig, LocalSpeechWorkerRequest, LocalSpeechWorkerToParentMessage } from "./worker-protocol.js";
interface LocalSpeechWorkerProcess {
    connected: boolean;
    killed: boolean;
    pid?: number;
    stderr?: Readable | null;
    send(message: LocalSpeechWorkerRequest, callback: (error: Error | null) => void): boolean;
    disconnect(): void;
    kill(): boolean;
    on(event: "message", listener: (message: LocalSpeechWorkerToParentMessage) => void): this;
    on(event: "close", listener: (code: number | null, signal: NodeJS.Signals | null) => void): this;
}
interface LocalSpeechWorkerClientOptions {
    config: LocalSpeechWorkerConfig;
    logger: pino.Logger;
    requestTimeoutMs?: number;
    idleTtlMs?: number;
    forkWorker?: () => LocalSpeechWorkerProcess;
}
export declare class LocalSpeechWorkerClient {
    private readonly config;
    private readonly logger;
    private readonly requestTimeoutMs;
    private readonly idleTtlMs;
    private readonly forkWorker;
    private readonly pendingRequests;
    private readonly activeSessionIds;
    private readonly sessionEmitters;
    private worker;
    private workerPid;
    private stderrTail;
    private stderrLineBuffer;
    private inFlightRequests;
    private idleTimer;
    private readonly intentionalWorkerCloses;
    constructor(options: LocalSpeechWorkerClientOptions);
    synthesizeSpeech(text: string): Promise<SpeechStreamResult>;
    transcribeVoice(audio: Buffer, format: string): Promise<LocalSpeechTranscriptionResult>;
    createSession(kind: LocalSpeechSessionKind, emitter: EventEmitter): Promise<{
        sessionId: string;
        requiredSampleRate: number;
    }>;
    appendSessionAudio(sessionId: string, audio: Buffer): void;
    commitSession(sessionId: string): void;
    clearSession(sessionId: string): void;
    flushSession(sessionId: string): void;
    resetSession(sessionId: string): void;
    closeSession(sessionId: string): void;
    shutdown(): void;
    private sendRequest;
    private ensureWorker;
    private handleWorkerStderr;
    private handleWorkerMessage;
    private handleWorkerExit;
    private describePendingRequests;
    private getStderrTail;
    private rejectAllPending;
    private emitSessionError;
    private emitErrorIfObserved;
    private scheduleIdleShutdownIfReady;
    private clearIdleTimer;
}
export declare class WorkerBackedTextToSpeechProvider implements TextToSpeechProvider {
    private readonly client;
    constructor(client: LocalSpeechWorkerClient);
    synthesizeSpeech(text: string): Promise<SpeechStreamResult>;
}
export declare class WorkerBackedSpeechToTextProvider implements SpeechToTextProvider {
    private readonly client;
    private readonly kind;
    readonly id: "local";
    constructor(client: LocalSpeechWorkerClient, kind: Extract<LocalSpeechSessionKind, "voiceStt" | "dictationStt">);
    createSession(_params: {
        logger: pino.Logger;
        language?: string;
        prompt?: string;
    }): StreamingTranscriptionSession;
}
export declare class WorkerBackedTurnDetectionProvider implements TurnDetectionProvider {
    private readonly client;
    readonly id: "local";
    constructor(client: LocalSpeechWorkerClient);
    createSession(_params: {
        logger: pino.Logger;
    }): TurnDetectionSession;
}
export {};
//# sourceMappingURL=worker-client.d.ts.map