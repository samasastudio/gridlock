import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { join } from "node:path";

const extraArgs = process.argv.slice(2);

function collectDefaultTestFiles() {
  const packagesDir = join(process.cwd(), "packages");
  const files = [];
  for (const pkg of readdirSync(packagesDir, { withFileTypes: true })) {
    if (!pkg.isDirectory()) continue;
    const testDir = join(packagesDir, pkg.name, "test");
    try {
      for (const entry of readdirSync(testDir, { withFileTypes: true })) {
        if (entry.isFile() && /\.test\.(ts|tsx)$/.test(entry.name)) {
          files.push(join("packages", pkg.name, "test", entry.name));
        }
      }
    } catch {
      // Ignore packages without a test directory
    }
  }
  return files.sort();
}

const targets = extraArgs.length > 0 ? extraArgs : collectDefaultTestFiles();

const result = spawnSync(process.execPath, ["--test", ...targets], {
  cwd: process.cwd(),
  stdio: "inherit",
});

process.exit(result.status ?? 1);
