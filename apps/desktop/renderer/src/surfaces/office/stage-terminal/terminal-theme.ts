interface CssVariableReader {
  getPropertyValue(name: string): string;
}

const TERMINAL_TOKENS = {
  background: '--off-terminal-background',
  foreground: '--off-terminal-foreground',
  cursor: '--off-terminal-cursor',
  selectionBackground: '--off-terminal-selection',
  black: '--off-terminal-black',
  brightBlack: '--off-terminal-bright-black',
  red: '--off-terminal-red',
  brightRed: '--off-terminal-bright-red',
  green: '--off-terminal-green',
  brightGreen: '--off-terminal-bright-green',
  yellow: '--off-terminal-yellow',
  brightYellow: '--off-terminal-bright-yellow',
  blue: '--off-terminal-blue',
  brightBlue: '--off-terminal-bright-blue',
  magenta: '--off-terminal-magenta',
  brightMagenta: '--off-terminal-bright-magenta',
  cyan: '--off-terminal-cyan',
  brightCyan: '--off-terminal-bright-cyan',
  white: '--off-terminal-white',
  brightWhite: '--off-terminal-bright-white',
} as const;

function cssToken(reader: CssVariableReader, name: string): string {
  const value = reader.getPropertyValue(name).trim();
  if (!value) throw new Error(`Missing terminal visual token ${name}`);
  return value;
}

function numericCssToken(reader: CssVariableReader, name: string): number {
  const value = Number.parseFloat(cssToken(reader, name));
  if (!Number.isFinite(value)) throw new Error(`Invalid terminal numeric token ${name}`);
  return value;
}

export function terminalVisualOptionsFromCss(reader: CssVariableReader) {
  return {
    fontFamily: cssToken(reader, '--off-terminal-font-family'),
    fontSize: numericCssToken(reader, '--off-terminal-font-size'),
    lineHeight: numericCssToken(reader, '--off-terminal-line-height'),
    theme: Object.fromEntries(
      Object.entries(TERMINAL_TOKENS).map(([key, token]) => [key, cssToken(reader, token)]),
    ),
  };
}
