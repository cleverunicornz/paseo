import type { AgentStreamEvent } from "../../../agent-sdk-types.js";
import type { PiAgentMessage, PiAgentSessionEvent } from "../rpc-types.js";
interface Fixture {
    provenance: {
        package: string;
        version: string;
        sourceCommit: string;
        piVersion: string;
        captureDate: string;
    };
    events: PiAgentSessionEvent[];
    messages: PiAgentMessage[];
}
export declare function readSubagentFixture(path: URL, replaceSessionFile?: {
    from: string;
    to: string;
}): Fixture;
export declare function verifySubagentFixture(fixture: Fixture): Promise<Extract<AgentStreamEvent, {
    type: "provider_subagent";
}>[]>;
export {};
//# sourceMappingURL=subagent-fixture-test.d.ts.map