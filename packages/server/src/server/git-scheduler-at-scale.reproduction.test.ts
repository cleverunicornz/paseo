import { mkdirSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type pino from "pino";
import { afterEach, describe, expect, test } from "vitest";

import { GitProcessScheduler, GitProcessQueueFullError } from "../utils/git-process-scheduler.js";
import type { CheckoutStatusGit } from "../utils/checkout-git.js";
import {
  createPersistedProjectRecord,
  createPersistedWorkspaceRecord,
} from "./workspace-registry.js";
import type { ProjectRegistry, WorkspaceRegistry } from "./workspace-registry.js";
import { WorkspaceReconciliationService } from "./workspace-reconciliation-service.js";
import { WorkspaceGitServiceImpl } from "./workspace-git-service.js";

/**
 * The at-scale reproduction O-000299 asks for, shaped like the live estate: a
 * few hundred live workspace records, some whose directories are gone, swept by
 * a real WorkspaceGitServiceImpl. The scheduler burst is a fixture; the cache
 * half is the production service, not a stand-in.
 */

const WORKSPACE_COUNT = 300;
const BURST_SUBMISSIONS = 2_000;
const QUEUE_BOUND = 256;
// The burst arrives in a single tick, far faster than any finite admission
// rate: the live estate's one-five-minute sweep submits ~800-1,100 at once.
const MAX_PROCESSES_PER_SECOND = 1_024;

function createLogger(): pino.Logger {
  const logger = {
    child: () => logger,
    trace: () => undefined,
    debug: () => undefined,
    info: () => undefined,
    warn: () => undefined,
    error: () => undefined,
  };
  return logger as unknown as pino.Logger;
}

function createCheckoutStatus(cwd: string): CheckoutStatusGit {
  return {
    isGit: true,
    repoRoot: cwd,
    mainRepoRoot: null,
    currentBranch: "main",
    isDirty: false,
    baseRef: "main",
    aheadBehind: { ahead: 0, behind: 0 },
    aheadOfOrigin: 0,
    behindOfOrigin: 0,
    hasRemote: false,
    remoteUrl: null,
    isPaseoOwnedWorktree: false,
  };
}

/**
 * The real WorkspaceGitServiceImpl with an injected status read, so a live read
 * is counted and no Git process is spawned. The reconciliation sweep reaches it
 * through exactly the production methods.
 */
function createRealGitService() {
  const reads: string[] = [];
  const service = new WorkspaceGitServiceImpl({
    logger: createLogger(),
    paseoHome: "/tmp/l15-at-scale",
    deps: {
      getCheckoutStatus: async (cwd: string) => {
        reads.push(cwd);
        return createCheckoutStatus(cwd);
      },
    },
  });
  return { reads, service };
}

function createRegistries(projectRoot: string) {
  const projects = new Map<string, ReturnType<typeof createPersistedProjectRecord>>();
  const workspaces = new Map<string, ReturnType<typeof createPersistedWorkspaceRecord>>();
  const projectRegistry: ProjectRegistry = {
    initialize: async () => {},
    existsOnDisk: async () => true,
    list: async () => Array.from(projects.values()),
    get: async (id) => projects.get(id) ?? null,
    getOrCreateActiveByRoot: async () => {
      throw new Error("unused");
    },
    upsert: async (record) => {
      projects.set(record.projectId, record);
    },
    update: async (id, updater) => {
      const current = projects.get(id);
      if (!current) return null;
      const next = updater(current);
      projects.set(id, next);
      return next;
    },
    archive: async (id, archivedAt) => {
      const current = projects.get(id);
      if (current) projects.set(id, { ...current, archivedAt });
    },
    remove: async (id) => {
      projects.delete(id);
    },
  };
  const workspaceRegistry: WorkspaceRegistry = {
    initialize: async () => {},
    existsOnDisk: async () => true,
    list: async () => Array.from(workspaces.values()),
    get: async (id) => workspaces.get(id) ?? null,
    update: async (id, updater) => {
      const current = workspaces.get(id);
      if (!current) return null;
      const next = updater(current);
      workspaces.set(id, next);
      return next;
    },
    upsert: async (record) => {
      workspaces.set(record.workspaceId, record);
    },
    archive: async (id, archivedAt) => {
      const current = workspaces.get(id);
      if (current) workspaces.set(id, { ...current, archivedAt });
    },
    remove: async (id) => {
      workspaces.delete(id);
    },
  };
  void projectRoot;
  return { projectRegistry, workspaceRegistry, projects, workspaces };
}

describe("git scheduler at scale", () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  test("a sweep over 300 workspaces reads O(changed) Git, not O(workspaces)", async () => {
    const projectRoot = realpathSync(mkdtempSync(path.join(tmpdir(), "at-scale-project-")));
    tempDirs.push(projectRoot);
    const { projectRegistry, workspaceRegistry, projects, workspaces } =
      createRegistries(projectRoot);
    const timestamp = "2026-01-01T00:00:00.000Z";
    projects.set(
      "p1",
      createPersistedProjectRecord({
        projectId: "p1",
        rootPath: projectRoot,
        kind: "git",
        displayName: "at-scale",
        createdAt: timestamp,
        updatedAt: timestamp,
      }),
    );
    const cwds: string[] = [];
    // The live estate's shape: hundreds of live records across many roots, and
    // a fraction whose directories are gone (the sweep self-archives those).
    for (let index = 0; index < WORKSPACE_COUNT; index += 1) {
      const cwd = path.join(projectRoot, `ws-${index}`);
      if (index % 20 === 0) {
        // A workspace whose directory no longer exists.
        cwds.push(cwd);
      } else {
        mkdirSync(cwd, { recursive: true });
        cwds.push(cwd);
      }
      workspaces.set(
        `w${index}`,
        createPersistedWorkspaceRecord({
          workspaceId: `w${index}`,
          projectId: "p1",
          cwd,
          kind: "worktree",
          displayName: `ws-${index}`,
          branch: "main",
          worktreeRoot: cwd,
          mainRepoRoot: projectRoot,
          createdAt: timestamp,
          updatedAt: timestamp,
        }),
      );
    }
    const { reads, service: gitService } = createRealGitService();
    const service = new WorkspaceReconciliationService({
      projectRegistry,
      workspaceRegistry,
      logger: createLogger(),
      workspaceGitService: gitService,
    });

    // Cold: every live directory is read once (never observed before).
    await service.reconcileGitMetadata();
    const coldReads = reads.length;
    expect(coldReads).toBeGreaterThan(0);

    // Warm, second full sweep, nothing changed: no live read at all. The first
    // sweep's reads populated the real service's cache across sweeps.
    reads.length = 0;
    const secondSweep = await service.reconcileGitMetadata();
    expect(secondSweep.deferred).toBe(false);
    expect(reads).toEqual([]);

    // A third sweep with no change events reads nothing either: the warm claim
    // holds sweep over sweep, not only within one sweep.
    await service.reconcileGitMetadata();
    expect(reads).toEqual([]);

    // Three workspaces changed; only those three are read again.
    reads.length = 0;
    const changed = [cwds[7]!, cwds[123]!, cwds[299]!];
    for (const cwd of changed) gitService.onWorkspaceStateMayHaveChanged(cwd);
    await service.reconcileGitMetadata();
    expect(reads.toSorted()).toEqual([...changed].toSorted());
    expect(reads.length).toBeLessThan(WORKSPACE_COUNT);

    await gitService.dispose();
  });

  test("a sweep-scale burst defers the sweep while foreground commands complete", async () => {
    const scheduler = new GitProcessScheduler({
      maxProcessesPerSecond: MAX_PROCESSES_PER_SECOND,
      maxProcessConcurrency: 8,
      maxQueueDepth: QUEUE_BOUND,
    });
    let peakPending = 0;
    let deferrals = 0;
    const background: Array<Promise<void>> = [];
    // One sweep of the live estate submits ~800-1,100 commands in one tick.
    for (let index = 0; index < BURST_SUBMISSIONS; index += 1) {
      const completed = new Promise<void>((resolve) => setTimeout(resolve, 30));
      background.push(
        scheduler
          .run(() => ({ result: completed, exited: completed }), { class: "background" })
          .catch((error: unknown) => {
            if (error instanceof GitProcessQueueFullError) {
              deferrals += 1;
              return;
            }
            throw error;
          }),
      );
      peakPending = Math.max(peakPending, scheduler.pendingCount);
    }

    // Without the bound, the same burst queued 907 deep in the live daemon.
    expect(peakPending).toBeLessThanOrEqual(QUEUE_BOUND);
    // The sweep yielded instead of growing the backlog.
    expect(deferrals).toBeGreaterThan(0);

    // Foreground work submitted into that full queue still executes: an agent's
    // or a user's Git command is never dropped for queue depth.
    const foreground = Array.from({ length: 40 }, () => {
      const completed = new Promise<void>((resolve) => setTimeout(resolve, 10));
      return scheduler.run(() => ({ result: completed, exited: completed }));
    });
    await expect(Promise.all(foreground)).resolves.toHaveLength(40);

    // The queued background work still drains; a deferral never wedges the queue.
    await Promise.all(background);
    expect(scheduler.pendingCount).toBe(0);
    expect(scheduler.activeCount).toBe(0);
  });
});
