/**
 * ESM shim for camelcase package.
 * @langchain/core imports `camelcase` as ESM default but the package is CJS.
 * Vite's FS-served modules don't auto-convert CJS default exports.
 */
function camelCase(input: string): string {
  return input
    .replace(/[-_\s]+(.)?/g, (_, c) => (c ? c.toUpperCase() : ''))
    .replace(/^[A-Z]/, (c) => c.toLowerCase());
}

export default camelCase;
