import { describe, expect, it } from "vitest";
import { parseTemplate, reconcileValues, renderPrompt } from "./template";
import { createExample } from "./library";

describe("template parsing and generation", () => {
  it("matches the mockup's song prompt", () => {
    const prompt = createExample().prompts[0];
    const parsed = parseTemplate(prompt.template);
    expect(parsed.fields.map((field) => field.name)).toEqual([
      "Song Name",
      "Song Genre",
      "BPM",
      "Expected Length",
      "Key",
      "Extra Details",
    ]);
    expect(renderPrompt(parsed, prompt.values)).toBe(
      "Build a song in Reaper using the Reaper MCP. The song name is Midnight Lanterns. The genre is Orchestra. The BPM is 154 and the expected length is 2 minutes. The key is A Major. It must include a bell.",
    );
  });

  it("supports quoted delimiters, escapes, whitespace, multiline text, and repeated fields", () => {
    const parsed = parseTemplate(
      `\${ 'Choice' : Select : "a,b}", 'say \\"hi\\"' }\n\${"Name":Text} / \${"Name":Text}`,
    );
    expect(parsed.fields).toHaveLength(2);
    expect(parsed.fields[0].options).toEqual(["a,b}", 'say "hi"']);
    expect(renderPrompt(parsed, { Choice: "a,b}", Name: "Ada" })).toBe(
      "a,b}\nAda / Ada",
    );
  });

  it.each([
    `\${'Name':Text`,
    `\${'Name':Number}`,
    `\${'':Text}`,
    `\${'Genre':Select:}`,
    `\${'Genre':Select:"A",}`,
    `\${'Genre':Select:""}`,
    `\${'Key':Select:"G,"A Major"}`,
    `\${'A':Text} \${'A':Select:"one"}`,
    `\${'Name':Text:unexpected}`,
  ])("rejects malformed placeholders: %s", (template) => {
    expect(() => parseTemplate(template)).toThrow(/character/);
  });

  it("keeps compatible input and resets dropdown choices removed by template edits", () => {
    const parsed = parseTemplate(
      `\${'Name':Text} \${'Genre':Select:"EDM","Jazz"} \${'New':Text}`,
    );
    expect(
      reconcileValues(parsed.fields, {
        Name: "Song",
        Genre: "Orchestra",
        Removed: "gone",
      }),
    ).toEqual({ Name: "Song", Genre: "EDM", New: "" });
    expect(reconcileValues(parsed.fields, { Genre: "Jazz" }).Genre).toBe(
      "Jazz",
    );
  });

  it("renders multiline TextArea values literally and reuses repeated fields", () => {
    const parsed = parseTemplate(
      `Notes:\n\${ 'Details' : TextArea }\nAgain:\n\${"Details":TextArea}`,
    );
    expect(parsed.fields).toEqual([
      { name: "Details", kind: "TextArea", options: [] },
    ]);
    expect(reconcileValues(parsed.fields, {})).toEqual({ Details: "" });
    const Details = "First line\nSecond line\n${'Literal':Text}";
    const restored = JSON.parse(JSON.stringify({ Details }));
    expect(renderPrompt(parsed, reconcileValues(parsed.fields, restored))).toBe(
      `Notes:\n${Details}\nAgain:\n${Details}`,
    );
  });

  it("preserves text when switching between Text and TextArea", () => {
    const values = { Details: "Line one\nLine two" };
    for (const kind of ["Text", "TextArea"]) {
      const parsed = parseTemplate(`\${'Details':${kind}}`);
      expect(reconcileValues(parsed.fields, values)).toEqual(values);
      expect(renderPrompt(parsed, values)).toBe(values.Details);
    }
  });

  it.each([
    `\${'Details':TextArea`,
    `\${'Details':Textarea}`,
    `\${'Details':TextArea:"extra"}`,
    `\${'Details':TextArea} \${'Details':Text}`,
  ])("rejects malformed or inconsistent TextArea fields: %s", (template) => {
    expect(() => parseTemplate(template)).toThrow(/character/);
  });

  it("renders plain templates and treats field values as literal strings", () => {
    expect(renderPrompt(parseTemplate("Just text."), {})).toBe("Just text.");
    expect(
      renderPrompt(parseTemplate(`\${'Value':Text}`), {
        Value: `\${'Other':Text}`,
      }),
    ).toBe(`\${'Other':Text}`);
    const parsed = parseTemplate(`\${'__proto__':Text} \${'constructor':Text}`);
    expect(renderPrompt(parsed, reconcileValues(parsed.fields, {}))).toBe(" ");
  });

  it("renders the checked and unchecked versions of the supplied Toggle example", () => {
    const parsed = parseTemplate(
      `\${'Show Comments':Toggle:"Generate comments for each public method and class.", "Do not add any comments unless explicitly instructed otherwise."}`,
    );
    expect(parsed.fields).toEqual([
      {
        name: "Show Comments",
        kind: "Toggle",
        options: [
          "Generate comments for each public method and class.",
          "Do not add any comments unless explicitly instructed otherwise.",
        ],
      },
    ]);
    const defaults = reconcileValues(parsed.fields, {});
    expect(defaults).toEqual({ "Show Comments": "false" });
    expect(renderPrompt(parsed, defaults)).toBe(
      "Do not add any comments unless explicitly instructed otherwise.",
    );
    expect(renderPrompt(parsed, { "Show Comments": "true" })).toBe(
      "Generate comments for each public method and class.",
    );
  });

  it("preserves checkbox state across saves and edits to its versions", () => {
    const parsed = parseTemplate(
      `\${'Comments':Toggle:"Revised yes", "Revised no"}`,
    );
    const restoredValues = JSON.parse(JSON.stringify({ Comments: "true" }));
    expect(
      renderPrompt(parsed, reconcileValues(parsed.fields, restoredValues)),
    ).toBe("Revised yes");
    expect(
      renderPrompt(
        parsed,
        reconcileValues(parsed.fields, { Comments: "false" }),
      ),
    ).toBe("Revised no");
    expect(
      reconcileValues(parsed.fields, { Comments: "unrelated text" }),
    ).toEqual({ Comments: "false" });
  });

  it("allows equal or empty Toggle versions and reuses repeated toggles", () => {
    const same = parseTemplate(`\${'A':Toggle:"same", "same"}`);
    expect(same.fields[0].options).toEqual(["same", "same"]);
    expect(renderPrompt(same, { A: "true" })).toBe("same");
    expect(renderPrompt(same, { A: "false" })).toBe("same");
    const repeated = parseTemplate(
      `\${'A':Toggle:"Yes, with } delimiter", ""} / \${'A':Toggle:"Yes, with } delimiter", ""}`,
    );
    expect(repeated.fields).toHaveLength(1);
    expect(renderPrompt(repeated, { A: "false" })).toBe(" / ");
    expect(renderPrompt(repeated, { A: "true" })).toBe(
      "Yes, with } delimiter / Yes, with } delimiter",
    );
  });

  it.each([
    `\${'A':Toggle}`,
    `\${'A':Toggle:"Yes"}`,
    `\${'A':Toggle:"Yes",}`,
    `\${'A':Toggle:"Yes", "No", "Maybe"}`,
    `\${'A':Toggle:"Yes", "No",}`,
    `\${'A':Toggle:"Yes", No}`,
    `\${'A':Toggle:"Yes", "No"} \${'A':Toggle:"Changed", "No"}`,
  ])("rejects malformed Toggle fields: %s", (template) => {
    expect(() => parseTemplate(template)).toThrow(/character/);
  });

  it("parses the supplied Date field and formats a selected calendar date", () => {
    const parsed = parseTemplate(
      `Timesheet: \${'Timesheet Date':Date:"MM/DD/YYYY"}`,
    );
    expect(parsed.fields).toEqual([
      {
        name: "Timesheet Date",
        kind: "Date",
        options: [],
        format: "MM/DD/YYYY",
      },
    ]);
    expect(reconcileValues(parsed.fields, {})).toEqual({
      "Timesheet Date": "",
    });
    expect(renderPrompt(parsed, {})).toBe("Timesheet: ");
    expect(renderPrompt(parsed, { "Timesheet Date": "2026-10-11" })).toBe(
      "Timesheet: 10/11/2026",
    );
    expect(renderPrompt(parsed, { "Timesheet Date": "" })).toBe("Timesheet: ");
  });

  it.each([
    ["DD/MM/YYYY", "11/10/2026"],
    ["YYYY-MM-DD", "2026-10-11"],
    ["M/D/YY", "10/11/26"],
    ["ddd, MMM D, YYYY", "Sun, Oct 11, 2026"],
    ["dddd, MMMM DD, YYYY [timesheet]", "Sunday, October 11, 2026 timesheet"],
  ])("keeps saved dates when changing the format to %s", (format, result) => {
    const parsed = parseTemplate(`\${'Date':Date:"${format}"}`);
    const restoredValues = JSON.parse(JSON.stringify({ Date: "2026-10-11" }));
    const values = reconcileValues(parsed.fields, restoredValues);
    expect(values).toEqual({ Date: "2026-10-11" });
    expect(renderPrompt(parsed, values)).toBe(result);
  });

  it("validates leap days and rejects impossible or noncanonical stored dates", () => {
    const parsed = parseTemplate(`\${'Date':Date:"MM/DD/YYYY"}`);
    expect(renderPrompt(parsed, { Date: "2024-02-29" })).toBe("02/29/2024");
    for (const Date of [
      "2025-02-29",
      "2026-04-31",
      "2026-13-01",
      "10/11/2026",
      "2026-1-1",
      "not a date",
    ]) {
      expect(reconcileValues(parsed.fields, { Date })).toEqual({ Date: "" });
      expect(renderPrompt(parsed, { Date })).toBe("");
    }
  });

  it("reuses repeated Date fields with matching formats", () => {
    const parsed = parseTemplate(
      `\${ 'Date' : Date : 'YYYY-MM-DD' } / \${'Date':Date:"YYYY-MM-DD"}`,
    );
    expect(parsed.fields).toHaveLength(1);
    expect(renderPrompt(parsed, { Date: "2026-01-01" })).toBe(
      "2026-01-01 / 2026-01-01",
    );
  });

  it.each([
    `\${'Date':Date}`,
    `\${'Date':Date:MM/DD/YYYY}`,
    `\${'Date':Date:""}`,
    `\${'Date':Date:"mm/dd/yyyy"}`,
    `\${'Date':Date:"YYYY-MM-DD HH:mm"}`,
    `\${'Date':Date:"[literal only]"}`,
    `\${'Date':Date:"MM/DD/YYYY [unclosed"}`,
    `\${'Date':Date:"MM/DD/YYYY", "YYYY-MM-DD"}`,
    `\${'Date':Date:"MM/DD/YYYY"} \${'Date':Date:"DD/MM/YYYY"}`,
  ])("rejects malformed Date fields: %s", (template) => {
    expect(() => parseTemplate(template)).toThrow(/character/);
  });
});
