import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  type McpConfigFile,
  McpConfigLoader,
  type McpConfigLoaderOptions,
  type McpExecutorLike,
  type McpServerConfigEntry,
} from '../../mcp/mcp-config-loader.js';
import type { McpServerConfig } from '../../mcp/types.js';

// ── Mock executor ──────────────────────────────────────────────────

class MockExecutor implements McpExecutorLike {
  connected = new Map<string, McpServerConfig>();
  addCalls: McpServerConfig[] = [];
  removeCalls: string[] = [];

  async addServer(config: McpServerConfig): Promise<void> {
    this.connected.set(config.name, config);
    this.addCalls.push(config);
  }

  async removeServer(name: string): Promise<void> {
    this.connected.delete(name);
    this.removeCalls.push(name);
  }

  getConnectedServerNames(): string[] {
    return [...this.connected.keys()];
  }
}

// ── Helpers ────────────────────────────────────────────────────────

function makeEntry(name: string, overrides?: Partial<McpServerConfigEntry>): McpServerConfigEntry {
  return {
    name,
    transport: 'stdio' as const,
    command: 'node',
    args: [`${name}-server.js`],
    enabled: true,
    ...overrides,
  };
}

function makeConfig(servers: McpServerConfigEntry[]): McpConfigFile {
  return { version: '1.0', servers };
}

function makeConfigJson(servers: McpServerConfigEntry[]): string {
  return JSON.stringify(makeConfig(servers));
}

function createMockOptions(overrides?: Partial<McpConfigLoaderOptions>): McpConfigLoaderOptions {
  return {
    readFile: overrides?.readFile ?? (async () => '{"version":"1.0","servers":[]}'),
    getMtime: overrides?.getMtime ?? (async () => 1000),
    pollIntervalMs: overrides?.pollIntervalMs ?? 100,
  };
}

// ── Tests ──────────────────────────────────────────────────────────

