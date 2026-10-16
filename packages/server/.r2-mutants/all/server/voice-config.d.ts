export declare function stripVoiceModeSystemPrompt(existing?: string): string | undefined;
export declare function buildVoiceModeSystemPrompt(existing: string | undefined, enabled: boolean): string;
export declare function wrapSpokenInput(text: string): string;
export declare function buildVoiceAgentMcpServerConfig(params: {
    command: string;
    baseArgs: string[];
    socketPath: string;
    env?: Record<string, string>;
}): {
    type: "stdio";
    command: string;
    args: string[];
    env?: Record<string, string>;
};
//# sourceMappingURL=voice-config.d.ts.map