#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";

function printUsage() {
  console.log(`Usage:
  node LLMtest/simulate-plugin-install.mjs [options]

Options:
  --target <dir>   Target plugins directory. Default: LLMtest/.simulated-openclaw/plugins
  --copy           Actually copy files into the target directory
  --force          Overwrite an existing simulated install directory
  --json           Print the final report as JSON
  --help           Show this help

Examples:
  node LLMtest/simulate-plugin-install.mjs
  node LLMtest/simulate-plugin-install.mjs --copy
  node LLMtest/simulate-plugin-install.mjs --copy --target C:\\temp\\plugins --force
`);
}

function parseArgs(argv) {
  const args = {
    copy: false,
    force: false,
    json: false,
    help: false,
    target: null,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--copy") {
      args.copy = true;
      continue;
    }
    if (arg === "--force") {
      args.force = true;
      continue;
    }
    if (arg === "--json") {
      args.json = true;
      continue;
    }
    if (arg === "--help" || arg === "-h") {
      args.help = true;
      continue;
    }
    if (arg === "--target") {
      const value = argv[index + 1];
      if (!value) {
        throw new Error("--target requires a directory value");
      }
      args.target = value;
      index += 1;
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  return args;
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf-8"));
}

function ensureFile(filePath, label) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`${label} not found: ${filePath}`);
  }
}

function walkFiles(rootDir) {
  const files = [];
  const entries = fs.readdirSync(rootDir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(rootDir, entry.name);
    if (entry.isDirectory()) {
      files.push(...walkFiles(fullPath));
      continue;
    }
    if (entry.isFile()) {
      files.push(fullPath);
    }
  }
  return files;
}

function toPosixRelative(rootDir, filePath) {
  return path.relative(rootDir, filePath).split(path.sep).join("/");
}

function collectInstallFiles(repoRoot, pkg) {
  const packageFiles = Array.isArray(pkg.files) ? pkg.files : [];
  const includes = new Set();
  const excludes = [];

  for (const entry of packageFiles) {
    if (typeof entry !== "string" || !entry.trim()) continue;
    if (entry.startsWith("!")) {
      excludes.push(entry.slice(1));
      continue;
    }

    if (entry === "src/**/*.ts") {
      const srcRoot = path.join(repoRoot, "src");
      if (fs.existsSync(srcRoot)) {
        for (const filePath of walkFiles(srcRoot)) {
          if (filePath.endsWith(".ts")) {
            includes.add(filePath);
          }
        }
      }
      continue;
    }

    const fullPath = path.join(repoRoot, entry);
    if (!fs.existsSync(fullPath)) continue;
    const stat = fs.statSync(fullPath);
    if (stat.isDirectory()) {
      for (const filePath of walkFiles(fullPath)) {
        includes.add(filePath);
      }
      continue;
    }
    includes.add(fullPath);
  }

  const filtered = [...includes].filter((filePath) => {
    const relative = toPosixRelative(repoRoot, filePath);
    for (const pattern of excludes) {
      if (pattern === "src/**/__tests__/**" && relative.startsWith("src/__tests__/")) {
        return false;
      }
      if (pattern === "src/**/*.test.ts" && relative.startsWith("src/") && relative.endsWith(".test.ts")) {
        return false;
      }
    }
    return true;
  });

  return filtered
    .map((filePath) => ({
      absolutePath: filePath,
      relativePath: toPosixRelative(repoRoot, filePath),
    }))
    .sort((a, b) => a.relativePath.localeCompare(b.relativePath));
}

function copyInstallFiles(repoRoot, files, targetDir) {
  for (const file of files) {
    const fromPath = file.absolutePath;
    const toPath = path.join(targetDir, file.relativePath);
    fs.mkdirSync(path.dirname(toPath), { recursive: true });
    fs.copyFileSync(fromPath, toPath);
  }

  const reportPath = path.join(targetDir, ".install-simulation.json");
  fs.writeFileSync(
    reportPath,
    JSON.stringify(
      {
        simulatedAt: new Date().toISOString(),
        sourceRoot: repoRoot,
        installedFiles: files.map((file) => file.relativePath),
      },
      null,
      2,
    ),
  );
}

function formatReport(report) {
  return [
    `Plugin ID: ${report.pluginId}`,
    `Package: ${report.packageName}@${report.version}`,
    `Channel IDs: ${report.channelIds.join(", ") || "<none>"}`,
    `Extensions: ${report.extensions.join(", ") || "<none>"}`,
    `Mode: ${report.mode}`,
    `Target dir: ${report.targetDir}`,
    `File count: ${report.files.length}`,
    "Files:",
    ...report.files.map((file) => `  - ${file.relativePath}`),
  ].join("\n");
}

function main() {
  const llmtestDir = path.dirname(new URL(import.meta.url).pathname);
  const repoRoot = path.resolve(llmtestDir, "..");
  const args = parseArgs(process.argv.slice(2));

  if (args.help) {
    printUsage();
    return;
  }

  const packageJsonPath = path.join(repoRoot, "package.json");
  const pluginJsonPath = path.join(repoRoot, "openclaw.plugin.json");
  const entryPath = path.join(repoRoot, "index.ts");

  ensureFile(packageJsonPath, "package.json");
  ensureFile(pluginJsonPath, "openclaw.plugin.json");
  ensureFile(entryPath, "plugin entry");

  const pkg = readJson(packageJsonPath);
  const pluginManifest = readJson(pluginJsonPath);
  const pluginId = pluginManifest?.id || pkg?.openclaw?.channel?.id || pkg?.name;
  if (!pluginId) {
    throw new Error("Unable to determine plugin id from package.json or openclaw.plugin.json");
  }

  const targetBase = args.target
    ? path.resolve(repoRoot, args.target)
    : path.join(repoRoot, "LLMtest", ".simulated-openclaw", "plugins");
  const targetDir = path.join(targetBase, pluginId);
  const files = collectInstallFiles(repoRoot, pkg);

  if (files.length === 0) {
    throw new Error("No installable files were collected from package.json#files");
  }

  if (args.copy) {
    if (fs.existsSync(targetDir)) {
      if (!args.force) {
        throw new Error(`Target already exists: ${targetDir}. Re-run with --force to overwrite.`);
      }
      fs.rmSync(targetDir, { recursive: true, force: true });
    }
    fs.mkdirSync(targetDir, { recursive: true });
    copyInstallFiles(repoRoot, files, targetDir);
  }

  const report = {
    pluginId,
    packageName: pkg.name,
    version: pkg.version,
    channelIds: Array.isArray(pluginManifest.channels) ? pluginManifest.channels : [],
    extensions: Array.isArray(pkg.openclaw?.extensions) ? pkg.openclaw.extensions : [],
    mode: args.copy ? "copy" : "dry-run",
    targetDir,
    files,
  };

  if (args.json) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  console.log(formatReport(report));
  if (!args.copy) {
    console.log("\nDry-run only. Re-run with --copy to write the simulated install.");
  }
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}

