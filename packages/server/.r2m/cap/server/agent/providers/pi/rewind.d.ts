export interface PiRewindNavigator {
    navigateTree(targetId: string): Promise<unknown>;
}
export declare function revertPiConversation(input: {
    messageId: string;
    navigator: PiRewindNavigator;
}): Promise<void>;
//# sourceMappingURL=rewind.d.ts.map