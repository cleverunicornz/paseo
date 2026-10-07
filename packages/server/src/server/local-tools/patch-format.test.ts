import { describe, expect, test } from "vitest";

import { hunkPaths, parsePatch, renderPatch } from "./patch-format.js";

function wrap(...body: string[]): string {
  return ["*** Begin Patch", ...body, "*** End Patch", ""].join("\n");
}

function paths(patch: string): string[] {
  return parsePatch(patch).flatMap(hunkPaths);
}

describe("parsePatch finds every path the executor touches", () => {
  test("plain headers, including a move", () => {
    expect(
      paths(
        wrap(
          "*** Add File: a.txt",
          "+a",
          "*** Delete File: b.txt",
          "*** Update File: c.txt",
          "*** Move to: d.txt",
          "@@",
          "-c",
          "+d",
        ),
      ),
    ).toEqual(["a.txt", "b.txt", "c.txt", "d.txt"]);
  });

  test("headers padded with whitespace the executor trims", () => {
    expect(
      paths(
        wrap(
          "  *** Add File: a.txt",
          "+a",
          "\t*** Delete File: b.txt",
          " *** Delete File: c.txt",
          "\u0085*** Delete File: d.txt",
          "*** Delete File: e.txt  ",
        ),
      ),
    ).toEqual(["a.txt", "b.txt", "c.txt", "d.txt", "e.txt"]);
  });

  test("a heredoc wrapper and CRLF line ends", () => {
    const patch = [
      "<<'EOF'",
      "*** Begin Patch",
      "*** Add File: a.txt",
      "+a",
      "*** End Patch",
      "EOF",
    ]
      .join("\r\n")
      .concat("\r\n");
    expect(paths(patch)).toEqual(["a.txt"]);
    expect(paths(patch.replace("<<'EOF'", "<<EOF"))).toEqual(["a.txt"]);
    expect(paths(patch.replace("<<'EOF'", '<<"EOF"'))).toEqual(["a.txt"]);
  });

  test("an update hunk sees only right-trimmed headers; a padded line is context", () => {
    const hunks = parsePatch(
      wrap("*** Update File: a.txt", "@@", " *** Add File: not-a-header.txt", "-x", "+y"),
    );
    expect(hunks.flatMap(hunkPaths)).toEqual(["a.txt"]);
    expect(
      paths(wrap("*** Update File: a.txt", "@@", "-x", "*** Add File: b.txt  ", "+b")),
    ).toEqual(["a.txt", "b.txt"]);
  });

  test("a move after a bare end-of-file marker, and a padded move", () => {
    expect(
      paths(wrap("*** Update File: a.txt", "*** End of File", "*** Move to: b.txt", "@@", "-x")),
    ).toEqual(["a.txt", "b.txt"]);
    expect(paths(wrap("*** Update File: a.txt", "*** Move to: b.txt \t", "@@", "-x"))).toEqual([
      "a.txt",
      "b.txt",
    ]);
  });

  test("keeps leading spaces of a path, as the executor does", () => {
    expect(paths(wrap("*** Add File:  spaced.txt", "+a"))).toEqual([" spaced.txt"]);
  });

  test("a final end marker with leading space ends an update hunk", () => {
    expect(
      paths(
        ["*** Begin Patch", "*** Update File: a.txt", "@@", "-x", "  *** End Patch"].join("\n"),
      ),
    ).toEqual(["a.txt"]);
  });

  test("refuses what the executor refuses, and environment IDs", () => {
    expect(() => parsePatch("*** Add File: a.txt\n+a\n")).toThrow(/Begin Patch/);
    expect(() => parsePatch(wrap("*** Add File: a.txt", "a"))).toThrow(/not a valid hunk header/);
    expect(() => parsePatch(wrap("*** Delete File: a.txt", "+a"))).toThrow(
      /not a valid hunk header/,
    );
    expect(() =>
      parsePatch(wrap("*** Environment ID: remote", "*** Add File: a.txt", "+a")),
    ).toThrow(/Environment ID/);
    expect(() =>
      parsePatch(wrap("*** Add File: a.txt", "+a", " *** End Patch", "*** Add File: b.txt", "+b")),
    ).toThrow(/after/);
  });
});

describe("renderPatch", () => {
  test("writes unpadded headers with the given paths and keeps body lines", () => {
    const hunks = parsePatch(
      [
        "<<EOF",
        "*** Begin Patch",
        "  *** Add File: a.txt",
        "+a",
        "*** Update File: b.txt",
        "*** End of File",
        "*** Move to: c.txt  ",
        "@@ context",
        " keep",
        "-old",
        "+new",
        "",
        "*** Delete File: d.txt",
        "*** End Patch",
        "EOF",
      ].join("\r\n"),
    );
    for (const hunk of hunks) {
      hunk.path = `x/${hunk.path}`;
      if (hunk.kind === "update") hunk.movePath = `x/${hunk.movePath}`;
    }
    const renamed = hunks;
    expect(renderPatch(renamed)).toBe(
      wrap(
        "*** Add File: x/a.txt",
        "+a",
        "*** Update File: x/b.txt",
        "*** Move to: x/c.txt",
        "*** End of File",
        "@@ context",
        " keep",
        "-old",
        "+new",
        "",
        "*** Delete File: x/d.txt",
      ),
    );
    expect(parsePatch(renderPatch(renamed))).toEqual(renamed);
  });
});
