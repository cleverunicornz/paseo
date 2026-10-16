import { type WorkspaceLabelDefinition } from "@getpaseo/protocol/workspace-labels";
import { WorkspaceLabelCatalogStore } from "./catalog-store.js";
import { WorkspaceLabelSequence, type WorkspaceLabelChange, type WorkspaceLabelCursor } from "./sequence.js";
export declare class WorkspaceLabelError extends Error {
    readonly code: "label_name_empty" | "label_not_found" | "label_name_taken" | "workspace_not_found";
    constructor(code: "label_name_empty" | "label_not_found" | "label_name_taken" | "workspace_not_found", message: string);
}
export declare class WorkspaceLabelService {
    private readonly catalog;
    private readonly sequence;
    private operations;
    constructor(catalog: WorkspaceLabelCatalogStore, sequence?: WorkspaceLabelSequence);
    initialize(): Promise<void>;
    list(cursor?: WorkspaceLabelCursor): Promise<ReturnType<WorkspaceLabelSequence["synchronize"]>>;
    subscribe(input: {
        cursor?: WorkspaceLabelCursor;
        onChange: (change: WorkspaceLabelChange & {
            generation: string;
            seq: number;
        }) => void;
    }): Promise<{
        snapshot: ReturnType<WorkspaceLabelSequence["synchronize"]>;
        unsubscribe: () => void;
    }>;
    setAssignment(input: {
        workspaceId: string;
        label: WorkspaceLabelDefinition;
        assigned: boolean;
    }): Promise<{
        label: WorkspaceLabelDefinition;
        workspaceLabels: string[];
    }>;
    /**
     * Edit a label: a new name, a new colour, or both, in one catalog commit.
     *
     * Both fields are optional and an omitted field is left alone. They travel together because
     * the alternative — a rename that succeeds and a recolour that then fails — leaves the catalog
     * in a state nobody asked for and no client can describe.
     *
     * Renaming onto a name the host already has is rejected, not merged. Merging would fold two
     * labels' assignments together with no way back, and the user asked to edit one label. The
     * check happens inside the planner, so a rejected collision applies neither field.
     */
    update(input: {
        name: string;
        newName?: string;
        color?: WorkspaceLabelDefinition["color"];
    }): Promise<{
        label: WorkspaceLabelDefinition;
        affectedWorkspaceCount: number;
    }>;
    delete(nameInput: string): Promise<{
        affectedWorkspaceCount: number;
    }>;
    countAffectedWorkspaces(nameInput: string): Promise<number>;
    private exclusive;
}
//# sourceMappingURL=service.d.ts.map