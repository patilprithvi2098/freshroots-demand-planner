// Generate placeholder pack shots (SVG) for every SKU in the master, with Freshroots branding.
// Usage: npm run sku-images [-- path/to/sku_master.csv]   → public/skus/<SKU_ID>.svg
// The pack shape comes from the product name and category; colours come from the product.

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { parseCsv } from "../lib/csv/loaders";

type Shape = "carton" | "bottle" | "can" | "box" | "pouch" | "bar" | "jar" | "loaf";

interface Palette {
  pack: string; // main package colour
  accent: string; // band / label colour
  ink: string; // text on the pack
  bg: string; // background tint
  fruit: string; // hero illustration colour
}

const BRAND_GREEN = "#15803d";

const RULES: { match: RegExp; shape: Shape; palette: Palette }[] = [
  { match: /mango/i, shape: "carton", palette: { pack: "#fbbf24", accent: "#f97316", ink: "#431407", bg: "#fff7ed", fruit: "#fb923c" } },
  { match: /coconut/i, shape: "can", palette: { pack: "#ecfdf5", accent: "#0f766e", ink: "#134e4a", bg: "#f0fdfa", fruit: "#78350f" } },
  { match: /tea/i, shape: "box", palette: { pack: "#d9f99d", accent: "#3f6212", ink: "#1a2e05", bg: "#f7fee7", fruit: "#65a30d" } },
  { match: /cookie/i, shape: "box", palette: { pack: "#fde68a", accent: "#92400e", ink: "#451a03", bg: "#fffbeb", fruit: "#b45309" } },
  { match: /peanut/i, shape: "jar", palette: { pack: "#d6a35c", accent: "#7c2d12", ink: "#fff7ed", bg: "#fff7ed", fruit: "#92400e" } },
  { match: /nut/i, shape: "pouch", palette: { pack: "#fed7aa", accent: "#9a3412", ink: "#431407", bg: "#fff7ed", fruit: "#c2410c" } },
  { match: /granola/i, shape: "bar", palette: { pack: "#fcd34d", accent: "#b45309", ink: "#451a03", bg: "#fffbeb", fruit: "#d97706" } },
  { match: /chocolate/i, shape: "bar", palette: { pack: "#57534e", accent: "#292524", ink: "#fafaf9", bg: "#f5f5f4", fruit: "#78350f" } },
  { match: /rice/i, shape: "pouch", palette: { pack: "#f5f5dc", accent: "#a16207", ink: "#422006", bg: "#fefce8", fruit: "#ca8a04" } },
  { match: /quinoa/i, shape: "pouch", palette: { pack: "#fef3c7", accent: "#b91c1c", ink: "#450a0a", bg: "#fef2f2", fruit: "#dc2626" } },
  { match: /chia|seed/i, shape: "pouch", palette: { pack: "#e2e8f0", accent: "#334155", ink: "#0f172a", bg: "#f8fafc", fruit: "#475569" } },
  { match: /bread/i, shape: "loaf", palette: { pack: "#fef3c7", accent: "#b45309", ink: "#451a03", bg: "#fffbeb", fruit: "#d97706" } },
  { match: /almond|milk/i, shape: "carton", palette: { pack: "#eff6ff", accent: "#1d4ed8", ink: "#172554", bg: "#eff6ff", fruit: "#a16207" } },
  { match: /vinegar/i, shape: "bottle", palette: { pack: "#fde68a", accent: "#b91c1c", ink: "#450a0a", bg: "#fef2f2", fruit: "#dc2626" } },
  { match: /honey/i, shape: "jar", palette: { pack: "#f59e0b", accent: "#78350f", ink: "#451a03", bg: "#fffbeb", fruit: "#fbbf24" } },
];

