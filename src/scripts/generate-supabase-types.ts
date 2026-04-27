import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const OUTPUT_FILE = path.join(process.cwd(), "src", "lib", "supabase", "database.types.ts");
const SUPABASE_CLI_PACKAGE = "supabase@2.95.4";

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

function projectRefFromSupabaseUrl(value: string | undefined) {
  if (!value) return null;
  try {
    const host = new URL(value).hostname;
    const match = host.match(/^([a-z0-9-]+)\.supabase\.co$/i);
    return match?.[1] ?? null;
  } catch {
    return null;
  }
}

function resolveProjectRef() {
  return (
    process.env.SUPABASE_PROJECT_REF?.trim() ||
    projectRefFromSupabaseUrl(process.env.NEXT_PUBLIC_SUPABASE_URL) ||
    null
  );
}

function runSupabaseTypegen(projectRef: string) {
  const npxBin = process.platform === "win32" ? "npx.cmd" : "npx";
  const args = [
    "--yes",
    SUPABASE_CLI_PACKAGE,
    "gen",
    "types",
    "typescript",
    "--project-id",
    projectRef,
    "--schema",
    "public",
  ];

  return new Promise<string>((resolve, reject) => {
    const child = spawn(npxBin, args, {
      cwd: process.cwd(),
      env: process.env,
      windowsHide: true,
    });

    let stdout = "";
    let stderr = "";

    child.stdout.setEncoding("utf-8");
    child.stderr.setEncoding("utf-8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0 && stdout.trim()) {
        resolve(stdout);
        return;
      }
      reject(
        new Error(
          [
            "Supabase type generation failed.",
            stderr.trim() || "No error detail was returned by the CLI.",
          ].join("\n"),
        ),
      );
    });
  });
}

loadLocalEnvFiles();

const projectRef = resolveProjectRef();
if (!projectRef) {
  console.error(
    "Missing SUPABASE_PROJECT_REF, and NEXT_PUBLIC_SUPABASE_URL did not look like https://<project-ref>.supabase.co",
  );
  process.exit(1);
}

try {
  const output = await runSupabaseTypegen(projectRef);
  fs.mkdirSync(path.dirname(OUTPUT_FILE), { recursive: true });
  fs.writeFileSync(OUTPUT_FILE, output);
  console.log(`Generated Supabase database types at ${OUTPUT_FILE}`);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
