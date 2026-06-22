#!/usr/bin/env node
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, resolve } from "node:path";
import ts from "typescript";

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

function transpileSourceForSmoke() {
  const tempDir = mkdtempSync(resolve(tmpdir(), "pi-goal-smoke-"));
  for (const fileName of readdirSync(resolve(root, "src"))) {
    if (!fileName.endsWith(".ts")) continue;
    const source = readFileSync(resolve(root, "src", fileName), "utf8");
    const transpiled = ts.transpileModule(source, {
      compilerOptions: {
        module: ts.ModuleKind.ESNext,
        target: ts.ScriptTarget.ES2022,
      },
      fileName,
    }).outputText.replace(/(from\s+["'].+?)\.ts(["'])/g, "$1.mjs$2");
    writeFileSync(resolve(tempDir, basename(fileName, ".ts") + ".mjs"), transpiled);
  }
  return tempDir;
}

async function smokeRegisterExtension() {
  const tempDir = transpileSourceForSmoke();
  try {
    const extension = await import(resolve(tempDir, "index.mjs"));
    if (typeof extension.default !== "function") fail("extension default export must be a function");
    if (process.exitCode) return;

    const activeTools = [];
    const pi = {
      appendEntry() {},
      getActiveTools: () => activeTools,
      on() {},
      registerCommand() {},
      registerMessageRenderer() {},
      registerTool() {},
      sendMessage() {},
      sendUserMessage() {},
      setActiveTools(tools) {
        activeTools.splice(0, activeTools.length, ...tools);
      },
    };

    extension.default(pi);
  } catch (error) {
    fail(`extension registration failed: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
}

await smokeRegisterExtension();

if (process.exitCode) process.exit(process.exitCode);
console.log("package smoke passed");