const BY_CATEGORY: Record<string, { shape: Shape; palette: Palette }> = {
  Beverage: { shape: "bottle", palette: { pack: "#dcfce7", accent: BRAND_GREEN, ink: "#052e16", bg: "#f0fdf4", fruit: "#16a34a" } },
  Snack: { shape: "pouch", palette: { pack: "#fef3c7", accent: "#b45309", ink: "#451a03", bg: "#fffbeb", fruit: "#d97706" } },
  Staple: { shape: "pouch", palette: { pack: "#f5f5f4", accent: "#57534e", ink: "#1c1917", bg: "#fafaf9", fruit: "#78716c" } },
};
const DEFAULT = { shape: "box" as Shape, palette: { pack: "#ecfdf5", accent: BRAND_GREEN, ink: "#052e16", bg: "#f0fdf4", fruit: "#16a34a" } };

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** "Freshroots Mango Drink 200ml" → { title: "Mango Drink", size: "200ml" } */
function splitName(name: string) {
  const clean = name.replace(/^freshroots\s+/i, "").trim();
  const m = /\s(\d+(?:\.\d+)?\s?(?:ml|l|g|kg|bags?))$/i.exec(clean);
  return m ? { title: clean.slice(0, m.index).trim(), size: m[1] } : { title: clean, size: "" };
}

/** Wrap a title onto at most two lines of roughly maxChars characters. */
function wrap(title: string, maxChars: number): string[] {
  const words = title.split(/\s+/);
  const lines: string[] = [""];
  for (const w of words) {
    const cur = lines[lines.length - 1];
    if ((cur + " " + w).trim().length > maxChars && cur && lines.length < 2) lines.push(w);
    else lines[lines.length - 1] = (cur + " " + w).trim();
  }
  return lines;
}

/** Brand mark: a sprout in a green roundel plus the wordmark. */
function logo(cx: number, y: number, scale: number, ink: string) {
  return `
  <g transform="translate(${cx} ${y}) scale(${scale})">
    <circle cx="-46" cy="0" r="11" fill="${BRAND_GREEN}"/>
    <path d="M-46 6 V-2 M-46 -1 C-46 -7 -52 -9 -55 -8 C-54 -3 -50 -1 -46 -1 Z M-46 -3 C-46 -8 -40 -10 -37 -9 C-38 -4 -42 -2 -46 -3 Z" fill="#ffffff" stroke="#ffffff" stroke-width="1.6" stroke-linejoin="round"/>
    <text x="-31" y="5.5" font-family="'Helvetica Neue', Arial, sans-serif" font-size="17" font-weight="700" letter-spacing="0.2" fill="${ink}">freshroots</text>
  </g>`;
}

/** Label block: title, size, and a small "Natural · Since 2014" line. */
function label(cx: number, top: number, width: number, title: string, size: string, ink: string, accent: string, fontSize = 20) {
  const lines = wrap(title, Math.max(8, Math.floor(width / (fontSize * 0.58))));
  const t = lines
    .map(
      (l, i) =>
        `<text x="${cx}" y="${top + i * (fontSize + 4)}" text-anchor="middle" font-family="'Helvetica Neue', Arial, sans-serif" font-size="${fontSize}" font-weight="800" fill="${ink}">${esc(l)}</text>`,
    )
    .join("");
  const after = top + lines.length * (fontSize + 4);
  return `${t}
    ${size ? `<rect x="${cx - 30}" y="${after - 8}" width="60" height="22" rx="11" fill="${accent}"/><text x="${cx}" y="${after + 7}" text-anchor="middle" font-family="'Helvetica Neue', Arial, sans-serif" font-size="12" font-weight="700" fill="#ffffff">${esc(size)}</text>` : ""}`;
}

/** A simple hero mark on the pack (leaf cluster) in the product colour. */
function hero(cx: number, cy: number, r: number, color: string) {
  return `
    <circle cx="${cx}" cy="${cy}" r="${r}" fill="${color}" opacity="0.92"/>
    <circle cx="${cx - r * 0.3}" cy="${cy - r * 0.35}" r="${r * 0.28}" fill="#ffffff" opacity="0.35"/>
    <path d="M${cx} ${cy - r} C ${cx + r * 0.2} ${cy - r * 1.5}, ${cx + r * 0.9} ${cy - r * 1.55}, ${cx + r * 1.05} ${cy - r * 1.25} C ${cx + r * 0.7} ${cy - r * 1.0}, ${cx + r * 0.3} ${cy - r * 0.95}, ${cx} ${cy - r} Z" fill="${BRAND_GREEN}"/>`;
}

