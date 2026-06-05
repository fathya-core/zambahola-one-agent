import { readFile, writeFile, rename, unlink } from "node:fs/promises";
import { existsSync } from "node:fs";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Write then rename — avoids half-written JSON on Windows */
export async function writeJsonAtomic(path: string, data: unknown): Promise<void> {
  const tmp = `${path}.${process.pid}.${Date.now()}.tmp`;
  const body = JSON.stringify(data, null, 2);
  await writeFile(tmp, body, "utf8");
  try {
    await rename(tmp, path);
  } catch {
    await writeFile(path, body, "utf8");
    try {
      await unlink(tmp);
    } catch {
      /* */
    }
  }
}

export async function readJsonSafe<T>(path: string, retries = 5): Promise<T | null> {
  if (!existsSync(path)) return null;
  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      const raw = await readFile(path, "utf8");
      if (!raw.trim()) {
        await sleep(40 * (attempt + 1));
        continue;
      }
      return JSON.parse(raw) as T;
    } catch {
      await sleep(50 * (attempt + 1));
    }
  }
  return null;
}
