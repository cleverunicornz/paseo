import { open, readdir, readFile, stat } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { existsSync } from "node:fs";
import { createRealpathAwarePathMatcher } from "../../../../utils/path.js";
const OMP_CONFIG_DIR_NAME = ".omp";
const OMP_SESSION_DIR_ENV = "PI_CODING_AGENT_SESSION_DIR";
// Import listing intentionally bounds header parsing to this window. Sessions
// with unusually large preambles may omit their first-prompt preview.
const HEAD_BYTES = 64 * 1024;
const TAIL_BYTES = 256 * 1024;
const FULL_SCAN_LINE_LIMIT = 2000;
// Rank all discovered files cheaply, then parse only a bounded recent window.
// OMP keeps nested completed-subagent transcripts importable, so discovery
// remains recursive rather than applying Pi's historical parent-only depth cap.
const IMPORT_CANDIDATE_OVERSCAN = 40;
const IMPORT_CANDIDATE_MIN = 400;
export async function listOmpImportableSessions(options = {}) {
    const sessionsDir = await resolveOmpSessionsDir(options);
    const files = await walkJsonlFiles(sessionsDir);
    const matchesCwd = options.cwd ? createRealpathAwarePathMatcher(options.cwd) : null;
    const limit = options.limit ?? 20;
    const ranked = await rankSessionFilesByMtime(files);
    const candidateLimit = Math.min(options.scanLimit ?? Math.max(limit * IMPORT_CANDIDATE_OVERSCAN, IMPORT_CANDIDATE_MIN), 500);
    const candidates = options.scanLimit === undefined && matchesCwd ? ranked : ranked.slice(0, candidateLimit);
    const sessions = [];
    for (const entry of candidates) {
        const session = await readOmpImportableSession(entry.file);
        if (!session)
            continue;
        if (matchesCwd && !matchesCwd(session.cwd))
            continue;
        sessions.push(session);
        if (sessions.length >= limit) {
            break;
        }
    }
    return sessions.sort((left, right) => right.lastActivityAt.getTime() - left.lastActivityAt.getTime());
}
/**
 * Reads the model/thinking config of an OMP session for import.
 *
 * `handle` is either an absolute path to the session `.jsonl` (what the
 * importable-sessions list hands back) or a bare OMP session id (what
 * `paseo import <id>` supplies). Ids are resolved against the configured
 * sessions directory; an unresolvable handle yields `{}`.
 */
export async function readOmpImportSessionConfig(handle, options = {}) {
    const filePath = await resolveOmpSessionFile(handle, options);
    if (!filePath)
        return {};
    const descriptor = await readOmpSessionDescriptor(filePath);
    if (!descriptor)
        return {};
    return toOmpImportSessionConfig(descriptor);
}
/**
 * Resolves an import handle to a session file path. Returns the handle itself
 * when it already names a readable file; otherwise searches the sessions
 * directory for a file whose header `id` matches.
 */
