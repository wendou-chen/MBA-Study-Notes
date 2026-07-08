import esbuild from "esbuild";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const rootDir = process.cwd();
const outDir = mkdtempSync(path.join(tmpdir(), "codexidian-runtime-status-"));
const outFile = path.join(outDir, "runtime-status.test.cjs");

try {
  await esbuild.build({
    entryPoints: [path.join(rootDir, "src", "config", "CodexRuntimeStatus.test.ts")],
    bundle: true,
    platform: "node",
    format: "cjs",
    target: "node20",
    outfile: outFile,
    logLevel: "silent",
  });

  const result = spawnSync(process.execPath, [outFile], { stdio: "inherit" });
  if (result.status !== 0) {
    throw new Error(`Runtime status tests failed with exit code ${result.status ?? "unknown"}`);
  }
} finally {
  rmSync(outDir, { recursive: true, force: true });
}
