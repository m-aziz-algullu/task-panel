import type { Dictionary } from "./dictionaries/tr";

// Message lookup shared by the server, the browser and tests.

export type Plural = { one: string; other: string };
type Leaf = string | Plural;

/** "board.newTask" style keys for every message in the dictionary. */
export type MessageKey = {
  [K in keyof Dictionary & string]: Dictionary[K] extends Leaf
    ? K
    : { [S in keyof Dictionary[K] & string]: `${K}.${S}` }[keyof Dictionary[K] & string];
}[keyof Dictionary & string];

export type Vars = Record<string, string | number>;
export type Translate = (key: MessageKey, vars?: Vars) => string;

function isPlural(value: unknown): value is Plural {
  return typeof value === "object" && value !== null && "other" in value;
}

/** Looks up `key`, picks the plural form from `vars.count`, and fills {placeholders}. */
export function translate(dict: Dictionary, intlLocale: string, key: MessageKey, vars: Vars = {}): string {
  const [group, name] = key.split(".") as [keyof Dictionary, string | undefined];
  const entry: unknown = name === undefined ? dict[group] : (dict[group] as Record<string, unknown>)[name];
  let text: string;
  if (isPlural(entry)) {
    const form = new Intl.PluralRules(intlLocale).select(Number(vars.count ?? 0));
    text = form === "one" ? entry.one : entry.other;
  } else {
    text = typeof entry === "string" ? entry : key;
  }
  return text.replace(/\{(\w+)\}/g, (match, variable: string) => (variable in vars ? String(vars[variable]) : match));
}
