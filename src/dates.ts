const DATE_PATTERN =
  /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{1,2}):(\d{2})(?::(\d{2}))?)?\s*(Z|[+-]\d{2}:?\d{2})?$/i;

/**
 * Parses a schedule date such as `2026-10-12 09:30`, `2026-10-12T09:30:00+02:00`
 * or `2026-10-12` (09:00). Dates without an explicit offset use the device's
 * local time zone. Returns null when the value is not a valid date.
 */
export const parseScheduleDate = (raw: string): Date | null => {
  const match = raw.trim().match(DATE_PATTERN);
  if (!match) return null;
  const [, y, mo, d, h = "9", mi = "0", s = "0", zone] = match;
  const parts = [y, mo, d, h, mi, s].map(Number) as [number, number, number, number, number, number];
  const [year, month, day, hour, minute, second] = parts;
  if (month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || minute > 59 || second > 59) return null;
  let date: Date;
  if (zone) {
    let offsetMinutes = 0;
    if (zone.toUpperCase() !== "Z") {
      const sign = zone.startsWith("-") ? -1 : 1;
      const digits = zone.slice(1).replace(":", "");
      offsetMinutes = sign * (Number(digits.slice(0, 2)) * 60 + Number(digits.slice(2)));
    }
    date = new Date(Date.UTC(year, month - 1, day, hour, minute, second) - offsetMinutes * 60_000);
  } else {
    date = new Date(year, month - 1, day, hour, minute, second);
  }
  // Reject overflowed dates such as 2026-02-31.
  const check = zone ? new Date(Date.UTC(year, month - 1, day)) : date;
  const checkDay = zone ? check.getUTCDate() : check.getDate();
  return Number.isNaN(date.getTime()) || checkDay !== day ? null : date;
};

/** WordPress `date_gmt` format: `YYYY-MM-DDTHH:mm:ss` in UTC. */
export const toWordPressGmt = (date: Date) => date.toISOString().slice(0, 19);

const pad = (value: number) => String(value).padStart(2, "0");

/** Value for an `<input type="datetime-local">` in local time. */
export const toLocalInputValue = (date: Date) =>
  `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;

/** Human-readable local date for notices. */
export const formatLocal = (date: Date) =>
  `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
