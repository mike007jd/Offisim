/** Vite `?url` imports for the character glb assets (emitted asset URL strings). */
declare module '*.glb?url' {
  const url: string;
  export default url;
}
