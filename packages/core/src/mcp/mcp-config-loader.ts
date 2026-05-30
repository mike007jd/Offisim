import { z } from 'zod';
import { Logger } from '../services/logger.js';
import type { McpServerConfig } from './types.js';

const logger = new Logger('mcp-config');

const McpServerConfigEntrySchema = z
  .object({
    name: z.string(),
    transport: z.enum(['stdio', 'sse']),
    enabled: z.boolean(),
    description: z.string().optional(),
    command: z.string().optional(),
    args: z.array(z.string()).optional(),
    url: z.string().optional(),
    env: z.record(z.string(), z.string()).optional(),
    registeredServerId: z.string().optional(),
    approvalId: z.string().optional(),
    commandFingerprint: z.string().optional(),
    projectId: z.string().optional(),
    source: z.enum(['user-config', 'installed-asset', 'developer-runtime']).optional(),
    sourcePackageId: z.string().optional(),
    sourcePackageVersion: z.string().optional(),
    sourceManifestHash: z.string().optional(),
    requestSurface: z.enum(['settings', 'installed-asset-runtime', 'developer-runtime']).optional(),
    trustedAnnotations: z.boolean().optional(),
    toolAllowPatterns: z.array(z.string()).optional(),
  })
  .strict();

const McpConfigFileSchema = z
  .object({
    version: z.literal('1.0'),
    servers: z.array(McpServerConfigEntrySchema),
  })
  .strict();

export interface McpConfigFile {
  version: '1.0';
  servers: McpServerConfigEntry[];
}

export interface McpServerConfigEntry extends McpServerConfig {
  /** Whether to auto-connect this server */
  enabled: boolean;
  /** Human-readable description */
  description?: string;
  /** Glob patterns to filter available tools (for large MCP servers) */
  toolAllowPatterns?: string[];
}

export interface McpConfigLoaderOptions {
  /** Function to read config file contents */
  readFile: (path: string) => Promise<string>;
  /** Function to get file modification time (ms since epoch) */
  getMtime: (path: string) => Promise<number>;
  /** Poll interval for config changes in ms (default: 5000) */
  pollIntervalMs?: number;
}

/**
 * Interface for the MCP executor that the config loader manages.
 * Matches the subset of McpToolExecutor that we need.
 */
export interface McpExecutorLike {
  addServer(config: McpServerConfig): Promise<void>;
  removeServer(name: string): Promise<void>;
  getConnectedServerNames(): string[];
}

/**
 * Loads MCP server configurations from a JSON file and manages
 * server connections via an McpToolExecutor.
 *
 * Supports hot-reload via mtime-based polling (no filesystem watchers
 * required — works across Tauri/browser/test environments via DI).
 */
export class McpConfigLoader {
  private configPath: string;
  private lastMtime = 0;
  private lastConfig: McpConfigFile | null = null;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private polling = false;
  private readonly opts: Required<McpConfigLoaderOptions>;

  constructor(
    private readonly executor: McpExecutorLike,
    configPath: string,
    options: McpConfigLoaderOptions,
  ) {
    this.configPath = configPath;
    this.opts = {
      readFile: options.readFile,
      getMtime: options.getMtime,
      pollIntervalMs: options.pollIntervalMs ?? 5000,
    };
  }

  /** Load config file and connect all enabled servers. */
  async loadAndConnect(): Promise<void> {
    const config = await this.readConfig();
    if (!config) return;

    this.lastConfig = config;
    this.lastMtime = await this.safeGetMtime();

    const enabledServers = config.servers.filter((s) => s.enabled);
    for (const server of enabledServers) {
      try {
        await this.executor.addServer(server);
        logger.info(`Connected MCP server: ${server.name}`);
      } catch (err) {
        logger.error(`Failed to connect MCP server: ${server.name}`, err);
      }
    }
  }

  /** Check for config file changes. Returns true if config was reloaded. */
  async checkForChanges(): Promise<boolean> {
    const currentMtime = await this.safeGetMtime();
    if (currentMtime <= this.lastMtime) return false;

    logger.info('MCP config file changed, reloading...');
    const newConfig = await this.readConfig();
    if (!newConfig) return false;

    await this.applyDiff(this.lastConfig, newConfig);
    this.lastConfig = newConfig;
    this.lastMtime = currentMtime;
    return true;
  }

