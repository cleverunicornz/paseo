import { mkdirSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { ProjectCheckoutLitePayload } from "@getpaseo/protocol/messages";
import type pino from "pino";
import { afterEach, describe, expect, test } from "vitest";

import { GitProcessScheduler, GitProcessQueueFullError } from "../utils/git-process-scheduler.js";
import {
  createPersistedProjectRecord,
  createPersistedWorkspaceRecord,
} from "./workspace-registry.js";
import type { ProjectRegistry, WorkspaceRegistry } from "./workspace-registry.js";
import { WorkspaceReconciliationService } from "./workspace-reconciliation-service.js";

/**
 * The at-scale reproduction O-000299 asks for, at one fifth of the live
 * estate's workspace count (300 against ~500). Both halves are fixtures, never
 * the live daemon: a reconciliation sweep across every workspace, and a burst
 * of Git submissions through the shared scheduler.
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

/**
 * A Git service that counts every live read and caches the checkout on the
 * first one, exactly as a completed workspace refresh would: the second sweep
 * over an unobserved-but-warm workspace reads no Git at all.
 */
function createCachingGit() {
  const reads: string[] = [];
  const cache = new Map<string, ProjectCheckoutLitePayload>();
  return {
    reads,
    invalidate: (cwd: string) => cache.delete(cwd),
    peekCachedCheckout: (cwd: string): ProjectCheckoutLitePayload | null => cache.get(cwd) ?? null,
    getCheckout: async (cwd: string): Promise<ProjectCheckoutLitePayload> => {
      reads.push(cwd);
      const checkout: ProjectCheckoutLitePayload = {
        cwd,
        isGit: true,
        currentBranch: "main",
        remoteUrl: null,
        worktreeRoot: cwd,
        isPaseoOwnedWorktree: false,
        mainRepoRoot: null,
      };
      cache.set(cwd, checkout);
      return checkout;
    },
  };
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
    for (let index = 0; index < WORKSPACE_COUNT; index += 1) {
      const cwd = path.join(projectRoot, `ws-${index}`);
      mkdirSync(cwd, { recursive: true });
      cwds.push(cwd);
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
    const git = createCachingGit();
    const service = new WorkspaceReconciliationService({
      projectRegistry,
      workspaceRegistry,
      logger: createLogger(),
      workspaceGitService: git,
    });

    // Cold: every workspace is read once (never observed before).
    await service.reconcileGitMetadata();
    expect(git.reads.length).toBe(WORKSPACE_COUNT + 1);

    // Warm: the whole estate's cache is populated, so the sweep reads nothing.
    git.reads.length = 0;
    await service.reconcileGitMetadata();
    expect(git.reads).toEqual([]);

    // Three workspaces changed; only those three are read again.
    git.reads.length = 0;
    const changed = [cwds[7]!, cwds[123]!, cwds[299]!];
    for (const cwd of changed) git.invalidate(cwd);
    await service.reconcileGitMetadata();
    expect(git.reads.toSorted()).toEqual([...changed].toSorted());
    expect(git.reads.length).toBeLessThan(WORKSPACE_COUNT);
  });

  test("a sweep-scale burst keeps pending within the bound and refuses the rest", async () => {
    const scheduler = new GitProcessScheduler({
      maxProcessesPerSecond: MAX_PROCESSES_PER_SECOND,
      maxProcessConcurrency: 8,
      maxQueueDepth: QUEUE_BOUND,
    });
    let peakPending = 0;
    let refusals = 0;
    const submissions: Array<Promise<void>> = [];
    // One sweep of the live estate submits ~800-1,100 commands in one tick.
    for (let index = 0; index < BURST_SUBMISSIONS; index += 1) {
      const completed = new Promise<void>((resolve) => setTimeout(resolve, 30));
      submissions.push(
        scheduler
          .run(() => ({ result: completed, exited: completed }))
          .catch((error: unknown) => {
            if (error instanceof GitProcessQueueFullError) {
              refusals += 1;
              return;
            }
            throw error;
          }),
      );
      peakPending = Math.max(peakPending, scheduler.pendingCount);
    }

    // Without the bound, the same burst queued 907 deep in the live daemon.
    expect(peakPending).toBeLessThanOrEqual(QUEUE_BOUND);

    // The queued work still drains; a refusal never wedges the queue.
    await Promise.all(submissions);
    expect(refusals).toBeGreaterThan(0);
    expect(scheduler.pendingCount).toBe(0);
    expect(scheduler.activeCount).toBe(0);
  });
});
