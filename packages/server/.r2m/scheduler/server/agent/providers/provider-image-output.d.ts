import type { AgentTimelineItem } from "../agent-sdk-types.js";
export interface ProviderImageOutput {
    path?: string | null;
    url?: string | null;
    data?: string | null;
    mimeType?: string | null;
    altText?: string | null;
}
export interface MaterializedProviderImage {
    path: string;
}
export declare function materializeProviderImage(image: {
    data: string;
    mimeType: string | null;
}): MaterializedProviderImage;
export declare function isProviderImageMarkdown(text: string): boolean;
interface RenderProviderImageOutputOptions {
    materialize?: (image: {
        data: string;
        mimeType: string | null;
    }) => MaterializedProviderImage;
}
export declare function renderProviderImageOutputAsAssistantMarkdown(image: ProviderImageOutput, options?: RenderProviderImageOutputOptions): AgentTimelineItem | null;
export {};
//# sourceMappingURL=provider-image-output.d.ts.map