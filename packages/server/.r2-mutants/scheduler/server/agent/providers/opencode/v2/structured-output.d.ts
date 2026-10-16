import { z } from "zod";
import type { SessionMessageInfo } from "@opencode/client";
export declare const STRUCTURED_OUTPUT_TOOL = "paseo_structured_output";
export declare function structuredOutput(input: unknown): {
    schema: boolean | Record<string, z.core.util.JSONType>;
    assert(history: SessionMessageInfo[]): void;
};
//# sourceMappingURL=structured-output.d.ts.map