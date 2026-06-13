/** Local time for telemetry commits — default Asia/Riyadh (UTC+3) */

export function displayTimezone() {
  return process.env.ZAMBAHOLA_TZ?.trim() || "Asia/Riyadh";
}

export function formatLocalNow() {
  const tz = displayTimezone();
  return new Intl.DateTimeFormat("sv-SE", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(new Date());
}

export function telemetryTimeFields() {
  const now = Date.now();
  const tz = displayTimezone();
  return {
    ts: new Date(now).toISOString(),
    localTs: formatLocalNow(),
    timezone: tz,
  };
}
