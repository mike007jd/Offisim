/**
 * Install-system types shared across packages.
 * Source: aics_install_state_machine.md §7 (bindings), §2 (source types).
 */

/** Binding types — what kind of runtime slot a package asset needs. */
export type BindingType = 'model_profile' | 'secret_slot' | 'workspace_map' | 'mcp_slot';

/** Binding resolution status within an install transaction. */
export type BindingStatus = 'pending' | 'satisfied' | 'skipped' | 'error';

/** How the package was sourced for installation. */
export type InstallSourceType = 'registry' | 'url' | 'file';