describe('McpConfigLoader', () => {
  let executor: MockExecutor;

  beforeEach(() => {
    executor = new MockExecutor();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // ── loadAndConnect ─────────────────────────────────────────────

  describe('loadAndConnect', () => {
    it('connects enabled servers', async () => {
      const servers = [makeEntry('server-a'), makeEntry('server-b')];
      const opts = createMockOptions({
        readFile: async () => makeConfigJson(servers),
      });

      const loader = new McpConfigLoader(executor, '/config.json', opts);
      await loader.loadAndConnect();

      expect(executor.getConnectedServerNames()).toEqual(['server-a', 'server-b']);
      expect(executor.addCalls).toHaveLength(2);
    });

    it('skips disabled servers', async () => {
      const servers = [
        makeEntry('enabled-server'),
        makeEntry('disabled-server', { enabled: false }),
      ];
      const opts = createMockOptions({
        readFile: async () => makeConfigJson(servers),
      });

      const loader = new McpConfigLoader(executor, '/config.json', opts);
      await loader.loadAndConnect();

      expect(executor.getConnectedServerNames()).toEqual(['enabled-server']);
      expect(executor.addCalls).toHaveLength(1);
    });

    it('handles empty server list', async () => {
      const opts = createMockOptions({
        readFile: async () => makeConfigJson([]),
      });

      const loader = new McpConfigLoader(executor, '/config.json', opts);
      await loader.loadAndConnect();

      expect(executor.getConnectedServerNames()).toEqual([]);
    });

    it('continues connecting remaining servers when one fails', async () => {
      const failingExecutor: McpExecutorLike = {
        ...executor,
        addServer: async (config: McpServerConfig) => {
          if (config.name === 'fail-server') throw new Error('Connection refused');
          await executor.addServer(config);
        },
        removeServer: executor.removeServer.bind(executor),
        getConnectedServerNames: executor.getConnectedServerNames.bind(executor),
      };

      const servers = [makeEntry('good-before'), makeEntry('fail-server'), makeEntry('good-after')];
      const opts = createMockOptions({
        readFile: async () => makeConfigJson(servers),
      });

      const loader = new McpConfigLoader(failingExecutor, '/config.json', opts);
      await loader.loadAndConnect();

      expect(executor.getConnectedServerNames()).toEqual(['good-before', 'good-after']);
    });
  });

  // ── checkForChanges ────────────────────────────────────────────

  describe('checkForChanges', () => {
    it('returns false when mtime is unchanged', async () => {
      const servers = [makeEntry('server-a')];
      const mtime = 1000;
      const opts = createMockOptions({
        readFile: async () => makeConfigJson(servers),
        getMtime: async () => mtime,
      });

      const loader = new McpConfigLoader(executor, '/config.json', opts);
      await loader.loadAndConnect();

      // mtime unchanged
      const changed = await loader.checkForChanges();
      expect(changed).toBe(false);
    });

    it('reloads when mtime increases', async () => {
      const serversV1 = [makeEntry('server-a')];
      const serversV2 = [makeEntry('server-a'), makeEntry('server-b')];

      let mtime = 1000;
      let currentJson = makeConfigJson(serversV1);

      const opts = createMockOptions({
        readFile: async () => currentJson,
        getMtime: async () => mtime,
      });

      const loader = new McpConfigLoader(executor, '/config.json', opts);
      await loader.loadAndConnect();

      expect(executor.getConnectedServerNames()).toEqual(['server-a']);

      // Simulate config file update
      mtime = 2000;
      currentJson = makeConfigJson(serversV2);

      const changed = await loader.checkForChanges();
      expect(changed).toBe(true);
      expect(executor.getConnectedServerNames()).toContain('server-b');
    });

    it('returns false when getMtime throws (file deleted)', async () => {
      const servers = [makeEntry('server-a')];
      let mtimeThrows = false;

      const opts = createMockOptions({
        readFile: async () => makeConfigJson(servers),
        getMtime: async () => {
          if (mtimeThrows) throw new Error('ENOENT');
          return 1000;
        },
      });

      const loader = new McpConfigLoader(executor, '/config.json', opts);
      await loader.loadAndConnect();

      mtimeThrows = true;
      const changed = await loader.checkForChanges();
      // safeGetMtime returns 0, which is <= lastMtime (1000)
      expect(changed).toBe(false);
    });
  });

  // ── applyDiff (via checkForChanges) ────────────────────────────

  describe('applyDiff', () => {
    it('adds new servers', async () => {
      const serversV1 = [makeEntry('server-a')];
      const serversV2 = [makeEntry('server-a'), makeEntry('server-b')];

      let mtime = 1000;
      let currentJson = makeConfigJson(serversV1);

      const opts = createMockOptions({
        readFile: async () => currentJson,
        getMtime: async () => mtime,
      });

      const loader = new McpConfigLoader(executor, '/config.json', opts);
      await loader.loadAndConnect();

      executor.addCalls = []; // reset tracking

      mtime = 2000;
      currentJson = makeConfigJson(serversV2);

      await loader.checkForChanges();

      // server-a is unchanged, should not be re-added
      expect(executor.addCalls).toHaveLength(1);
      const addedServer = executor.addCalls[0];
      if (!addedServer) throw new Error('Expected added server');
      expect(addedServer.name).toBe('server-b');
    });

    it('removes deleted servers', async () => {
      const serversV1 = [makeEntry('server-a'), makeEntry('server-b')];
      const serversV2 = [makeEntry('server-a')];

      let mtime = 1000;
      let currentJson = makeConfigJson(serversV1);

      const opts = createMockOptions({
        readFile: async () => currentJson,
        getMtime: async () => mtime,
      });

      const loader = new McpConfigLoader(executor, '/config.json', opts);
      await loader.loadAndConnect();

      executor.removeCalls = []; // reset tracking

      mtime = 2000;
      currentJson = makeConfigJson(serversV2);

      await loader.checkForChanges();

      expect(executor.removeCalls).toContain('server-b');
      expect(executor.getConnectedServerNames()).toEqual(['server-a']);
    });

    it('updates changed servers (command changed)', async () => {
      const serversV1 = [makeEntry('server-a', { command: 'node' })];
      const serversV2 = [makeEntry('server-a', { command: 'bun' })];

      let mtime = 1000;
      let currentJson = makeConfigJson(serversV1);

      const opts = createMockOptions({
        readFile: async () => currentJson,
        getMtime: async () => mtime,
      });

      const loader = new McpConfigLoader(executor, '/config.json', opts);
      await loader.loadAndConnect();

      executor.addCalls = [];
      executor.removeCalls = [];

      mtime = 2000;
      currentJson = makeConfigJson(serversV2);

      await loader.checkForChanges();

      // Should remove old and add new
      expect(executor.removeCalls).toContain('server-a');
      expect(executor.addCalls).toHaveLength(1);
      const updatedServer = executor.addCalls[0];
      if (!updatedServer) throw new Error('Expected updated server');
      expect(updatedServer.command).toBe('bun');
    });

    it('updates changed servers (url changed)', async () => {
      const serversV1 = [
        makeEntry('sse-server', { transport: 'sse', url: 'http://localhost:3000' }),
      ];
      const serversV2 = [
        makeEntry('sse-server', { transport: 'sse', url: 'http://localhost:4000' }),
      ];

      let mtime = 1000;
      let currentJson = makeConfigJson(serversV1);

      const opts = createMockOptions({
        readFile: async () => currentJson,
        getMtime: async () => mtime,
      });

      const loader = new McpConfigLoader(executor, '/config.json', opts);
      await loader.loadAndConnect();

      executor.addCalls = [];
      executor.removeCalls = [];

      mtime = 2000;
      currentJson = makeConfigJson(serversV2);

      await loader.checkForChanges();

      expect(executor.removeCalls).toContain('sse-server');
      expect(executor.addCalls).toHaveLength(1);
      const updatedServer = executor.addCalls[0];
      if (!updatedServer) throw new Error('Expected updated SSE server');
      expect(updatedServer.url).toBe('http://localhost:4000');
    });

    it('keeps unchanged servers', async () => {
      const server = makeEntry('server-a', { command: 'node', args: ['serve.js'] });
      const serversV1 = [server, makeEntry('server-b')];
      // Same server-a config, remove server-b
      const serversV2 = [makeEntry('server-a', { command: 'node', args: ['serve.js'] })];

      let mtime = 1000;
      let currentJson = makeConfigJson(serversV1);

      const opts = createMockOptions({
        readFile: async () => currentJson,
        getMtime: async () => mtime,
      });

      const loader = new McpConfigLoader(executor, '/config.json', opts);
      await loader.loadAndConnect();

      executor.addCalls = [];
      executor.removeCalls = [];

      mtime = 2000;
      currentJson = makeConfigJson(serversV2);

      await loader.checkForChanges();

      // server-a should not be touched (no remove + no add for it)
      expect(executor.addCalls).toHaveLength(0);
      expect(executor.removeCalls).toEqual(['server-b']);
    });

    it('handles server disabled in update (treated as removal)', async () => {
      const serversV1 = [makeEntry('server-a'), makeEntry('server-b')];
      const serversV2 = [makeEntry('server-a'), makeEntry('server-b', { enabled: false })];

      let mtime = 1000;
      let currentJson = makeConfigJson(serversV1);

      const opts = createMockOptions({
        readFile: async () => currentJson,
        getMtime: async () => mtime,
      });

      const loader = new McpConfigLoader(executor, '/config.json', opts);
      await loader.loadAndConnect();

      executor.removeCalls = [];

      mtime = 2000;
      currentJson = makeConfigJson(serversV2);

      await loader.checkForChanges();

      // server-b was enabled → disabled, should be removed
      expect(executor.removeCalls).toContain('server-b');
      expect(executor.getConnectedServerNames()).toEqual(['server-a']);
    });
  });

  // ── startWatching / stopWatching ───────────────────────────────

  describe('startWatching / stopWatching', () => {
    it('polls at the configured interval', async () => {
      const servers = [makeEntry('server-a')];
      let mtime = 1000;
      let currentJson = makeConfigJson(servers);
      let readCount = 0;

      const opts = createMockOptions({
        readFile: async () => {
          readCount++;
          return currentJson;
        },
        getMtime: async () => mtime,
        pollIntervalMs: 100,
      });

      const loader = new McpConfigLoader(executor, '/config.json', opts);
      await loader.loadAndConnect();

      readCount = 0; // reset after initial load

      const stop = loader.startWatching();

      // No change yet (mtime same), so readFile should NOT be called
      await vi.advanceTimersByTimeAsync(100);
      expect(readCount).toBe(0);

      // Now bump mtime — next poll should trigger read
      mtime = 2000;
      currentJson = makeConfigJson([makeEntry('server-a'), makeEntry('server-b')]);

      await vi.advanceTimersByTimeAsync(100);
      expect(readCount).toBe(1);
      expect(executor.getConnectedServerNames()).toContain('server-b');

      stop();
    });

    it('stops polling after stopWatching()', async () => {
      let pollCount = 0;
      const opts = createMockOptions({
        getMtime: async () => {
          pollCount++;
          return 1000;
        },
      });

      const loader = new McpConfigLoader(executor, '/config.json', opts);
      await loader.loadAndConnect();

      pollCount = 0;

      loader.startWatching();
      await vi.advanceTimersByTimeAsync(100);
      const countAfterOnePoll = pollCount;

      loader.stopWatching();
      await vi.advanceTimersByTimeAsync(500);
      // Should not have polled again after stop
      expect(pollCount).toBe(countAfterOnePoll);
    });

    it('returns a stop function from startWatching', async () => {
      const opts = createMockOptions();
      const loader = new McpConfigLoader(executor, '/config.json', opts);
      await loader.loadAndConnect();

      const stop = loader.startWatching();
      expect(typeof stop).toBe('function');

      stop(); // Should not throw

      // Idempotent — second call also safe
      loader.stopWatching();
    });

    it('is idempotent — calling startWatching twice returns same stop fn', async () => {
      const opts = createMockOptions();
      const loader = new McpConfigLoader(executor, '/config.json', opts);
      await loader.loadAndConnect();

      const stop1 = loader.startWatching();
      const stop2 = loader.startWatching();

      // Both should work without error
      stop1();
      stop2();
    });
  });

  // ── Error handling ─────────────────────────────────────────────

  describe('error handling', () => {
    it('handles invalid JSON gracefully', async () => {
      const opts = createMockOptions({
        readFile: async () => '{ not valid json }}}',
      });

      const loader = new McpConfigLoader(executor, '/config.json', opts);
      await loader.loadAndConnect(); // should not throw

      expect(executor.getConnectedServerNames()).toEqual([]);
    });

    it('handles missing servers array in config', async () => {
      const opts = createMockOptions({
        readFile: async () => JSON.stringify({ version: '1.0' }),
      });

      const loader = new McpConfigLoader(executor, '/config.json', opts);
      await loader.loadAndConnect(); // should not throw

      expect(executor.getConnectedServerNames()).toEqual([]);
    });

    it('handles readFile throwing', async () => {
      const opts = createMockOptions({
        readFile: async () => {
          throw new Error('ENOENT: no such file');
        },
      });

      const loader = new McpConfigLoader(executor, '/config.json', opts);
      await loader.loadAndConnect(); // should not throw

      expect(executor.getConnectedServerNames()).toEqual([]);
    });

    it('handles readFile error during checkForChanges', async () => {
      const servers = [makeEntry('server-a')];
      let mtime = 1000;
      let shouldThrow = false;

      const opts = createMockOptions({
        readFile: async () => {
          if (shouldThrow) throw new Error('Read error');
          return makeConfigJson(servers);
        },
        getMtime: async () => mtime,
      });

      const loader = new McpConfigLoader(executor, '/config.json', opts);
      await loader.loadAndConnect();

      mtime = 2000;
      shouldThrow = true;

      const changed = await loader.checkForChanges();
      // readConfig returns null, so checkForChanges returns false
      expect(changed).toBe(false);
      // Original servers should still be connected (no diff applied)
      expect(executor.getConnectedServerNames()).toEqual(['server-a']);
    });
  });
});
