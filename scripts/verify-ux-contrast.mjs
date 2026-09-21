#!/usr/bin/env node
import assert from "node:assert/strict";

const TOKENS = {
  bg: "#121418",
  surface1: "#1A1E25",
  surface2: "#232830",
  surface3: "#2C323B",
  text1: "#F4EFEA",
  text2: "#BDB6AB",
  text3: "#9A9588",
  brandFill: "#B4503A",
  brandText: "#E27B60",
  onBrand: "#FFFFFF",
  success: "#34D399",
  warning: "#F2B84B",
  danger: "#E0584C",
  dangerFill: "#C7443A",
};

function rgb(hex) {
  return hex.replace("#", "").match(/../g).map((part) => Number.parseInt(part, 16) / 255);
}
function channel(value) {
  return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
}
function luminance(hex) {
  const [r, g, b] = rgb(hex).map(channel);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
export function contrast(foreground, background) {
  const a = luminance(foreground);
  const b = luminance(background);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}
export function composite(foreground, background, alpha) {
  const fg = rgb(foreground);
  const bg = rgb(background);
  const mixed = fg.map((value, index) => Math.round((value * alpha + bg[index] * (1 - alpha)) * 255));
  return `#${mixed.map((value) => value.toString(16).padStart(2, "0")).join("")}`;
}

const checks = [
  ["text-1 on page", TOKENS.text1, TOKENS.bg, 4.5],
  ["text-2 on surface-1", TOKENS.text2, TOKENS.surface1, 4.5],
  ["text-3 on surface-1", TOKENS.text3, TOKENS.surface1, 4.5],
  ["on-brand on brand-fill", TOKENS.onBrand, TOKENS.brandFill, 4.5],
  ["brand text on page", TOKENS.brandText, TOKENS.bg, 4.5],
  ["brand text on surface-1", TOKENS.brandText, TOKENS.surface1, 4.5],
  ["success on surface-1", TOKENS.success, TOKENS.surface1, 4.5],
  ["warning on surface-1", TOKENS.warning, TOKENS.surface1, 4.5],
  ["danger on surface-1", TOKENS.danger, TOKENS.surface1, 4.5],
  ["on-brand on danger-fill", TOKENS.onBrand, TOKENS.dangerFill, 4.5],
  ["strong input outline on surface-1", composite(TOKENS.text1, TOKENS.surface1, 0.4), TOKENS.surface1, 3],
];

for (const [label, foreground, background, minimum] of checks) {
  const ratio = contrast(foreground, background);
  assert.ok(ratio >= minimum, `${label}: ${ratio.toFixed(2)}:1 is below ${minimum}:1`);
  console.log(`${label}: ${ratio.toFixed(2)}:1 (minimum ${minimum}:1)`);
}

console.log("All HitterLoop Phase 1A contrast checks passed.");