  /** Start polling for config file changes. Returns a stop function. */
  startWatching(): () => void {
    if (this.pollTimer) return () => this.stopWatching();

    this.pollTimer = setInterval(async () => {
      // Skip if a previous poll is still in flight to avoid overlapping
      // checkForChanges() (and overlapping applyDiff add/remove churn).
      if (this.polling) return;
      this.polling = true;
      try {
        await this.checkForChanges();
      } catch (err) {
        logger.error('Error checking MCP config changes', err);
      } finally {
        this.polling = false;
      }
    }, this.opts.pollIntervalMs);

    return () => this.stopWatching();
  }

  /** Stop watching for changes. */
  stopWatching(): void {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }

  /** Apply diff between old and new config. */
  private async applyDiff(
    oldConfig: McpConfigFile | null,
    newConfig: McpConfigFile,
  ): Promise<void> {
    const oldServers = new Map(
      (oldConfig?.servers ?? []).filter((s) => s.enabled).map((s) => [s.name, s]),
    );
    const newServers = new Map(newConfig.servers.filter((s) => s.enabled).map((s) => [s.name, s]));

    // Remove servers no longer in config
    for (const name of oldServers.keys()) {
      if (!newServers.has(name)) {
        try {
          await this.executor.removeServer(name);
          logger.info(`Removed MCP server: ${name}`);
        } catch (err) {
          logger.error(`Failed to remove MCP server: ${name}`, err);
        }
      }
    }

    // Add/update servers
    for (const [name, server] of newServers) {
      const old = oldServers.get(name);
      if (!old || this.serverChanged(old, server)) {
        // Remove old if it exists, then add new
        if (old) {
          try {
            await this.executor.removeServer(name);
          } catch {
            /* ignore */
          }
        }
        try {
          await this.executor.addServer(server);
          logger.info(`${old ? 'Updated' : 'Added'} MCP server: ${name}`);
        } catch (err) {
          logger.error(`Failed to add MCP server: ${name}`, err);
        }
      }
    }
  }

  /** Check if two server configs differ. */
  private serverChanged(a: McpServerConfigEntry, b: McpServerConfigEntry): boolean {
    return (
      a.transport !== b.transport ||
      a.command !== b.command ||
      a.url !== b.url ||
      // Security-identity fields: a change here must re-establish the connection
      // under the new trust/approval/fingerprint, not silently reuse the old one.
      a.trustedAnnotations !== b.trustedAnnotations ||
      a.source !== b.source ||
      a.approvalId !== b.approvalId ||
      a.commandFingerprint !== b.commandFingerprint ||
      JSON.stringify(a.args) !== JSON.stringify(b.args) ||
      JSON.stringify(a.toolAllowPatterns) !== JSON.stringify(b.toolAllowPatterns) ||
      // Compare env on a sorted-key canonical form so key reordering alone is
      // not treated as a change (and a real key/value change always is).
      this.canonicalEnv(a.env) !== this.canonicalEnv(b.env)
    );
  }

  /** Stable, key-sorted serialization of an env record for change detection. */
  private canonicalEnv(env: Record<string, string> | undefined): string {
    if (!env) return '';
    const entries = Object.entries(env).sort(([x], [y]) => (x < y ? -1 : x > y ? 1 : 0));
    return JSON.stringify(entries);
  }

  private async readConfig(): Promise<McpConfigFile | null> {
    try {
      const content = await this.opts.readFile(this.configPath);
      const raw = JSON.parse(content) as unknown;
      const result = McpConfigFileSchema.safeParse(raw);
      if (!result.success) {
        logger.error('Invalid MCP config schema', result.error.format());
        return null;
      }
      return result.data as McpConfigFile;
    } catch (err) {
      logger.error('Failed to read MCP config file', err);
      return null;
    }
  }

  private async safeGetMtime(): Promise<number> {
    try {
      return await this.opts.getMtime(this.configPath);
    } catch {
      return 0;
    }
  }
}
