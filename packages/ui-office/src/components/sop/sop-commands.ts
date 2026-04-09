// ---------------------------------------------------------------------------
// SOP command message formatting — pure functions, no React deps
// ---------------------------------------------------------------------------

export function formatRunCommand(name: string): string {
  return `Run the SOP: ${name}`;
}

export function formatModifyCommand(name: string, text: string): string {
  return `Modify the SOP "${name}": ${text}`;
}

export function formatStepClickPrefill(label: string, role: string): string {
  return `For step "${label}" (${role}): `;
}
