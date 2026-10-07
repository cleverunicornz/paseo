/**
 * The apply_patch format as the pinned Codex executor (0.159.2) reads it:
 * `codex-rs/apply-patch/src/parser.rs` and `streaming_parser.rs`. This parser
 * finds the same hunk headers the executor finds, including its lenient forms
 * (padded headers, a heredoc wrapper, CRLF), so every path a patch touches can
 * be checked. `renderPatch` then writes the patch back with the checked paths:
 * the executor is only ever given a patch whose every path was judged.
 */

const BEGIN_PATCH = "*** Begin Patch";
const END_PATCH = "*** End Patch";
const ADD_FILE = "*** Add File: ";
const DELETE_FILE = "*** Delete File: ";
const UPDATE_FILE = "*** Update File: ";
const MOVE_TO = "*** Move to: ";
const END_OF_FILE = "*** End of File";
const ENVIRONMENT_ID = "*** Environment ID:";
const HEREDOC_OPENERS = new Set(["<<EOF", "<<'EOF'", '<<"EOF"']);

// Rust's char::is_whitespace (Unicode White_Space); JavaScript's trim differs
// on U+0085 and U+FEFF.
const RUST_WHITESPACE =
  "\\t\\n\\v\\f\\r \\u0085\\u00a0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000";
const LEADING_WHITESPACE = new RegExp(`^[${RUST_WHITESPACE}]+`);
const TRAILING_WHITESPACE = new RegExp(`[${RUST_WHITESPACE}]+$`);

function trimEnd(value: string): string {
  return value.replace(TRAILING_WHITESPACE, "");
}

function trim(value: string): string {
  return trimEnd(value).replace(LEADING_WHITESPACE, "");
}

export type PatchHunk =
  | { kind: "add"; path: string; lines: string[] }
  | { kind: "delete"; path: string }
  | { kind: "update"; path: string; movePath: string | null; lines: string[] };

export class PatchFormatError extends Error {
  constructor(message: string) {
    super(`Invalid patch: ${message}`);
    this.name = "PatchFormatError";
  }
}

/** Every path a hunk reads, writes or removes. */
export function hunkPaths(hunk: PatchHunk): string[] {
  if (hunk.kind === "update" && hunk.movePath !== null) return [hunk.path, hunk.movePath];
  return [hunk.path];
}

/** Rust's `str::lines`: split on LF, drop one trailing CR per line, no final empty line. */
function rustLines(text: string): string[] {
  if (text === "") return [];
  const lines = text.split("\n");
  if (lines[lines.length - 1] === "") lines.pop();
  return lines.map((line) => (line.endsWith("\r") ? line.slice(0, -1) : line));
}

function patchBodyLines(text: string): string[] {
  const lines = rustLines(trim(text));
  const isBounded = (candidate: string[]) =>
    candidate.length > 0 &&
    trim(candidate[0]!) === BEGIN_PATCH &&
    trim(candidate[candidate.length - 1]!) === END_PATCH;
  if (isBounded(lines)) return lines;
  if (
    lines.length >= 4 &&
    HEREDOC_OPENERS.has(lines[0]!) &&
    lines[lines.length - 1]!.endsWith("EOF") &&
    isBounded(lines.slice(1, -1))
  ) {
    return lines.slice(1, -1);
  }
  throw new PatchFormatError(
    "the first line must be '*** Begin Patch' and the last '*** End Patch'",
  );
}

/**
 * Splits a patch into its hunks the way the executor does. Body lines are kept
 * verbatim; the executor judges them when it applies the rendered patch.
 */
export function parsePatch(text: string): PatchHunk[] {
  // The executor joins the bounded lines with LF and strips one more CR per line.
  const lines = patchBodyLines(text).map((line) =>
    line.endsWith("\r") ? line.slice(0, -1) : line,
  );
  const hunks: PatchHunk[] = [];
  let ended = false;

  function header(candidate: string): boolean {
    if (candidate === END_PATCH) {
      ended = true;
      return true;
    }
    if (candidate.startsWith(ADD_FILE)) {
      hunks.push({ kind: "add", path: candidate.slice(ADD_FILE.length), lines: [] });
      return true;
    }
    if (candidate.startsWith(DELETE_FILE)) {
      hunks.push({ kind: "delete", path: candidate.slice(DELETE_FILE.length) });
      return true;
    }
    if (candidate.startsWith(UPDATE_FILE)) {
      hunks.push({
        kind: "update",
        path: candidate.slice(UPDATE_FILE.length),
        movePath: null,
        lines: [],
      });
      return true;
    }
    return false;
  }

  for (const [index, line] of lines.entries()) {
    if (index === 0) continue; // *** Begin Patch
    if (ended) {
      if (trim(line) !== "") throw new PatchFormatError("text after '*** End Patch'");
      continue;
    }
    // The executor reads its final line with a full trim in every mode.
    if (index === lines.length - 1 && trim(line) === END_PATCH) {
      ended = true;
      continue;
    }
    const current = hunks[hunks.length - 1];
    if (current?.kind === "update") {
      const updateLine = trimEnd(line);
      if (header(updateLine)) continue;
      // The executor takes a move until the hunk's first chunk; a bare
      // '*** End of File' opens none.
      const opensNoChunk = current.lines.every((seen) => trimEnd(seen) === END_OF_FILE);
      if (opensNoChunk && current.movePath === null && updateLine.startsWith(MOVE_TO)) {
        current.movePath = updateLine.slice(MOVE_TO.length);
        continue;
      }
      current.lines.push(line);
      continue;
    }
    const trimmed = trim(line);
    if (!current && trimmed.startsWith(ENVIRONMENT_ID)) {
      throw new PatchFormatError("'*** Environment ID' is not supported");
    }
    if (header(trimmed)) continue;
    if (current?.kind === "add" && line.startsWith("+")) {
      current.lines.push(line);
      continue;
    }
    throw new PatchFormatError(
      `'${trimmed}' is not a valid hunk header. Valid hunk headers: '*** Add File: {path}', ` +
        "'*** Delete File: {path}', '*** Update File: {path}'",
    );
  }
  if (!ended) throw new PatchFormatError("the last line must be '*** End Patch'");
  return hunks;
}

/** Writes hunks back as a patch with unpadded headers. */
export function renderPatch(hunks: PatchHunk[]): string {
  const out = [BEGIN_PATCH];
  for (const hunk of hunks) {
    if (hunk.kind === "add") {
      out.push(`${ADD_FILE}${hunk.path}`, ...hunk.lines);
    } else if (hunk.kind === "delete") {
      out.push(`${DELETE_FILE}${hunk.path}`);
    } else {
      out.push(`${UPDATE_FILE}${hunk.path}`);
      if (hunk.movePath !== null) out.push(`${MOVE_TO}${hunk.movePath}`);
      out.push(...hunk.lines);
    }
  }
  out.push(END_PATCH, "");
  return out.join("\n");
}
