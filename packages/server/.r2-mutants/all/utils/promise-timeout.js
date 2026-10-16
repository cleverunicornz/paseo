export function withTimeout(promiseOrOptions, timeoutMs, message) {
    const options = typeof timeoutMs === "number"
        ? { promise: promiseOrOptions, timeoutMs, message }
        : resolveTimeoutOptions(promiseOrOptions);
    if (typeof options.timeoutMs !== "number" || !options.message) {
        return Promise.reject(new Error("Timeout duration and message are required"));
    }
    let timeout;
    const timeoutPromise = new Promise((_, reject) => {
        timeout = setTimeout(() => reject(new Error(options.message)), options.timeoutMs);
    });
    return Promise.race([options.promise, timeoutPromise]).finally(() => {
        if (timeout) {
            clearTimeout(timeout);
        }
    });
}
function resolveTimeoutOptions(options) {
    return {
        promise: options.promise,
        timeoutMs: options.timeoutMs,
        message: `Timed out after ${options.timeoutMs}ms (${options.label})`,
    };
}
//# sourceMappingURL=promise-timeout.js.map