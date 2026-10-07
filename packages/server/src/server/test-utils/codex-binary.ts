import { accessSync, constants } from "node:fs";
import path from "node:path";

/**
 * A real Codex CLI for tests that drive the Codex app server with no model:
 * `PASEO_TEST_CODEX_BIN` when set, otherwise `codex` on PATH. CI installs the
 * pinned version and sets the variable.
 */
export function resolveTestCodexBinary(): string | null {
  const configured = process.env.PASEO_TEST_CODEX_BIN?.trim();
  if (configured) {
    return configured;
  }
  for (const dir of (process.env.PATH ?? "").split(path.delimiter)) {
    if (!dir) continue;
    const candidate = path.join(dir, "codex");
    try {
      accessSync(candidate, constants.X_OK);
      return candidate;
    } catch {
      // keep looking
    }
  }
  return null;
}
