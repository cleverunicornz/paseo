import { structuredOutput } from "./structured-output.js";
import { randomUUID } from "node:crypto";
import { toDiagnosticErrorMessage } from "../../diagnostic-utils.js";
import { renderPromptAttachmentAsText } from "../../../prompt-attachments.js";
import { usageFromV2 } from "./mapping.js";
import { commands } from "./commands.js";
function isExecutionEvent(event) {
    return (event.type === "session.execution.started" ||
        event.type === "session.execution.succeeded" ||
        event.type === "session.execution.failed" ||
        event.type === "session.execution.interrupted");
}
export class SessionTurns {
    constructor(options) {
        this.options = options;
        this.turn = null;
        this.stopping = null;
        this.stopFailed = false;
        this.revision = 0;
        this.execution = null;
        this.sequence = 0;
        this.refresh = null;
        this.dirty = false;
        this.retryTimer = null;
    }
    get id() {
        return this.turn?.id;
    }
    get hasStructuredOutput() {
        return Boolean(this.turn?.output);
    }
    fail(error) {
        const turn = this.turn;
        if (!turn)
            return;
        this.release(turn);
        this.options.emit({
            type: "turn_failed",
            provider: "opencode",
            turnId: turn.id,
            error: toDiagnosticErrorMessage(error),
        });
    }
    release(turn) {
        this.turn = null;
        this.revision += 1;
        if (this.retryTimer)
            clearTimeout(this.retryTimer);
        this.retryTimer = null;
        turn.settle();
    }
    close() {
        if (this.turn)
            this.release(this.turn);
    }
    createTurn(submitted, accepted, output) {
        let settle;
        const completion = new Promise((resolve) => {
            settle = resolve;
        });
        const turn = {
            id: randomUUID(),
            submitted,
            completion,
            settle,
            accepted,
            output,
            requestDenied: false,
        };
        this.turn = turn;
        this.execution = null;
        this.revision += 1;
        this.options.emit({ type: "turn_started", provider: "opencode", turnId: turn.id });
        this.scheduleRecovery();
        return turn;
    }
    async startTurn(prompt, options) {
        await this.stopping;
        if (this.options.signal.aborted)
            throw new Error("OpenCode session is closed");
        if (this.turn)
            throw new Error("OpenCode session already has an active turn");
        const input = this.promptInput(prompt);
        let accept;
        const submitted = new Promise((resolve) => {
            accept = resolve;
        });
        const output = options?.outputSchema === undefined ? undefined : structuredOutput(options.outputSchema);
        const turn = this.createTurn(submitted, false, output);
        void this.submit(turn, input, accept, options);
        return { turnId: turn.id };
    }
    async submit(turn, input, accept, options) {
        try {
            await this.dispatch(input, options, turn.output);
            if (this.turn !== turn)
                return;
            turn.accepted = true;
            this.revision += 1;
            // Covers a fast execution whose terminal event preceded the admission response.
            this.requestReconciliation();
        }
        catch (error) {
            if (this.turn === turn)
                this.fail(new Error(toDiagnosticErrorMessage(error)));
        }
        finally {
            accept();
        }
    }
    observe(event) {
        if (!isExecutionEvent(event) || event.durable.seq <= this.sequence)
            return;
        this.revision += 1;
        if (event.type === "session.execution.started")
            this.observeActiveTurn();
        this.execution = event;
        this.sequence = event.durable.seq;
        this.requestReconciliation();
    }
    // OpenCode ends the execution when the user denies its permission or dismisses its question,
    // but reports the interruption as "shutdown", the same reason as an execution it will resume.
    requestDenied() {
        if (!this.turn)
            return;
        this.turn.requestDenied = true;
        this.requestReconciliation();
    }
    requestReconciliation() {
        void this.reconcile().catch((error) => this.options.reportReconciliationError(error));
    }
    // Recovery reads state; a quiet stream (including SSE comment heartbeats) is not a reason to reconnect.
    scheduleRecovery() {
        if (this.retryTimer || !this.turn || this.options.signal.aborted)
            return;
        this.retryTimer = setTimeout(() => {
            this.retryTimer = null;
            this.requestReconciliation();
        }, 5000);
        this.retryTimer.unref();
    }
    reconcile() {
        this.dirty = true;
        if (this.refresh)
            return this.refresh;
        this.refresh = Promise.resolve()
            .then(() => this.drainReconciliation())
            .finally(() => {
            this.refresh = null;
            this.scheduleRecovery();
        });
        return this.refresh;
    }
    async drainReconciliation() {
        while (this.dirty && !this.options.signal.aborted) {
            this.dirty = false;
            await this.reconcileTurn();
        }
    }
    async reconcileTurn() {
        const revision = this.revision;
        const turn = this.turn;
        const active = await this.options.client().session.active({ signal: this.options.signal });
        if (revision !== this.revision) {
            this.dirty = true;
            return;
        }
        if (active[this.options.id]) {
            this.observeActiveTurn();
            return;
        }
        if (!turn?.accepted)
            return;
        // Idle outcome survives shutdown, and /event has no replay. Recover the latest
        // durable execution even when its start or terminal was lost across reconnect.
        const execution = await this.readExecution();
        if (revision !== this.revision) {
            this.dirty = true;
            return;
        }
        if (!execution)
            return;
        this.execution = execution;
        this.sequence = execution.durable.seq;
        if (execution.type === "session.execution.started" ||
            (execution.type === "session.execution.interrupted" &&
                execution.data.reason === "shutdown" &&
                !turn.requestDenied))
            return;
        // Read the final history only after observing idle. Never turn an observation transport error into an execution failure.
        const snapshot = await this.options.reconcile();
        if (revision !== this.revision) {
            this.dirty = true;
            return;
        }
        try {
            this.finish(turn, snapshot, execution);
        }
        catch (error) {
            if (this.turn === turn)
                this.fail(new Error(toDiagnosticErrorMessage(error)));
        }
    }
    async dispatch(input, options, output) {
        const command = input.text.match(/^\/([^\s]+)(?:\s+([\s\S]*))?$/);
        if (command?.[1] === "compact" || command?.[1] === "summarize") {
            await this.options.client().session.compact({ sessionID: this.options.id });
            return;
        }
        const selected = command
            ? (await commands(this.options.client(), this.options.cwd)).find((item) => item.name === command[1])
            : undefined;
        if (selected && selected.kind !== "skill") {
            await this.options.client().session.command({
                sessionID: this.options.id,
                name: selected.name,
                text: command?.[2] ?? "",
                files: input.files,
            });
            return;
        }
        await this.options.client().session.prompt({
            sessionID: this.options.id,
            ...input,
            ...(selected?.kind === "skill"
                ? {
                    skills: [{ id: selected.name }],
                    text: command?.[2] ?? `Use the ${selected.name} skill.`,
                }
                : {}),
            metadata: {
                ...(options?.clientMessageId ? { paseoClientMessageId: options.clientMessageId } : {}),
                ...(output ? { paseoOutputSchema: output.schema } : {}),
            },
        });
    }
    finish(turn, { info, history }, execution) {
        if (execution.type === "session.execution.succeeded")
            turn.output?.assert(history);
        this.release(turn);
        if (execution.type === "session.execution.interrupted")
            this.options.emit({
                type: "turn_canceled",
                provider: "opencode",
                turnId: turn.id,
                reason: "OpenCode interrupted execution",
            });
        else if (execution.type === "session.execution.failed")
            this.options.emit({
                type: "turn_failed",
                provider: "opencode",
                turnId: turn.id,
                error: execution.data.error.message,
            });
        else
            this.options.emit({
                type: "turn_completed",
                provider: "opencode",
                turnId: turn.id,
                usage: usageFromV2(info),
            });
    }
    async readExecution() {
        let execution = this.execution;
        for await (const event of this.options
            .client()
            .session.log({ sessionID: this.options.id, follow: false, after: this.sequence }, { signal: this.options.signal })) {
            if (isExecutionEvent(event) && event.durable.seq > (execution?.durable.seq ?? this.sequence))
                execution = event;
        }
        return execution;
    }
    promptInput(prompt) {
        if (typeof prompt === "string")
            return { text: prompt, files: [] };
        const text = [];
        const files = [];
        for (const part of prompt) {
            if (part.type === "text")
                text.push(part.text);
            else if (part.type === "image")
                files.push({ uri: `data:${part.mimeType};base64,${part.data}` });
            else
                text.push(renderPromptAttachmentAsText(part));
        }
        return { text: text.join("\n"), files };
    }
    async steerActiveTurn(prompt, options) {
        if (this.turn?.id !== options.expectedTurnId || this.stopping)
            return { status: "unavailable" };
        await this.options.client().session.prompt({
            sessionID: this.options.id,
            ...this.promptInput(prompt),
            delivery: "steer",
            metadata: options.clientMessageId
                ? { paseoClientMessageId: options.clientMessageId }
                : undefined,
        });
        if (options.clearPendingPermissions)
            await this.options.clearPermissions();
        return { status: "accepted" };
    }
    async interrupt() {
        if (!this.stopping || this.stopFailed) {
            this.stopFailed = false;
            const turn = this.turn;
            const stop = (async () => {
                // A stop sent before the queued prompt is accepted would interrupt an idle session.
                await turn?.submitted;
                await this.options.client().session.interrupt({ sessionID: this.options.id });
                await this.reconcile();
                await turn?.completion;
            })();
            this.stopping = stop;
            try {
                await stop;
                this.stopping = null;
            }
            catch (error) {
                this.stopFailed = true;
                throw error;
            }
        }
        else
            await this.stopping;
    }
    observeActiveTurn() {
        if (this.turn || this.options.signal.aborted)
            return;
        this.createTurn(Promise.resolve(), true);
    }
}
//# sourceMappingURL=turns.js.map