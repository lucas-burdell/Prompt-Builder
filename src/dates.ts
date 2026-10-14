import dayjs from "dayjs";
import customParseFormat from "dayjs/plugin/customParseFormat";

dayjs.extend(customParseFormat);

// Use calendar dates in local time so saving and reloading never shifts a day.
export function parseStoredDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = dayjs(value, "YYYY-MM-DD", true);
  return date.isValid() ? date : null;
}

// Keep the accepted tokens aligned with the date picker's editable sections.
// Brackets escape literal text, as in "MMMM D, YYYY [timesheet]".
export function isValidDateFormat(format: string): boolean {
  let remaining = format;
  let hasToken = false;
  while (remaining) {
    const literal = remaining.match(/^\[[^\[\]]*\]/);
    const token = remaining.match(/^(YYYY|YY|MMMM|MMM|MM|M|DD|D|dddd|ddd)/);
    const separator = remaining.match(/^[^A-Za-z\[\]]+/);
    const match = literal ?? token ?? separator;
    if (!match) return false;
    if (token && !literal) hasToken = true;
    remaining = remaining.slice(match[0].length);
  }
  return hasToken;
}

export function formatStoredDate(value: string, format: string): string {
  return parseStoredDate(value)?.format(format) ?? "";
}
