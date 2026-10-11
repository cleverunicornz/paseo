/**
 * A scripted Claude Code query that reports `reportedModel` in its init message,
 * whatever model it was launched with. It then either holds the turn open until
 * closed or, with `completes`, answers and completes the turn at once.
 */
export function claudeQueryReportingModel(
  reportedModel: string,
  launches: string[],
  options: { completes?: boolean } = {},
) {
  return ({ options: launch }: { options: { model?: string } }) => {
    launches.push(String(launch.model));
    const queued: Array<Record<string, unknown>> = [
      {
        type: "system",
        subtype: "init",
        session_id: "fixture-claude",
        permissionMode: "default",
        model: reportedModel,
      },
    ];
    if (options.completes) {
      queued.push(
        { type: "assistant", message: { content: "done" } },
        {
          type: "result",
          subtype: "success",
          session_id: "fixture-claude",
          usage: { input_tokens: 1, cache_read_input_tokens: 0, output_tokens: 1 },
          total_cost_usd: 0,
        },
      );
    }
    const closedRef = { value: options.completes === true };
    const waiters: Array<() => void> = [];
    const end = () => {
      closedRef.value = true;
      for (const wake of waiters.splice(0)) wake();
    };
    return {
      next: async () => {
        while (queued.length === 0 && !closedRef.value) {
          await new Promise<void>((resolve) => waiters.push(resolve));
        }
        const value = queued.shift();
        return value ? { done: false, value } : { done: true, value: undefined };
      },
      return: async () => {
        end();
        return { done: true, value: undefined };
      },
      interrupt: async () => end(),
      close: () => end(),
      applyFlagSettings: async () => undefined,
      setPermissionMode: async () => undefined,
      setModel: async () => undefined,
      supportedModels: async () => [],
      supportedCommands: async () => [],
      [Symbol.asyncIterator]() {
        return this;
      },
    };
  };
}
