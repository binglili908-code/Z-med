export function startOfIsoWeek(date: Date) {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() - day + 1);
  return d;
}

export function toDateString(date: Date) {
  return date.toISOString().slice(0, 10);
}

export function normalizeIsoWeekStart(input?: string | null) {
  if (!input) return toDateString(startOfIsoWeek(new Date()));
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input)) {
    throw new Error("issueWeekStart must use YYYY-MM-DD format");
  }
  const parsed = new Date(`${input}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error("issueWeekStart is invalid");
  }
  return toDateString(startOfIsoWeek(parsed));
}
