/**
 * Windows-safe fetch — clears abort timers before process exit (avoids libuv UV_HANDLE_CLOSING).
 */
export async function safeFetchJson(url, timeoutMs = 10000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

export async function safeFetchOk(url, timeoutMs = 12000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal });
    return res.ok;
  } finally {
    clearTimeout(timer);
  }
}

/** Let libuv close handles before exit (Windows collect-telemetry crash) */
export function finishScript(code = 0) {
  process.exitCode = code;
  setImmediate(() => {
    setTimeout(() => process.exit(code), 80);
  });
}
