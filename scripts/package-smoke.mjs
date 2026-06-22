#!/usr/bin/env node
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

function fail(message) {
  console.error(`package smoke failed: ${message}`);
  process.exitCode = 1;
}

const root = process.cwd();
const pkg = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8"));

if (pkg.name !== "pi-goal") fail("package name must be pi-goal");
if (!/goal/i.test(pkg.description ?? "")) fail("description must describe goals");
if (/hashline/i.test(pkg.description ?? "")) fail("description must not mention hashline");
if (!Array.isArray(pkg.pi?.extensions) || !pkg.pi.extensions.includes("./src/index.ts")) {
  fail("pi.extensions must include ./src/index.ts");
}
if (!existsSync(resolve(root, "src/index.ts"))) fail("src/index.ts must exist");
if (!existsSync(resolve(root, "README.md"))) fail("README.md must exist");
if (!existsSync(resolve(root, "CHANGELOG.md"))) fail("CHANGELOG.md must exist");

if (Array.isArray(pkg.pi?.prompts)) {
  for (const promptDir of pkg.pi.prompts) {
    if (!existsSync(resolve(root, promptDir))) fail(`prompt directory missing: ${promptDir}`);
  }
}

for (const shippedPath of ["skills", "prompts"]) {
  if (pkg.files?.includes(shippedPath) && !existsSync(resolve(root, shippedPath))) {
    fail(`files includes missing path: ${shippedPath}`);
  }
}

if (process.exitCode) process.exit(process.exitCode);
console.log("package smoke passed");
