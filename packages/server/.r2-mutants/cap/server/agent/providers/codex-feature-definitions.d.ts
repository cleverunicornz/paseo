import type { AgentFeature, AgentFeatureToggle } from "../agent-sdk-types.js";
import { z } from "zod";
export declare const CodexServiceTierSchema: z.ZodObject<{
    id: z.ZodString;
    name: z.ZodString;
    description: z.ZodString;
}, z.core.$strip>;
export type CodexServiceTier = z.infer<typeof CodexServiceTierSchema>;
export declare const CODEX_PLAN_MODE_FEATURE: Omit<AgentFeatureToggle, "value">;
export declare function buildCodexFeatures(input: {
    serviceTiers: CodexServiceTier[];
    serviceTier: string;
    planModeEnabled: boolean;
    planModeAvailable?: boolean;
}): AgentFeature[];
export declare function readCodexServiceTier(values: Record<string, unknown> | undefined): string | null;
//# sourceMappingURL=codex-feature-definitions.d.ts.map