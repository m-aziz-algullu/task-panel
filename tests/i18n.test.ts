import { describe, expect, it } from "vitest";
import { pickLocale } from "@/i18n/config";
import en from "@/i18n/dictionaries/en";
import tr from "@/i18n/dictionaries/tr";
import { translate } from "@/i18n/translate";

function keys(value: object, prefix = ""): string[] {
  return Object.entries(value).flatMap(([key, child]) =>
    typeof child === "object" && !("other" in child) ? keys(child, `${prefix}${key}.`) : [`${prefix}${key}`],
  );
}

describe("dictionaries", () => {
  it("have the same keys in every language", () => {
    expect(keys(en).sort()).toEqual(keys(tr).sort());
  });

  it("use the same {placeholders} in every language", () => {
    const placeholders = (text: unknown) => JSON.stringify(text).match(/\{\w+\}/g)?.sort() ?? [];
    for (const key of keys(tr)) {
      const [group, name] = key.split(".") as [keyof typeof tr, string];
      const pick = (dict: typeof tr) => (dict[group] as Record<string, unknown>)[name];
      expect(placeholders(pick(en)), key).toEqual(placeholders(pick(tr)));
    }
  });
});

describe("translate", () => {
  it("fills placeholders", () => {
    expect(translate(en, "en-US", "task.heading", { id: 7 })).toBe("Task #7");
  });

  it("picks plural forms per language", () => {
    expect(translate(en, "en-US", "completed.tasks", { count: 1 })).toBe("1 task");
    expect(translate(en, "en-US", "completed.tasks", { count: 3 })).toBe("3 tasks");
    expect(translate(tr, "tr-TR", "completed.tasks", { count: 3 })).toBe("3 task");
  });
});

describe("pickLocale", () => {
  it("follows the browser's preference order and q-values", () => {
    expect(pickLocale("tr-TR,tr;q=0.9,en-US;q=0.8")).toBe("tr");
    expect(pickLocale("de-DE,de;q=0.9,tr;q=0.7,en;q=0.8")).toBe("en");
    expect(pickLocale("en;q=0.5,tr;q=0.9")).toBe("tr");
  });

  it("falls back to English", () => {
    expect(pickLocale("de-DE,fr;q=0.8")).toBe("en");
    expect(pickLocale(null)).toBe("en");
    expect(pickLocale("")).toBe("en");
  });
});
