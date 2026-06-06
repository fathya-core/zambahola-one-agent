/** Local time helpers — default Arabia (UTC+3) for OMAR-PC dashboard & telemetry */

export function displayTimezone(): string {
  return process.env.ZAMBAHOLA_TZ?.trim() || "Asia/Riyadh";
}

export function formatLocal(
  ms: number,
  opts: Intl.DateTimeFormatOptions = {},
): string {
  const tz = displayTimezone();
  return new Intl.DateTimeFormat("ar-SA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
    ...opts,
  }).format(new Date(ms));
}

export function formatLocalShort(ms: number): string {
  return formatLocal(ms, {
    year: undefined,
    month: undefined,
    day: undefined,
  });
}

export function formatUptime(ms: number): string {
  const sec = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  if (h > 0) return `${h}س ${m}د ${s}ث`;
  if (m > 0) return `${m}د ${s}ث`;
  return `${s}ث`;
}

export function localHourFraction(ms: number): number {
  const tz = displayTimezone();
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hour: "numeric",
    minute: "numeric",
    hour12: false,
  }).formatToParts(new Date(ms));
  const hour = Number(parts.find((p) => p.type === "hour")?.value ?? 0);
  const minute = Number(parts.find((p) => p.type === "minute")?.value ?? 0);
  return hour + minute / 60;
}

export function timeSnapshot(startedAt: number | null, lastTickAt: number | null) {
  const now = Date.now();
  const tz = displayTimezone();
  return {
    timezone: tz,
    nowUtc: new Date(now).toISOString(),
    nowLocal: formatLocal(now),
    startedAtLocal: startedAt != null ? formatLocal(startedAt) : null,
    lastTickLocal: lastTickAt != null ? formatLocal(lastTickAt) : null,
    uptimeSec: startedAt != null ? Math.floor((now - startedAt) / 1000) : 0,
    uptimeLabel: startedAt != null ? formatUptime(now - startedAt) : "—",
    lastTickAgeSec:
      lastTickAt != null ? Math.max(0, Math.floor((now - lastTickAt) / 1000)) : null,
  };
}
