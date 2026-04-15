export function stripLegacySpeakerPrefix(text: string): string {
  return text.replace(/^\[([^\]]*[a-zA-Z][^\]]*)\]:?\s?/, '');
}
