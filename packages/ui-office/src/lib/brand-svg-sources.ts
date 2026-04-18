/**
 * Inline SVG sources, kept in lockstep with `src/assets/brands/*.svg`.
 * Why inline: ui-office compiles through `tsc`, so `.svg?url` imports can't
 * typecheck without a bundler — embedding the bytes keeps the registry
 * portable. Art team edits both the on-disk .svg and the constant here.
 */

export const HERMES_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100" fill="#1e1b4b"/><path d="M50 22 C 34 22 24 34 24 52 L 24 74 C 24 78 28 80 32 80 L 68 80 C 72 80 76 78 76 74 L 76 52 C 76 34 66 22 50 22 Z" fill="#4f46e5"/><circle cx="50" cy="52" r="18" fill="#f5d0c5"/><path d="M34 44 Q 50 30 66 44 Q 58 40 50 40 Q 42 40 34 44 Z" fill="#312e81"/><circle cx="43" cy="52" r="2" fill="#1e1b4b"/><circle cx="57" cy="52" r="2" fill="#1e1b4b"/><path d="M46 60 Q 50 64 54 60" stroke="#831843" stroke-width="1.5" fill="none" stroke-linecap="round"/><path d="M46 38 L 50 32 L 54 38" stroke="#c7d2fe" stroke-width="1.5" fill="none" stroke-linecap="round"/></svg>`;

export const OPENCLAW_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100" fill="#7f1d1d"/><path d="M46 30 Q 40 20 38 14" stroke="#b91c1c" stroke-width="1.5" fill="none" stroke-linecap="round"/><path d="M54 30 Q 60 20 62 14" stroke="#b91c1c" stroke-width="1.5" fill="none" stroke-linecap="round"/><ellipse cx="50" cy="52" rx="18" ry="22" fill="#dc2626"/><ellipse cx="50" cy="72" rx="14" ry="7" fill="#b91c1c"/><ellipse cx="50" cy="82" rx="10" ry="5" fill="#991b1b"/><ellipse cx="26" cy="46" rx="9" ry="6" fill="#dc2626" transform="rotate(-25 26 46)"/><circle cx="18" cy="38" r="5" fill="#b91c1c"/><ellipse cx="74" cy="46" rx="9" ry="6" fill="#dc2626" transform="rotate(25 74 46)"/><circle cx="82" cy="38" r="5" fill="#b91c1c"/><circle cx="44" cy="46" r="2" fill="#fef2f2"/><circle cx="56" cy="46" r="2" fill="#fef2f2"/></svg>`;

export const CODEX_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100" fill="#0c4a6e"/><rect x="18" y="26" width="64" height="48" rx="5" fill="#082f49"/><rect x="18" y="26" width="64" height="9" rx="5" fill="#0369a1"/><circle cx="26" cy="30.5" r="1.6" fill="#fbbf24"/><circle cx="32" cy="30.5" r="1.6" fill="#4ade80"/><circle cx="38" cy="30.5" r="1.6" fill="#f87171"/><text x="25" y="54" font-family="monospace" font-size="12" font-weight="bold" fill="#38bdf8">&gt;_</text><text x="25" y="68" font-family="monospace" font-size="9" fill="#7dd3fc">&lt;/&gt;</text></svg>`;

export const CUSTOM_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100" fill="#3f3f46"/><rect x="20" y="20" width="60" height="60" rx="6" fill="#6b21a8" stroke="#a78bfa" stroke-width="2"/><text x="50" y="65" font-family="sans-serif" font-size="40" font-weight="bold" fill="#e9d5ff" text-anchor="middle">?</text></svg>`;

/** Turn raw SVG XML into a data URI suitable for `<img src=>`. */
export function svgToDataUri(svg: string): string {
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}
