import type { StoredAgentRecord } from "./agent-storage.js";
export type ArchivedStoredAgentRecord = StoredAgentRecord & {
    archivedAt: string;
};
interface BuildArchivedAgentRecordOptions {
    archivedAt?: string;
    updatedAt?: string;
}
export declare function buildArchivedAgentRecord(record: StoredAgentRecord, options?: BuildArchivedAgentRecordOptions): ArchivedStoredAgentRecord;
export {};
//# sourceMappingURL=agent-archive.d.ts.map