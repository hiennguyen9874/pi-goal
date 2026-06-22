import { test, expect } from "vitest";
import { readFileSync } from "node:fs";

function readPackageJson() {
  return JSON.parse(readFileSync("package.json", "utf8")) as {
    name?: string;
    description?: string;
    keywords?: string[];
    files?: string[];
    pi?: { extensions?: string[]; prompts?: string[] };
    scripts?: Record<string, string>;
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  };
}

test("package metadata describes pi-goal", () => {
  const pkg = readPackageJson();

  expect(pkg.name).toBe("pi-goal");
  expect(pkg.description).toMatch(/goal/i);
  expect(pkg.description).not.toMatch(/hashline/i);
  expect(pkg.keywords).toContain("goal");
  expect(pkg.keywords).toContain("pi-extension");
  expect(pkg.pi?.extensions).toEqual(["./src/index.ts"]);
});

test("package validation scripts are available", () => {
  const pkg = readPackageJson();

  expect(pkg.scripts?.test).toBe("vitest run");
  expect(pkg.scripts?.typecheck).toBe("tsc --noEmit");
  expect(pkg.scripts?.verify).toBe("npm run typecheck && npm test");
  expect(pkg.devDependencies?.typescript).toBeDefined();
});

test("package no longer ships unused hashline runtime dependencies", () => {
  const pkg = readPackageJson();

  expect(pkg.dependencies?.diff).toBeUndefined();
  expect(pkg.dependencies?.["file-type"]).toBeUndefined();
  expect(pkg.dependencies?.["xxhash-wasm"]).toBeUndefined();
});

test("package ships user-facing documentation", () => {
  const pkg = readPackageJson();
  const readme = readFileSync("README.md", "utf8");
  const changelog = readFileSync("CHANGELOG.md", "utf8");

  expect(pkg.files).toContain("README.md");
  expect(pkg.files).toContain("CHANGELOG.md");
  expect(readme).toMatch(/\/goal <objective>/);
  expect(readme).toMatch(/budget_limited/);
  expect(readme).toMatch(/get_goal/);
  expect(changelog).toMatch(/Goal Reliability Upgrade/);
});