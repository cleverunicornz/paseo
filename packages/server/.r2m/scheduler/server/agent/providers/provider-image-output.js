import { createHash } from "node:crypto";
import * as fsSync from "node:fs";
import os from "node:os";
import path from "node:path";
const PROVIDER_IMAGE_ATTACHMENT_DIR = "paseo-attachments";
const PROVIDER_IMAGE_ATTACHMENT_DIR_PREFIX = `${PROVIDER_IMAGE_ATTACHMENT_DIR}-`;
const PRIVATE_ATTACHMENT_DIR_MODE = 0o700;
const MATERIALIZED_IMAGE_FILE_MODE = 0o600;
let materializedImageAttachmentDir = null;
function canReuseMaterializedImageAttachmentDir(dir) {
    try {
        const stats = fsSync.lstatSync(dir);
        if (!stats.isDirectory()) {
            return false;
        }
        fsSync.chmodSync(dir, PRIVATE_ATTACHMENT_DIR_MODE);
        return true;
    }
    catch {
        return false;
    }
}
function getMaterializedImageAttachmentDir() {
    if (materializedImageAttachmentDir &&
        canReuseMaterializedImageAttachmentDir(materializedImageAttachmentDir)) {
        return materializedImageAttachmentDir;
    }
    materializedImageAttachmentDir = fsSync.mkdtempSync(path.join(os.tmpdir(), PROVIDER_IMAGE_ATTACHMENT_DIR_PREFIX));
    fsSync.chmodSync(materializedImageAttachmentDir, PRIVATE_ATTACHMENT_DIR_MODE);
    return materializedImageAttachmentDir;
}
function getImageExtension(mimeType) {
    switch (mimeType) {
        case "image/jpeg":
            return "jpg";
        case "image/png":
            return "png";
        case "image/webp":
            return "webp";
        case "image/gif":
            return "gif";
        case "image/bmp":
            return "bmp";
        case "image/tiff":
            return "tiff";
        default:
            return "bin";
    }
}
function normalizeImageData(mimeType, data) {
    if (data.startsWith("data:")) {
        const match = data.match(/^data:([^;]+);base64,(.*)$/);
        if (match) {
            return { mimeType: match[1], data: match[2] };
        }
    }
    return { mimeType, data };
}
// Filenames are a content hash of the bytes so re-materializing the same image
// within a process reuses the existing temp file instead of leaking a fresh one
// for repeated image blocks or history replay.
export function materializeProviderImage(image) {
    const attachmentsDir = getMaterializedImageAttachmentDir();
    const normalized = normalizeImageData(image.mimeType ?? "image/png", image.data);
    const bytes = Buffer.from(normalized.data, "base64");
    const extension = getImageExtension(normalized.mimeType);
    const hash = createHash("sha256").update(bytes).digest("hex");
    const filePath = path.join(attachmentsDir, `${hash}.${extension}`);
    fsSync.writeFileSync(filePath, bytes, { mode: MATERIALIZED_IMAGE_FILE_MODE });
    fsSync.chmodSync(filePath, MATERIALIZED_IMAGE_FILE_MODE);
    return { path: filePath };
}
// Recognizes markdown rendered for a materialized provider image: its source is a content-hashed
// file in the attachments dir. Matching the full <hash>.<ext> shape (not just a leading "![")
// keeps user-authored text from being mistaken for a provider image during history replay. The
// separator still accepts old doubled-backslash Windows history; new Windows output uses file URIs.
const PROVIDER_IMAGE_MARKDOWN = new RegExp(`^!\\[[^\\]]*\\]\\([^)]*${PROVIDER_IMAGE_ATTACHMENT_DIR}(?:-[^/\\\\)]+)?[/\\\\]+(?:[^/\\\\)]+[/\\\\]+)?[0-9a-f]{64}\\.[a-z0-9]+\\)`);
export function isProviderImageMarkdown(text) {
    return PROVIDER_IMAGE_MARKDOWN.test(text);
}
function nonEmptyString(value) {
    const trimmed = value?.trim();
    return trimmed ? trimmed : null;
}
function isDataImageSource(source) {
    return source.trim().toLowerCase().startsWith("data:image/");
}
function escapeMarkdownImageAlt(value) {
    return value.replace(/\\/g, "\\\\").replace(/\]/g, "\\]");
}
function encodeFilePath(value) {
    return value
        .split("/")
        .map((segment) => encodeURIComponent(segment))
        .join("/");
}
function windowsFileUri(value) {
    const isWindowsNetworkPath = value.startsWith("\\\\");
    let normalizedPath = value.replace(/\\/g, "/");
    if (/^\/\/\?\/UNC\//i.test(normalizedPath)) {
        normalizedPath = `//${normalizedPath.slice(8)}`;
    }
    else if (/^\/\/\?\/[A-Za-z]:\//.test(normalizedPath)) {
        normalizedPath = normalizedPath.slice(4);
    }
    if (/^[A-Za-z]:\//.test(normalizedPath)) {
        const drive = normalizedPath.slice(0, 2);
        return `file:///${drive}${encodeFilePath(normalizedPath.slice(2))}`;
    }
    if (isWindowsNetworkPath && normalizedPath.startsWith("//")) {
        return `file:${encodeFilePath(normalizedPath)}`;
    }
    return null;
}
function markdownImageSource(value) {
    const windowsUri = windowsFileUri(value);
    if (windowsUri) {
        return windowsUri;
    }
    if (value.startsWith("/")) {
        return `file://${encodeFilePath(value)}`;
    }
    return value;
}
function escapeMarkdownImageSource(value) {
    return markdownImageSource(value).replace(/\\/g, "\\\\").replace(/\)/g, "\\)");
}
export function renderProviderImageOutputAsAssistantMarkdown(image, options = {}) {
    const source = nonEmptyString(image.path) ?? nonEmptyString(image.url);
    if (source && !isDataImageSource(source)) {
        const altText = escapeMarkdownImageAlt(nonEmptyString(image.altText) ?? "Image");
        return {
            type: "assistant_message",
            text: `![${altText}](${escapeMarkdownImageSource(source)})`,
        };
    }
    const data = nonEmptyString(image.data) ?? (source && isDataImageSource(source) ? source : null);
    if (!data) {
        return null;
    }
    let materialized = null;
    try {
        materialized = options.materialize
            ? options.materialize({
                data,
                mimeType: nonEmptyString(image.mimeType),
            })
            : null;
    }
    catch {
        materialized = null;
    }
    if (!materialized?.path || isDataImageSource(materialized.path)) {
        return {
            type: "assistant_message",
            text: "Image output was omitted because it was not available as a file path or URL.",
        };
    }
    const altText = escapeMarkdownImageAlt(nonEmptyString(image.altText) ?? "Image");
    return {
        type: "assistant_message",
        text: `![${altText}](${escapeMarkdownImageSource(materialized.path)})`,
    };
}
//# sourceMappingURL=provider-image-output.js.map