function pack(shape: Shape, p: Palette, title: string, size: string): string {
  switch (shape) {
    case "carton":
      return `
  <path d="M130 120 L200 82 L270 120 Z" fill="${p.accent}"/>
  <rect x="186" y="62" width="28" height="22" rx="3" fill="${p.accent}"/>
  <rect x="130" y="120" width="140" height="210" rx="6" fill="${p.pack}" stroke="${p.accent}" stroke-width="3"/>
  <rect x="130" y="128" width="140" height="34" fill="#ffffff" opacity="0.92"/>
  ${logo(200, 145, 0.8, p.ink)}
  ${hero(200, 210, 26, p.fruit)}
  ${label(200, 262, 130, title, size, p.ink, p.accent, 17)}`;
    case "bottle":
      return `
  <rect x="182" y="58" width="36" height="22" rx="4" fill="${p.accent}"/>
  <path d="M186 80 H214 V108 C214 118 248 126 248 150 V318 C248 326 242 332 234 332 H166 C158 332 152 326 152 318 V150 C152 126 186 118 186 108 Z" fill="${p.pack}" stroke="${p.accent}" stroke-width="3"/>
  <rect x="152" y="168" width="96" height="128" fill="#ffffff" opacity="0.94"/>
  ${logo(200, 186, 0.62, p.ink)}
  ${hero(200, 224, 16, p.fruit)}
  ${label(200, 258, 90, title, size, p.ink, p.accent, 14)}`;
    case "can":
      return `
  <ellipse cx="200" cy="96" rx="62" ry="14" fill="#d4d4d8"/>
  <rect x="138" y="96" width="124" height="226" fill="${p.pack}" stroke="${p.accent}" stroke-width="3"/>
  <ellipse cx="200" cy="322" rx="62" ry="14" fill="${p.accent}"/>
  <rect x="138" y="118" width="124" height="34" fill="${p.accent}"/>
  <g>${logo(200, 135, 0.72, "#ffffff")}</g>
  ${hero(200, 200, 26, p.fruit)}
  ${label(200, 254, 116, title, size, p.ink, p.accent, 16)}`;
    case "box":
      return `
  <path d="M110 112 L140 92 H300 L270 112 Z" fill="${p.accent}" opacity="0.85"/>
  <path d="M270 112 L300 92 V300 L270 322 Z" fill="${p.accent}"/>
  <rect x="110" y="112" width="160" height="210" rx="4" fill="${p.pack}" stroke="${p.accent}" stroke-width="3"/>
  <rect x="110" y="122" width="160" height="34" fill="#ffffff" opacity="0.92"/>
  ${logo(190, 139, 0.85, p.ink)}
  ${hero(190, 206, 28, p.fruit)}
  ${label(190, 262, 150, title, size, p.ink, p.accent, 18)}`;
    case "pouch":
      return `
  <path d="M128 92 H272 L282 320 C282 328 276 334 268 334 H132 C124 334 118 328 118 320 Z" fill="${p.pack}" stroke="${p.accent}" stroke-width="3"/>
  <rect x="128" y="92" width="144" height="16" fill="${p.accent}"/>
  <g stroke="#ffffff" stroke-width="2" opacity="0.6">${Array.from({ length: 9 }, (_, i) => `<line x1="${136 + i * 16}" y1="95" x2="${136 + i * 16}" y2="105"/>`).join("")}</g>
  <rect x="130" y="124" width="140" height="34" rx="17" fill="#ffffff" opacity="0.92"/>
  ${logo(200, 141, 0.8, p.ink)}
  ${hero(200, 206, 28, p.fruit)}
  ${label(200, 264, 140, title, size, p.ink, p.accent, 18)}`;
    case "bar":
      return `
  <g transform="rotate(-8 200 200)">
    <path d="M70 158 L84 150 L84 250 L70 242 Z M330 158 L316 150 L316 250 L330 242 Z" fill="${p.accent}"/>
    <rect x="84" y="150" width="232" height="100" rx="6" fill="${p.pack}" stroke="${p.accent}" stroke-width="3"/>
    <rect x="84" y="150" width="74" height="100" fill="${p.accent}"/>
    <g>${logo(134, 182, 0.62, "#ffffff")}</g>
    ${hero(120, 222, 15, p.fruit)}
    ${label(238, 192, 150, title, size, p.ink, p.accent, 17)}
  </g>`;
    case "jar":
      return `
  <rect x="140" y="88" width="120" height="36" rx="8" fill="${p.accent}"/>
  <g stroke="#ffffff" stroke-width="2" opacity="0.35">${Array.from({ length: 10 }, (_, i) => `<line x1="${148 + i * 11}" y1="92" x2="${148 + i * 11}" y2="120"/>`).join("")}</g>
  <path d="M146 124 H254 C268 124 276 134 276 148 V306 C276 322 266 332 250 332 H150 C134 332 124 322 124 306 V148 C124 134 132 124 146 124 Z" fill="${p.pack}" stroke="${p.accent}" stroke-width="3"/>
  <rect x="124" y="164" width="152" height="132" fill="#ffffff" opacity="0.94"/>
  ${logo(200, 184, 0.72, p.ink)}
  ${hero(200, 222, 16, p.fruit)}
  ${label(200, 256, 140, title, size, p.ink, p.accent, 16)}`;
    case "loaf":
      return `
  <path d="M104 186 C104 140 140 116 200 116 C260 116 296 140 296 186 V306 C296 318 288 326 276 326 H124 C112 326 104 318 104 306 Z" fill="${p.pack}" stroke="${p.accent}" stroke-width="3"/>
  <path d="M184 112 L200 96 L216 112" fill="none" stroke="${p.accent}" stroke-width="4"/>
  <rect x="104" y="150" width="192" height="34" fill="#ffffff" opacity="0.92"/>
  ${logo(200, 167, 0.85, p.ink)}
  ${hero(200, 222, 24, p.fruit)}
  ${label(200, 272, 180, title, size, p.ink, p.accent, 18)}`;
  }
}

