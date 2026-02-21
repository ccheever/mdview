#!/usr/bin/env bun

import { resolve, join } from "path";
import { parseArgs } from "util";
import { homedir } from "os";
import { existsSync } from "fs";

// ── Font definitions ──

const FONT_NAMES = ["system", "inter", "serif", "sans", "mono", "readable"];

// ── Parse CLI args ──

const { values, positionals } = parseArgs({
  args: Bun.argv.slice(2),
  options: {
    font: {
      type: "string",
      short: "f",
    },
    help: {
      type: "boolean",
      short: "h",
    },
  },
  allowPositionals: true,
  strict: true,
});

if (values.help || positionals.length === 0) {
  console.log(`mdview - A lightweight Markdown viewer

Usage: mdview [options] <file...>

Options:
  -f, --font <font>  Set the display font
  -h, --help         Show this help message

Available fonts:
  system     System Default (default)
  inter      Inter
  serif      Serif (Georgia)
  sans       Sans-serif (Helvetica Neue)
  mono       Monospace (SF Mono)
  readable   Readable (Charter)

Examples:
  mdview README.md
  mdview --font serif README.md CHANGELOG.md
  mdview -f mono notes.md`);
  process.exit(values.help ? 0 : 1);
}

// ── Validate font ──

if (values.font && !FONT_NAMES.includes(values.font)) {
  console.error(
    `Unknown font: "${values.font}"\nAvailable fonts: ${FONT_NAMES.join(", ")}`
  );
  process.exit(1);
}

// ── Save font preference if specified ──

if (values.font) {
  const configDir = join(homedir(), ".config", "mdview");
  const configPath = join(configDir, "settings.json");
  try {
    await Bun.write(configPath, JSON.stringify({ font: values.font }, null, 2));
  } catch {
    const { mkdirSync } = require("fs");
    try {
      mkdirSync(configDir, { recursive: true });
      await Bun.write(
        configPath,
        JSON.stringify({ font: values.font }, null, 2)
      );
    } catch (err) {
      console.error(`Warning: could not save font preference: ${err}`);
    }
  }
}

// ── Find the app bundle ──

function findApp(): string | null {
  const candidates = [
    "/Applications/mdview.app",
    join(homedir(), "Applications/mdview.app"),
    // Dev build locations relative to this script's project
    join(import.meta.dir, "../../build/dev-macos-arm64/mdview-dev.app"),
    join(import.meta.dir, "../../build/dev-macos-x64/mdview-dev.app"),
    join(import.meta.dir, "../../build/macos-arm64/mdview.app"),
    join(import.meta.dir, "../../build/macos-x64/mdview.app"),
  ];

  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }
  return null;
}

const appPath = findApp();
if (!appPath) {
  console.error(
    "Could not find mdview.app. Install it to /Applications or build it first with `bun run build`."
  );
  process.exit(1);
}

// ── Open each file in the app ──

for (const fileArg of positionals) {
  const absPath = resolve(fileArg);

  if (!existsSync(absPath)) {
    console.error(`File not found: ${fileArg}`);
    continue;
  }

  // -n opens a new instance for each file
  const proc = Bun.spawn(["open", "-n", "-a", appPath, "--args", absPath], {
    stdio: ["ignore", "ignore", "pipe"],
  });

  const exitCode = await proc.exited;
  if (exitCode !== 0) {
    const stderr = await new Response(proc.stderr).text();
    console.error(`Failed to open ${fileArg}: ${stderr.trim()}`);
  }
}
