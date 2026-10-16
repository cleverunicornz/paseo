import type { OmpAgentMessage } from "./rpc-types.js";
type OmpCustomMessage = Extract<OmpAgentMessage, {
    role: "custom";
}>;
export declare function shouldDisplayOmpCustomMessage(message: OmpCustomMessage): boolean;
export declare function ompCustomMessageId(message: OmpCustomMessage, nextIndex: () => number): string;
export declare function ompSkillPromptUserText(message: OmpCustomMessage): string | null;
export {};
//# sourceMappingURL=custom-message.d.ts.map