export function skuSvg(name: string, category: string): string {
  const rule = RULES.find((r) => r.match.test(name)) ?? BY_CATEGORY[category] ?? DEFAULT;
  const { title, size } = splitName(name);
  const p = rule.palette;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 400" width="400" height="400" role="img" aria-label="${esc(name)}">
  <title>${esc(name)}</title>
  <defs>
    <radialGradient id="bg" cx="50%" cy="40%" r="70%"><stop offset="0" stop-color="#ffffff"/><stop offset="1" stop-color="${p.bg}"/></radialGradient>
  </defs>
  <rect width="400" height="400" fill="url(#bg)"/>
  <ellipse cx="200" cy="352" rx="120" ry="12" fill="#000000" opacity="0.08"/>
  ${pack(rule.shape, p, title, size)}
  <text x="200" y="382" text-anchor="middle" font-family="'Helvetica Neue', Arial, sans-serif" font-size="10" fill="#57534e" letter-spacing="1.5">ILLUSTRATIVE PACK · NOT A PRODUCT PHOTO</text>
</svg>
`;
}

function main() {
  const file = process.argv[2] ?? path.join(process.cwd(), "sample-data", "sku_master.csv");
  const res = parseCsv("sku_master", readFileSync(file, "utf8"));
  if (res.errors.length) {
    console.error(res.errors.slice(0, 5));
    process.exit(1);
  }
  const out = path.join(process.cwd(), "public", "skus");
  mkdirSync(out, { recursive: true });
  for (const s of res.rows) writeFileSync(path.join(out, `${s.sku_id}.svg`), skuSvg(s.name, s.category));
  writeFileSync(path.join(out, "_placeholder.svg"), skuSvg("Freshroots Product", "Other"));
  console.log(`Wrote ${res.rows.length} images to public/skus/`);
}

if (process.argv[1]?.includes("generate-sku-images")) main();
