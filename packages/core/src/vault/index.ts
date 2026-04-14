export {
  type EmployeeFrontmatter,
  type SoulFrontmatter,
  type MemoryFrontmatter,
  type MemoryCategory,
  type RelationshipsFrontmatter,
  type VaultFile,
  VAULT_FILENAMES,
  VAULT_SCHEMA_VERSION,
  employeeFrontmatterSchema,
  soulFrontmatterSchema,
  memoryFrontmatterSchema,
  relationshipsFrontmatterSchema,
  memoryCategoryEnum,
} from './frontmatter.js';

export {
  parseDocument,
  serializeDocument,
  VaultParseError,
  type ParsedDocument,
} from './codec.js';

export {
  renderEmployeeMd,
  renderSoulMd,
  renderMemoryMd,
  renderRelationshipsMd,
} from './render.js';

export {
  importEmployeeBundle,
  type EmployeeSourceFile,
  type EmployeeVaultFiles,
  type ImportDiagnostic,
  type ImportOutcome,
} from './importer.js';

export type { VaultFileSystem } from './fs.js';
export {
  BrowserFsAccessFileSystem,
  browserFsAccessSupported,
  clearStoredBrowserVaultDirectoryHandle,
  createIndexedDbBrowserVaultHandleStore,
  createInMemoryBrowserVaultHandleStore,
  loadStoredBrowserVaultDirectoryHandle,
  persistBrowserVaultDirectoryHandle,
  pickBrowserVaultDirectory,
  queryBrowserVaultPermission,
  requestBrowserVaultPermission,
} from './browser-fs.js';
export type {
  BrowserVaultDirectoryStatus,
  BrowserVaultHandleStore,
  BrowserVaultMode,
  BrowserVaultPermissionState,
} from './browser-fs.js';
export { NodeFileSystem, type NodeFileSystemOptions } from './node-fs.js';

export { employeeSlug } from './slug.js';

export {
  VaultSyncService,
  VaultSyncError,
  type VaultSyncServiceOptions,
  type VaultTarget,
} from './sync-service.js';
