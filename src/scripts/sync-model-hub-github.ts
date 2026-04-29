import fs from "node:fs";
import path from "node:path";

import { runGitHubModelHubSync } from "@/lib/github-model-hub";

function unquoteEnvValue(value: string) {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function loadEnvFile(filePath: string) {
  if (!fs.existsSync(filePath)) return;
  const content = fs.readFileSync(filePath, "utf-8");
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const separatorIndex = line.indexOf("=");
    if (separatorIndex <= 0) continue;
    const key = line.slice(0, separatorIndex).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;
    if (process.env[key] != null) continue;
    process.env[key] = unquoteEnvValue(line.slice(separatorIndex + 1));
  }
}

function loadLocalEnvFiles() {
  const root = process.cwd();
  loadEnvFile(path.join(root, ".env"));
  loadEnvFile(path.join(root, ".env.local"));
}

function hasFlag(flag: string) {
  return process.argv.includes(flag);
}

function readNumberFlag(name: string, fallback: number) {
  const prefix = `--${name}=`;
  const raw = process.argv.find((arg) => arg.startsWith(prefix))?.slice(prefix.length);
  if (!raw) return fallback;
  const value = Number(raw);
  return Number.isFinite(value) ? value : fallback;
}

async function main() {
  loadLocalEnvFiles();

  const apply = hasFlag("--apply");
  const confirmedWrite = hasFlag("--yes-i-understand-this-writes-to-database");
  if (apply && !confirmedWrite) {
    throw new Error(
      "Refusing to write. Re-run with --apply --yes-i-understand-this-writes-to-database after reviewing dry-run output.",
    );
  }

  const result = await runGitHubModelHubSync({
    dryRun: !apply,
    queryLimit: readNumberFlag("query-limit", 8),
    perPage: readNumberFlag("per-page", 30),
  });

  process.stdout.write(
    `${JSON.stringify(
      {
        mode: apply ? "apply" : "dry-run",
        note: apply
          ? "GitHub Model Hub intake wrote model_hub_items."
          : "Dry-run only. No model_hub_items or model_hub_sync_runs rows were written.",
        ...result,
      },
      null,
      2,
    )}\n`,
  );
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
