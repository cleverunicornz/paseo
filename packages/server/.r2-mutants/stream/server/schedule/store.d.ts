import type { Logger } from "pino";
import { type ScheduleTarget, type StoredSchedule } from "@getpaseo/protocol/schedule/types";
type ScheduleUpdater = (schedule: StoredSchedule) => StoredSchedule | Promise<StoredSchedule>;
interface ScheduleNameTargetUpsert {
    create: () => Omit<StoredSchedule, "id"> | Promise<Omit<StoredSchedule, "id">>;
    update: ScheduleUpdater;
}
export declare class ScheduleStore {
    private readonly dir;
    private readonly logger;
    private readonly scheduleMutations;
    private readonly identityMutations;
    private reportedInvalidFiles;
    constructor(dir: string, logger: Logger);
    private filePath;
    private ensureDir;
    list(): Promise<StoredSchedule[]>;
    get(id: string): Promise<StoredSchedule | null>;
    create(schedule: Omit<StoredSchedule, "id">): Promise<StoredSchedule>;
    update(id: string, updater: ScheduleUpdater): Promise<StoredSchedule | null>;
    upsertByNameAndTarget(name: string, target: ScheduleTarget, options: ScheduleNameTargetUpsert): Promise<StoredSchedule>;
    private write;
    delete(id: string): Promise<void>;
    private serializeScheduleMutation;
    private serializeIdentityMutation;
    private serializeMutation;
    private updateMatchedSchedule;
}
export {};
//# sourceMappingURL=store.d.ts.map