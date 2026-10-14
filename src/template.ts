import { formatStoredDate, isValidDateFormat, parseStoredDate } from "./dates";

export interface TemplateField {
  name: string;
  kind: "Text" | "TextArea" | "Select" | "Toggle" | "Date";
  options: string[];
  format?: string;
}

export type TemplatePart = string | { field: string };
export interface ParsedTemplate {
  fields: TemplateField[];
  parts: TemplatePart[];
}

export class TemplateError extends Error {
  constructor(
    message: string,
    public readonly position: number,
  ) {
    super(`${message} (character ${position + 1})`);
    this.name = "TemplateError";
  }
}

// A small scanner instead of eval or a single regex: delimiters inside quoted
// labels/options are literal text, and incomplete edits produce useful errors.
export function parseTemplate(source: string): ParsedTemplate {
  const fields: TemplateField[] = [];
  const parts: TemplatePart[] = [];
  let cursor = 0;
  const fail = (message: string): never => {
    throw new TemplateError(message, cursor);
  };
  const whitespace = () => {
    while (/\s/.test(source[cursor] ?? "") && cursor < source.length) cursor++;
  };
  const expect = (character: string) => {
    whitespace();
    if (source[cursor] !== character) fail(`Expected '${character}'`);
    cursor++;
  };
  const quoted = (): string => {
    whitespace();
    const quote = source[cursor];
    if (quote !== '"' && quote !== "'")
      fail("Use single or double quotes around labels and choices");
    cursor++;
    let value = "";
    while (cursor < source.length) {
      const character = source[cursor++];
      if (character === quote) return value;
      if (character === "\\") {
        if (cursor >= source.length) fail("Incomplete escape sequence");
        const escaped = source[cursor++];
        const escapes: Record<string, string> = {
          n: "\n",
          r: "\r",
          t: "\t",
          "\\": "\\",
          '"': '"',
          "'": "'",
        };
        if (!(escaped in escapes)) fail("Unsupported escape sequence");
        value += escapes[escaped];
      } else value += character;
    }
    return fail("Unclosed quoted value");
  };

  while (cursor < source.length) {
    const start = source.indexOf("${", cursor);
    if (start === -1) {
      parts.push(source.slice(cursor));
      break;
    }
    if (start > cursor) parts.push(source.slice(cursor, start));
    cursor = start + 2;
    const name = quoted().trim();
    if (!name) fail("Field labels cannot be empty");
    expect(":");
    whitespace();
    const typeStart = cursor;
    while (/[A-Za-z]/.test(source[cursor] ?? "") && cursor < source.length)
      cursor++;
    const kindToken = source.slice(typeStart, cursor);
    if (
      kindToken !== "Text" &&
      kindToken !== "TextArea" &&
      kindToken !== "Select" &&
      kindToken !== "Toggle" &&
      kindToken !== "Date"
    )
      fail("Field type must be Text, TextArea, Select, Toggle, or Date");
    const kind = kindToken as TemplateField["kind"];
    const options: string[] = [];
    let format: string | undefined;
    if (kind === "Select") {
      expect(":");
      do {
        const option = quoted();
        if (!option.trim()) fail("Dropdown choices cannot be empty");
        if (!options.includes(option)) options.push(option);
        whitespace();
        if (source[cursor] !== ",") break;
        cursor++;
      } while (cursor < source.length);
    } else if (kind === "Toggle") {
      expect(":");
      options.push(quoted());
      expect(",");
      options.push(quoted());
      whitespace();
      if (source[cursor] === ",")
        fail("Toggle requires exactly two versions: checked, unchecked");
    } else if (kind === "Date") {
      expect(":");
      format = quoted();
      if (!isValidDateFormat(format))
        fail(
          "Date format must use YYYY, YY, M, MM, MMM, MMMM, D, DD, ddd, or dddd; wrap literal text in brackets",
        );
    }
    expect("}");
    const previous = fields.find((field) => field.name === name);
    if (
      previous &&
      (previous.kind !== kind ||
        JSON.stringify(previous.options) !== JSON.stringify(options) ||
        previous.format !== format)
    ) {
      fail(
        `Repeated field '${name}' must use the same type, choices, and format`,
      );
    }
    if (!previous)
      fields.push({ name, kind, options, ...(format ? { format } : {}) });
    parts.push({ field: name });
  }
  return { fields, parts };
}

export function reconcileValues(
  fields: TemplateField[],
  previous: Record<string, string>,
): Record<string, string> {
  return Object.fromEntries(
    fields.map((field) => {
      const existing = Object.hasOwn(previous, field.name)
        ? previous[field.name]
        : "";
      return [
        field.name,
        field.kind === "Toggle"
          ? existing === "true"
            ? "true"
            : "false"
          : field.kind === "Date"
            ? parseStoredDate(existing)
              ? existing
              : ""
            : field.kind === "Select" && !field.options.includes(existing)
              ? field.options[0]
              : existing,
      ];
    }),
  );
}

export function renderPrompt(
  parsed: ParsedTemplate,
  values: Record<string, string>,
): string {
  const fieldsByName = new Map(
    parsed.fields.map((field) => [field.name, field]),
  );
  return parsed.parts
    .map((part) => {
      if (typeof part === "string") return part;
      const field = fieldsByName.get(part.field);
      const value = Object.hasOwn(values, part.field) ? values[part.field] : "";
      return field?.kind === "Toggle"
        ? field.options[value === "true" ? 0 : 1]
        : field?.kind === "Date"
          ? formatStoredDate(value, field.format!)
          : value;
    })
    .join("");
}
