#!/usr/bin/env node
// Path-routing replacement for dorny/paths-filter, constrained to the glob
// syntax used by .github/ci-paths.yml: "**", "*", "{a,b}", "!(a|b)".
// Org Actions policy allows only GitHub-owned actions plus a small pinned
// set, so CI routing must stay in-repo.
//
// Emits $GITHUB_OUTPUT lines: one boolean per filter group. Non-pull_request
// events route everything (matches the workflow's `full` output contract).
// Pull requests diff base...head via git; tests can inject files through
// CI_ROUTE_FILES (newline-separated) instead.

import { execFileSync } from "node:child_process";
import { appendFileSync, readFileSync } from "node:fs";

function parseArgs(argv) {
  const args = { filters: ".github/ci-paths.yml", base: "", head: "HEAD", event: "push" };
  for (let i = 2; i < argv.length; i += 2) {
    const key = argv[i]?.replace(/^--/, "");
    const value = argv[i + 1];
    if (!(key in args)) throw new Error(`unknown argument: ${argv[i]}`);
    args[key] = value;
  }
  return args;
}

function loadFilters(path) {
  const filters = {};
  let current;
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const filterMatch = /^([a-z_]+):\s*$/.exec(line);
    if (filterMatch) {
      current = filterMatch[1];
      filters[current] = [];
      continue;
    }
    const patternMatch = /^  - "([^"]+)"\s*$/.exec(line);
    if (current && patternMatch) filters[current].push(patternMatch[1]);
  }
  return filters;
}

function escapeLiteral(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function segmentRegex(segment) {
  const extglob = /^(!?)\(([^()]*)\)$/.exec(segment);
  if (extglob) {
    const alternatives = extglob[2].split("|").map(escapeLiteral);
    if (extglob[1]) return `(?!${alternatives.join("|")}(?:/|$))[^/]+`;
    return `(?:${alternatives.join("|")})`;
  }
  let regex = "";
  for (let i = 0; i < segment.length; i++) {
    const char = segment[i];
    if (char === "{") {
      const end = segment.indexOf("}", i);
      if (end === -1) throw new Error(`unbalanced brace in segment: ${segment}`);
      const alternatives = segment.slice(i + 1, end).split(",").map(segmentRegex);
      regex += `(?:${alternatives.join("|")})`;
      i = end;
      continue;
    }
    if (char === "*") {
      if (segment[i + 1] === "*") throw new Error(`"**" must be a whole segment: ${segment}`);
      regex += "[^/]*";
      continue;
    }
    regex += escapeLiteral(char);
  }
  return regex;
}

function compilePattern(pattern) {
  const segments = pattern.split("/");
  let regex = "^";
  for (let i = 0; i < segments.length; i++) {
    const segment = segments[i];
    if (segment === "**") {
      regex += i === segments.length - 1 ? ".*" : "(?:[^/]+/)*";
      continue;
    }
    regex += segmentRegex(segment);
    if (i !== segments.length - 1) regex += "/";
  }
  return new RegExp(`${regex}$`);
}

function changedFiles(base, head) {
  const output = execFileSync("git", ["diff", "--name-only", `${base}...${head}`], {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  return output.split("\n").filter(Boolean);
}

const args = parseArgs(process.argv);
const filters = loadFilters(args.filters);
const compiled = new Map(
  Object.entries(filters).map(([group, patterns]) => [group, patterns.map(compilePattern)]),
);

const outputs = {};
if (args.event === "pull_request") {
  const files =
    process.env.CI_ROUTE_FILES === undefined
      ? changedFiles(args.base, args.head)
      : process.env.CI_ROUTE_FILES.split("\n").filter(Boolean);
  for (const [group, matchers] of compiled) {
    outputs[group] = files.some((file) => matchers.some((matcher) => matcher.test(file)));
  }
} else {
  for (const group of compiled.keys()) outputs[group] = true;
}

const lines = Object.entries(outputs).map(([group, hit]) => `${group}=${hit}`);
if (process.env.GITHUB_OUTPUT) {
  appendFileSync(process.env.GITHUB_OUTPUT, `${lines.join("\n")}\n`);
}
for (const line of lines) console.log(line);
