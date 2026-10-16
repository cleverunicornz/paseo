import { z } from "zod";
import type { AgentManager } from "../../agent/agent-manager.js";
import type { ProviderSnapshotManager } from "../../agent/provider-snapshot-manager.js";
import { type ResolveStructuredGenerationProvidersOptions, type StructuredGenerationDaemonConfig } from "../../agent/structured-generation-providers.js";
import type { WorkspaceGitService } from "../../workspace-git-service.js";
export interface PullRequestText {
    title: string;
    body: string;
}
/**
 * Generates a workspace's commit message and pull-request text from its git diff
 * via the agent LLM. The checkout subsystem is the only consumer; it owns the
 * commit/PR commands and asks this for the wording when the user left it blank.
 */
export interface GitMetadataGenerator {
    generateCommitMessage(cwd: string): Promise<string>;
    generatePullRequestText(cwd: string, baseRef?: string): Promise<PullRequestText>;
}
/**
 * The LLM boundary, injected so the generator's prompt-building and fallback
 * behaviour is unit-testable with a fake. Production wires
 * createAgentStructuredTextGeneration (resolve providers → run structured
 * generation); a failed generation throws StructuredAgent*Error, which the
 * generator catches and turns into the product fallback text.
 */
export interface StructuredTextGeneration {
    generate<T>(request: StructuredTextGenerationRequest<T>): Promise<T>;
}
export interface StructuredTextGenerationRequest<T> {
    cwd: string;
    prompt: string;
    schema: z.ZodType<T>;
    schemaName: string;
    agentTitle: string;
}
type GitMetadataDiffSource = Pick<WorkspaceGitService, "getCheckoutDiff" | "resolveRepoRoot">;
export declare function createGitMetadataGenerator(deps: {
    workspaceGitService: GitMetadataDiffSource;
    generation: StructuredTextGeneration;
}): GitMetadataGenerator;
/**
 * Production StructuredTextGeneration: resolve the structured-generation providers
 * for the cwd, then run the agent with a 2-retry fallback as an internal,
 * non-persisted session.
 */
export declare function createAgentStructuredTextGeneration(deps: {
    agentManager: AgentManager;
    providerSnapshotManager: Pick<ProviderSnapshotManager, "listProviders">;
    readDaemonConfig: () => StructuredGenerationDaemonConfig;
    getFocusedSelection: (cwd: string) => ResolveStructuredGenerationProvidersOptions["currentSelection"];
}): StructuredTextGeneration;
export {};
//# sourceMappingURL=git-metadata-generator.d.ts.map