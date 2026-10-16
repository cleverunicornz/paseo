/**
 * Icon file patterns to search for, in priority order.
 * Patterns starting with '*' are glob patterns (e.g., icon-*.png).
 *
 * SVG and PNG outrank ICO across all known names: every client renders them
 * and they scale better. ICO is the final fallback because native clients
 * cannot decode containers whose frames use the legacy bitmap format.
 */
export declare const ICON_PATTERNS: string[];
/**
 * Directories or directory paths to search first (in priority order).
 */
export declare const PRIORITY_DIRS: string[];
/**
 * Monorepo package directory patterns to scan (e.g., packages/app, apps/web).
 */
export declare const MONOREPO_PACKAGE_DIRS: string[];
/**
 * Directories to ignore during search.
 */
export declare const IGNORED_DIRS: string[];
export interface ProjectIcon {
    data: string;
    mimeType: string;
}
export interface ImageDimensions {
    width: number;
    height: number;
}
export declare function getImageDimensions(buffer: Buffer, mimeType: string): ImageDimensions | null;
/**
 * ICO is a container; modern favicons usually carry a PNG-encoded frame for the
 * larger sizes. Native <Image> can't decode ICO but decodes PNG fine, so when a
 * PNG frame exists, serve the largest one as image/png instead of the container.
 */
export declare function extractIcoPngFrame(buffer: Buffer): Buffer | null;
/**
 * Find a project icon/favicon in the given directory.
 * Searches priority directories first, then falls back to scanning the root.
 *
 * @param projectDir - The root directory of the project to search
 * @param maxDepth - Maximum depth to search (default: 3)
 * @returns The absolute path to the found icon, or null if not found
 */
export declare function findProjectIcon(projectDir: string, maxDepth?: number): Promise<string | null>;
/**
 * Find and read a project icon/favicon, returning it as base64.
 * Only returns square icons smaller than MAX_ICON_SIZE (32KB).
 *
 * @param projectDir - The root directory of the project to search
 * @returns The icon data with mime type, or null if not found
 */
export declare function getProjectIcon(projectDir: string): Promise<ProjectIcon | null>;
//# sourceMappingURL=project-icon.d.ts.map