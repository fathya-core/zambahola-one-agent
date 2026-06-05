import { createRequire } from "node:module";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const pkgRoot = join(here, "../..");
const repoRoot = join(pkgRoot, "../..");

/** pnpm hoists tsx to repo root — resolve for detached spawn on Windows */
export function resolveTsxSpawn(
  scriptPath: string,
): { command: string; args: string[]; shell: boolean } {
  for (const root of [pkgRoot, repoRoot]) {
    try {
      const req = createRequire(join(root, "package.json"));
      const cli = req.resolve("tsx/cli");
      return {
        command: process.execPath,
        args: [cli, scriptPath],
        shell: false,
      };
    } catch {
      /* try next root */
    }
  }

  const binName = process.platform === "win32" ? "tsx.cmd" : "tsx";
  for (const root of [pkgRoot, repoRoot]) {
    const bin = join(root, "node_modules", ".bin", binName);
    if (existsSync(bin)) {
      return { command: bin, args: [scriptPath], shell: process.platform === "win32" };
    }
  }

  return {
    command: process.platform === "win32" ? "npx.cmd" : "npx",
    args: ["tsx", scriptPath],
    shell: process.platform === "win32",
  };
}
