import { readdir, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";

export const SKIP_MD = new Set(["readme.md", "bundle-for-review.md"]);

export function shouldIncludeMdFile(name: string): boolean {
  const lower = name.toLowerCase();
  return (
    name.endsWith(".md") &&
    !name.startsWith("_") &&
    !SKIP_MD.has(lower) &&
    !lower.startsWith("bundle-")
  );
}

export async function listReportMdFiles(dir: string): Promise<string[]> {
  const names = await readdir(dir);
  return names.filter(shouldIncludeMdFile).sort();
}

export async function readReportFiles(
  dir: string,
  fileNames?: string[],
): Promise<Array<{ name: string; path: string; text: string }>> {
  const names = fileNames ?? (await listReportMdFiles(dir));
  const out: Array<{ name: string; path: string; text: string }> = [];
  for (const name of names) {
    const path = join(dir, name);
    if (!existsSync(path)) continue;
    out.push({ name, path, text: await readFile(path, "utf8") });
  }
  return out;
}
