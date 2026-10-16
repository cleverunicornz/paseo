export class RewindCapabilityError extends Error {
    constructor(mode) {
        super(`Provider does not support rewinding ${mode}`);
        this.name = "RewindCapabilityError";
    }
}
export async function invokeRewindCapability(session, input) {
    switch (input.mode) {
        case "conversation":
            if (!session.capabilities.supportsRewindConversation || !session.revertConversation) {
                throw new RewindCapabilityError(input.mode);
            }
            await session.revertConversation({ messageId: input.messageId });
            return;
        case "files":
            if (!session.capabilities.supportsRewindFiles || !session.revertFiles) {
                throw new RewindCapabilityError(input.mode);
            }
            await session.revertFiles({ messageId: input.messageId });
            return;
        case "both":
            if (!session.capabilities.supportsRewindBoth || !session.revertBoth) {
                throw new RewindCapabilityError(input.mode);
            }
            await session.revertBoth({ messageId: input.messageId });
            return;
    }
}
//# sourceMappingURL=rewind.js.map