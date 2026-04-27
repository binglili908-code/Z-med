import fs from "node:fs";
import path from "node:path";

import { EnvValidationError, validateServerEnv } from "../lib/env/server";

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

loadLocalEnvFiles();

try {
  validateServerEnv();
  console.log("Environment check passed. No secret values were printed.");
} catch (error) {
  if (error instanceof EnvValidationError) {
    console.error("Environment check failed:");
    for (const issue of error.issues) {
      console.error(`- ${issue.name}: ${issue.message}`);
    }
    process.exitCode = 1;
  } else {
    throw error;
  }
}
