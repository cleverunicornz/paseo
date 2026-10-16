export async function revertPiConversation(input) {
    const targetId = input.messageId.trim();
    if (!targetId) {
        throw new Error("Pi rewind requires a user message id");
    }
    await input.navigator.navigateTree(targetId);
}
//# sourceMappingURL=rewind.js.map