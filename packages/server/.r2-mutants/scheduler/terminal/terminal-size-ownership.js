const terminalSizeOwners = new WeakMap();
export function applyTerminalSize(terminal, owner, request) {
    const intent = resolveTerminalSizeIntent(request.intent);
    if (intent === "update" && terminalSizeOwners.get(terminal)?.deref() !== owner) {
        return false;
    }
    if (intent === "claim") {
        terminalSizeOwners.set(terminal, new WeakRef(owner));
    }
    const currentSize = terminal.getSize();
    if (currentSize.rows !== request.rows || currentSize.cols !== request.cols) {
        terminal.send({ type: "resize", rows: request.rows, cols: request.cols });
    }
    return true;
}
function resolveTerminalSizeIntent(intent) {
    if (intent) {
        return intent;
    }
    // COMPAT(terminalSizeOwnership): added in v0.2.6, remove after 2027-02-02 once the client floor sends resize intent.
    return "claim";
}
//# sourceMappingURL=terminal-size-ownership.js.map