import { randomUUID } from "node:crypto";
import { getAgentStreamEventTurnId } from "./agent-sdk-types.js";
export class AgentRunState {
    constructor() {
        this.runs = new Map();
    }
    createPendingRun(agentId) {
        const pendingRun = createPendingForegroundRun();
        this.runs.set(agentId, pendingRun);
        return pendingRun;
    }
    getPendingRun(agentId) {
        const run = this.runs.get(agentId);
        return run?.kind === "foreground" ? run : null;
    }
    hasPendingRun(agentId) {
        return this.getPendingRun(agentId) !== null;
    }
    getRun(agentId) {
        return this.runs.get(agentId) ?? null;
    }
    hasRun(agentId) {
        return this.runs.has(agentId);
    }
    getTurnId(agentId) {
        const run = this.runs.get(agentId);
        if (!run)
            return null;
        if (run.kind === "autonomous")
            return run.turnId;
        return run.start.status === "started" ? run.start.turnId : null;
    }
    trackAutonomousRun(agentId, turnId) {
        const current = this.runs.get(agentId);
        if (current) {
            return current;
        }
        const run = {
            ...createTrackedRunState(),
            kind: "autonomous",
            turnId,
            started: true,
        };
        this.runs.set(agentId, run);
        return run;
    }
    settleTerminalRun(agentId, turnId) {
        const run = this.runs.get(agentId);
        if (!run) {
            return;
        }
        if (run.kind === "foreground" &&
            (run.start.status !== "started" || run.start.turnId !== turnId)) {
            return;
        }
        if (run.kind === "autonomous" &&
            run.turnId !== null &&
            turnId !== undefined &&
            run.turnId !== turnId) {
            return;
        }
        this.clearRun(agentId, run);
    }
    settleForegroundRun(agentId, token) {
        const run = this.runs.get(agentId);
        if (run?.kind !== "foreground" || run.token !== token) {
            return;
        }
        this.clearRun(agentId, run);
    }
    clearAgentRun(agentId) {
        const run = this.runs.get(agentId);
        if (run) {
            this.clearRun(agentId, run);
        }
    }
    createTurnStream(turnId) {
        return new ForegroundTurnStream(turnId);
    }
    addWaiter(agent, waiter) {
        agent.foregroundTurnWaiters.add(waiter);
    }
    deleteWaiter(agent, waiter) {
        agent.foregroundTurnWaiters.delete(waiter);
        this.settleWaiter(waiter);
    }
    settleWaiter(waiter) {
        if (waiter.settled) {
            return;
        }
        waiter.settled = true;
        waiter.resolveSettled();
    }
    getMatchingWaiters(agent, turnId) {
        if (turnId == null) {
            return [];
        }
        return Array.from(agent.foregroundTurnWaiters).filter((waiter) => waiter.turnId === turnId && !waiter.settled);
    }
    notifyWaiters(waiters, event, options) {
        for (const waiter of waiters) {
            waiter.callback(event);
            if (options.terminal) {
                this.settleWaiter(waiter);
            }
        }
    }
    notifyAgentWaiters(agent, event, options) {
        const waiters = this.getMatchingWaiters(agent, getAgentStreamEventTurnId(event));
        this.notifyWaiters(waiters, event, { terminal: options?.terminal ?? false });
    }
    cancelWaiters(agent, createEvent) {
        for (const waiter of agent.foregroundTurnWaiters) {
            waiter.callback(createEvent(waiter.turnId));
            this.settleWaiter(waiter);
        }
        agent.foregroundTurnWaiters.clear();
    }
    rememberFinalizedTurn(agent, turnId) {
        agent.finalizedForegroundTurnIds.add(turnId);
        if (agent.finalizedForegroundTurnIds.size <= 50) {
            return;
        }
        const oldest = agent.finalizedForegroundTurnIds.values().next().value;
        if (oldest) {
            agent.finalizedForegroundTurnIds.delete(oldest);
        }
    }
    hasFinalizedTurn(agent, turnId) {
        return agent.finalizedForegroundTurnIds.has(turnId);
    }
    clearRun(agentId, run) {
        this.runs.delete(agentId);
        settleTrackedRun(run);
    }
}
export class ForegroundTurnStream {
    constructor(turnId) {
        this.queue = [];
        this.queueResolve = null;
        let resolveSettled;
        const settledPromise = new Promise((resolvePromise) => {
            resolveSettled = resolvePromise;
        });
        this.waiter = {
            turnId,
            settled: false,
            settledPromise,
            resolveSettled,
            callback: (event) => {
                this.queue.push(event);
                this.wake();
            },
        };
    }
    async *events(isTerminalEvent) {
        let done = false;
        while (!done) {
            while (this.queue.length > 0) {
                const event = this.queue.shift();
                yield event;
                if (isTerminalEvent(event)) {
                    done = true;
                    break;
                }
            }
            if (!done && this.queue.length === 0) {
                if (this.waiter.settled) {
                    break;
                }
                await new Promise((resolvePromise) => {
                    this.queueResolve = resolvePromise;
                });
            }
        }
    }
    wake() {
        if (!this.queueResolve) {
            return;
        }
        this.queueResolve();
        this.queueResolve = null;
    }
}
function createPendingForegroundRun() {
    return {
        ...createTrackedRunState(),
        kind: "foreground",
        start: { status: "pending" },
        stagedEvents: [],
    };
}
function createTrackedRunState() {
    let resolveSettled;
    const settledPromise = new Promise((resolvePromise) => {
        resolveSettled = resolvePromise;
    });
    return {
        token: randomUUID(),
        settled: false,
        settledPromise,
        resolveSettled,
    };
}
function settleTrackedRun(run) {
    if (run.settled) {
        return;
    }
    run.settled = true;
    run.resolveSettled();
}
//# sourceMappingURL=agent-run-state.js.map