export async function resolveOmpSessionFile(handle, options = {}) {
    const trimmed = handle.trim();
    if (!trimmed)
        return null;
    if (await isReadableFile(trimmed))
        return trimmed;
    const sessionsDir = await resolveOmpSessionsDir(options);
    const files = await walkJsonlFiles(sessionsDir);
    // OMP names session files `<timestamp>_<id>.jsonl`; try those first so the
    // common case opens a single file instead of scanning the directory.
    const nameSuffix = `_${trimmed}.jsonl`;
    const byName = files.filter((file) => path.basename(file).endsWith(nameSuffix));
    for (const file of byName) {
        if (await headerSessionIdMatches(file, trimmed))
            return file;
    }
    const rest = byName.length > 0 ? files.filter((file) => !byName.includes(file)) : files;
    for (const file of rest) {
        if (await headerSessionIdMatches(file, trimmed))
            return file;
    }
    return null;
}
async function isReadableFile(filePath) {
    try {
        return (await stat(filePath)).isFile();
    }
    catch {
        return false;
    }
}
async function headerSessionIdMatches(filePath, sessionId) {
    const headChunk = await readHeadChunk(filePath);
    if (!headChunk)
        return false;
    return parseSessionHeaderFromChunk(headChunk)?.sessionId === sessionId;
}
async function resolveOmpSessionsDir(options) {
    const env = { ...(options.env ?? process.env), ...options.runtimeSettings?.env };
    const homeDir = options.homeDir ?? homedir();
    const baseDir = options.cwd ?? process.cwd();
    if (options.sessionDir?.trim()) {
        return resolveConfigPath(options.sessionDir, { baseDir, homeDir });
    }
    const agentDir = resolveOmpAgentDir({ env, homeDir });
    const envSessionDir = env[OMP_SESSION_DIR_ENV];
    if (envSessionDir?.trim()) {
        return resolveConfigPath(envSessionDir, { baseDir, homeDir });
    }
    const settingsSessionDir = await readConfiguredSessionDir({
        agentDir,
        cwd: options.cwd,
    });
    if (settingsSessionDir?.trim()) {
        return resolveConfigPath(settingsSessionDir, { baseDir, homeDir });
    }
    return resolveOmpDefaultSessionsDir(env, agentDir);
}
function resolveOmpDefaultSessionsDir(env, agentDir) {
    const profile = resolveOmpProfile(env);
    const xdgDataHome = env.XDG_DATA_HOME;
    if (xdgDataHome &&
        (process.platform === "linux" || process.platform === "darwin") &&
        (profile || !env.PI_CODING_AGENT_DIR?.trim())) {
        const xdgRoot = path.join(xdgDataHome, "omp", ...(profile ? ["profiles", profile] : []));
        if (existsSync(xdgRoot))
            return path.join(xdgRoot, "sessions");
    }
    return path.join(agentDir, "sessions");
}
function resolveOmpAgentDir(input) {
    const env = input.env;
    const profile = resolveOmpProfile(env);
    if (!profile) {
        const configured = env.PI_CODING_AGENT_DIR;
        if (configured?.trim()) {
            return resolveConfigPath(configured, { baseDir: process.cwd(), homeDir: input.homeDir });
        }
    }
    const configRoot = path.join(input.homeDir, env.PI_CONFIG_DIR || OMP_CONFIG_DIR_NAME);
    const profileRoot = profile ? path.join(configRoot, "profiles", profile) : configRoot;
    return path.join(profileRoot, "agent");
}
function resolveOmpProfile(env) {
    const profile = (env.OMP_PROFILE !== undefined ? env.OMP_PROFILE : env.PI_PROFILE)?.trim();
    if (!profile || profile === "default")
        return undefined;
    if (profile === "." ||
        profile === ".." ||
        profile.endsWith(".") ||
        !/^[a-z0-9][a-z0-9._-]{0,63}$/.test(profile) ||
        /^(?:CON|PRN|AUX|NUL|COM[0-9]|LPT[0-9])(?:\..*)?$/i.test(profile)) {
        throw new Error(`Invalid OMP profile "${profile}"`);
    }
    return profile;
}
async function readConfiguredSessionDir(input) {
    const values = await Promise.all([
        readSessionDirFromSettings(path.join(input.agentDir, "settings.json")),
        input.cwd
            ? readSessionDirFromSettings(path.join(input.cwd, OMP_CONFIG_DIR_NAME, "settings.json"))
            : null,
    ]);
    return values[1] ?? values[0] ?? null;
}
async function readSessionDirFromSettings(settingsPath) {
    try {
        const parsed = JSON.parse(await readFile(settingsPath, "utf8"));
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
            return null;
        }
        const sessionDir = Reflect.get(parsed, "sessionDir");
        return typeof sessionDir === "string" && sessionDir.trim() ? sessionDir : null;
    }
    catch {
        return null;
    }
}
function resolveConfigPath(value, options) {
    if (value === "~") {
        return options.homeDir;
    }
    if (value.startsWith("~/")) {
        return path.join(options.homeDir, value.slice(2));
    }
    return path.isAbsolute(value) ? value : path.resolve(options.baseDir, value);
}
async function walkJsonlFiles(root) {
    let entries;
    try {
        entries = await readdir(root, { withFileTypes: true });
    }
    catch {
        return [];
    }
    const files = await Promise.all(entries.map(async (entry) => {
        const entryPath = path.join(root, entry.name);
        if (entry.isDirectory()) {
            return await walkJsonlFiles(entryPath);
        }
        return entry.isFile() && entry.name.endsWith(".jsonl") ? [entryPath] : [];
    }));
    return files.flat();
}
async function rankSessionFilesByMtime(files) {
    const ranked = await Promise.all(files.map(async (file) => {
        const mtime = await readFileMtime(file);
        return mtime ? { file, mtime } : null;
    }));
    return ranked
        .filter((entry) => entry !== null)
        .sort((left, right) => right.mtime.getTime() - left.mtime.getTime());
}
async function readOmpImportableSession(filePath) {
    const descriptor = await readOmpSessionDescriptor(filePath);
    if (!descriptor)
        return null;
    return {
        providerHandleId: filePath,
        cwd: descriptor.cwd,
        title: descriptor.title,
        firstPromptPreview: normalizePromptPreview(descriptor.firstUserMessage),
        lastPromptPreview: normalizePromptPreview(descriptor.lastUserMessage ?? descriptor.firstUserMessage),
        lastActivityAt: descriptor.lastActivityAt,
    };
}
async function readOmpSessionDescriptor(filePath) {
    // OMP may emit title/session_info lines before the session header.
    const headChunk = await readHeadChunk(filePath);
    if (!headChunk)
        return null;
    const header = parseSessionHeaderFromChunk(headChunk);
    if (!header)
        return null;
    const tail = await readTail(filePath).catch(() => "");
    const tailInfo = parseSessionTail(tail);
    const headInfo = parseSessionHeadFromChunk(headChunk);
    const title = tailInfo.title ??
        headInfo.title ??
        readReadableSessionTitleFromPath(filePath) ??
        headInfo.firstUserMessage;
    const model = tailInfo.model ?? headInfo.model;
    const thinkingOptionId = tailInfo.thinkingOptionId ?? headInfo.thinkingOptionId;
    const lastActivityAt = tailInfo.lastActivityAt ?? (await readFileMtime(filePath)) ?? header.createdAt ?? new Date(0);
    return {
        cwd: header.cwd,
        title,
        firstUserMessage: headInfo.firstUserMessage,
        lastUserMessage: tailInfo.lastUserMessage,
        lastActivityAt,
        model,
        thinkingOptionId,
    };
}
function toOmpImportSessionConfig(descriptor) {
    return {
        ...(descriptor.model ? { model: descriptor.model } : {}),
        ...(descriptor.thinkingOptionId ? { thinkingOptionId: descriptor.thinkingOptionId } : {}),
    };
}
async function readHeadChunk(filePath) {
    const handle = await open(filePath, "r").catch(() => null);
    if (!handle)
        return null;
    try {
        const buffer = Buffer.alloc(HEAD_BYTES);
        const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
        if (bytesRead <= 0)
            return null;
        return buffer.subarray(0, bytesRead).toString("utf8");
    }
    finally {
        await handle.close().catch(() => undefined);
    }
}
function parseSessionHeaderFromChunk(chunk) {
    for (const line of chunk.split(/\r?\n/u)) {
        const header = parseSessionHeader(line.trim());
        if (header)
            return header;
    }
    return null;
}
function parseSessionHeadFromChunk(chunk) {
    let title = null;
    let firstUserMessage = null;
    let model = null;
    let thinkingOptionId = null;
    let lineCount = 0;
    for (const rawLine of chunk.split(/\r?\n/u)) {
        lineCount += 1;
        const entry = parseJsonRecord(rawLine.trim());
        if (!entry)
            continue;
        if (entry.type === "session_info") {
            title = readNonEmptyString(entry.name) ?? title;
        }
        if (entry.type === "title") {
            title = readNonEmptyString(entry.title) ?? title;
        }
        model = extractModel(entry) ?? model;
        thinkingOptionId = extractThinkingOptionId(entry) ?? thinkingOptionId;
        if (!firstUserMessage && entry.type === "message" && isRecord(entry.message)) {
            if (entry.message.role === "user") {
                firstUserMessage = extractMessageText(entry.message.content);
            }
        }
        if (title && firstUserMessage && model && thinkingOptionId) {
            break;
        }
        if (lineCount >= FULL_SCAN_LINE_LIMIT && firstUserMessage) {
            break;
        }
    }
    return { title, firstUserMessage, model, thinkingOptionId };
}
async function readTail(filePath) {
    const fileStats = await stat(filePath);
    const start = Math.max(0, fileStats.size - TAIL_BYTES);
    const length = fileStats.size - start;
    const handle = await open(filePath, "r");
    try {
        const buffer = Buffer.alloc(length);
        const { bytesRead } = await handle.read(buffer, 0, buffer.length, start);
        return buffer.subarray(0, bytesRead).toString("utf8");
    }
    finally {
        await handle.close().catch(() => undefined);
    }
}
async function readFileMtime(filePath) {
    try {
        return (await stat(filePath)).mtime;
    }
    catch {
        return null;
    }
}
function parseSessionHeader(firstLine) {
    const entry = parseJsonRecord(firstLine);
    if (!entry || entry.type !== "session")
        return null;
    const sessionId = typeof entry.id === "string" ? entry.id : null;
    const cwd = typeof entry.cwd === "string" ? entry.cwd : null;
    if (!sessionId || !cwd)
        return null;
    const createdAt = parseDate(entry.timestamp);
    return { sessionId, cwd, createdAt };
}
function parseSessionTail(tail) {
    const lines = tail.split(/\r?\n/u);
    let title = null;
    let lastActivityAt = null;
    let fallbackTimestamp = null;
    let lastUserMessage = null;
    let model = null;
    let thinkingOptionId = null;
    for (let index = lines.length - 1; index >= 0; index -= 1) {
        const entry = parseJsonRecord(lines[index].trim());
        if (!entry)
            continue;
        if (!title && entry.type === "session_info") {
            title = readNonEmptyString(entry.name);
        }
        if (!title && entry.type === "title") {
            title = readNonEmptyString(entry.title);
        }
        if (!model) {
            model = extractModel(entry);
        }
        if (!thinkingOptionId) {
            thinkingOptionId = extractThinkingOptionId(entry);
        }
        const entryTimestamp = parseDate(entry.timestamp);
        if (!fallbackTimestamp && entryTimestamp) {
            fallbackTimestamp = entryTimestamp;
        }
        if (entry.type !== "message")
            continue;
        if (!lastActivityAt && entryTimestamp) {
            lastActivityAt = entryTimestamp;
        }
        if (!lastUserMessage && isRecord(entry.message) && entry.message.role === "user") {
            lastUserMessage = extractMessageText(entry.message.content);
        }
    }
    return {
        title,
        lastActivityAt: lastActivityAt ?? fallbackTimestamp,
        lastUserMessage,
        model,
        thinkingOptionId,
    };
}
function extractModel(entry) {
    if (entry.type === "model_change") {
        // Pi records provider + modelId; OMP records a combined model string.
        return buildModelId(entry.provider, entry.modelId) ?? readNonEmptyString(entry.model);
    }
    if (entry.type === "message" && isRecord(entry.message)) {
        return buildModelId(entry.message.provider, entry.message.model);
    }
    return null;
}
function extractThinkingOptionId(entry) {
    return entry.type === "thinking_level_change" ? readNonEmptyString(entry.thinkingLevel) : null;
}
function buildModelId(provider, modelId) {
    const providerName = readNonEmptyString(provider);
    const modelName = readNonEmptyString(modelId);
    if (!providerName || !modelName) {
        return null;
    }
    return `${providerName}/${modelName}`;
}
function parseJsonRecord(line) {
    if (!line)
        return null;
    try {
        const parsed = JSON.parse(line);
        return isRecord(parsed) ? parsed : null;
    }
    catch {
        return null;
    }
}
function isRecord(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
function readNonEmptyString(value) {
    return typeof value === "string" && value.trim() ? value.trim() : null;
}
function normalizePromptPreview(text) {
    const normalized = text?.trim().replace(/\s+/g, " ") ?? "";
    if (!normalized)
        return null;
    return normalized.length > 160 ? normalized.slice(0, 160) : normalized;
}
function readReadableSessionTitleFromPath(filePath) {
    const stem = path.basename(filePath, ".jsonl").trim();
    if (!stem) {
        return null;
    }
    if (/^\d{4}-\d{2}-\d{2}T\d{2}[-:]\d{2}[-:]\d{2}/u.test(stem)) {
        return null;
    }
    if (/^[0-9a-f]{8,}$/iu.test(stem)) {
        return null;
    }
    return stem;
}
function parseDate(value) {
    if (typeof value !== "string" && typeof value !== "number") {
        return null;
    }
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
}
function extractMessageText(content) {
    if (typeof content === "string") {
        return content.trim() || null;
    }
    if (!Array.isArray(content)) {
        return null;
    }
    const text = content
        .flatMap((part) => isRecord(part) && part.type === "text" && typeof part.text === "string" ? [part.text] : [])
        .join("\n\n")
        .trim();
    return text || null;
}
//# sourceMappingURL=session-descriptor.js.map