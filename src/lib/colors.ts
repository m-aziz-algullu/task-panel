export const TAG_COLOR_PRESETS = [
  "#ef4444",
  "#f97316",
  "#eab308",
  "#22c55e",
  "#14b8a6",
  "#06b6d4",
  "#3b82f6",
  "#6366f1",
  "#a855f7",
  "#ec4899",
  "#64748b",
  "#0f172a",
];

const HEX = /^#[0-9a-f]{6}$/i;

export function isHexColor(value: string): boolean {
  return HEX.test(value);
}

/**
 * Black or white text for a solid `hex` background. White wins whenever it
 * reaches 3:1 contrast (fine for the short bold labels on tag pills), since
 * mid-tone colors like blue or purple look wrong with black text.
 */
export function readableTextColor(hex: string): "#000000" | "#ffffff" {
  if (!isHexColor(hex)) return "#ffffff";
  const channel = (i: number) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  const luminance = 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
  return 1.05 / (luminance + 0.05) >= 3 ? "#ffffff" : "#000000";
}
