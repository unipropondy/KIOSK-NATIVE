// Singapore timezone helper functions (SGT = UTC+8)

export function parseDatabaseDate(dateStr: any): Date {
  if (!dateStr) return new Date();
  if (dateStr instanceof Date) return dateStr;
  const parsed = new Date(dateStr);
  return isNaN(parsed.getTime()) ? new Date() : parsed;
}

export function formatToSingaporeDate(
  dateInput?: any,
  options?: Intl.DateTimeFormatOptions
): string {
  const d = parseDatabaseDate(dateInput);
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Singapore",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    ...options,
  }).format(d);
}

export function formatToSingaporeTime(
  dateInput?: any,
  options?: Intl.DateTimeFormatOptions
): string {
  const d = parseDatabaseDate(dateInput);
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Singapore",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
    ...options,
  }).format(d);
}

export function formatToSingaporeDateTime(
  dateInput?: any,
  options?: Intl.DateTimeFormatOptions
): string {
  const d = parseDatabaseDate(dateInput);
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Singapore",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
    ...options,
  }).format(d);
}
