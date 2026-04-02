export interface ScratchpadEntry {
  content: string;
  author: string;
  timestamp: number;
}

export class Scratchpad {
  private readonly entries = new Map<string, ScratchpadEntry>();

  write(key: string, content: string, author: string): void {
    this.entries.set(key, {
      content,
      author,
      timestamp: Date.now(),
    });
  }

  read(key: string): string | null {
    return this.entries.get(key)?.content ?? null;
  }

  list(): Array<{ key: string; summary: string; author: string }> {
    return [...this.entries.entries()]
      .sort((a, b) => b[1].timestamp - a[1].timestamp)
      .map(([key, entry]) => ({
        key,
        author: entry.author,
        summary: entry.content.length > 160 ? `${entry.content.slice(0, 157)}...` : entry.content,
      }));
  }

  clear(): void {
    this.entries.clear();
  }
}
