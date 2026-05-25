/**
 * Renderer view-model types. These are presentation contracts for the desktop
 * UI; they are intentionally decoupled from the core runtime/db schema so the
 * UI layer can render before backend wiring lands. The fixture source can later
 * be swapped for sandboxed Tauri commands without changing surface code.
 */

export type RunState = 'idle' | 'running' | 'paused' | 'error' | 'done';

export interface Company {
  id: string;
  name: string;
  initials: string;
  accentA: string;
  accentB: string;
}

export interface Project {
  id: string;
  companyId: string;
  name: string;
  workspaceRoot: string | null;
  branch: string | null;
}

export type EmployeeKind = 'internal' | 'external';

export interface Employee {
  id: string;
  name: string;
  role: string;
  kind: EmployeeKind;
  brandLabel?: string;
  online: boolean;
  avatarA: string;
  avatarB: string;
  discipline: string;
  modelLabel: string;
  skillCount: number;
}

export type ThreadScope = 'team' | 'direct';

export interface ChatThread {
  id: string;
  projectId: string;
  title: string;
  subtitle: string;
  scope: ThreadScope;
  employeeId: string | null;
  updatedAt: number;
  runState: RunState;
}

export type MessageAuthor = 'boss' | 'employee' | 'system';

export interface ChatAttachment {
  id: string;
  name: string;
  sizeLabel: string;
  ext: string;
}

export interface RunRecordStep {
  id: string;
  label: string;
  detail: string;
  state: 'done' | 'running' | 'pending' | 'error';
}

export interface RunRecord {
  id: string;
  title: string;
  meta: string;
  costLabel: string;
  steps: RunRecordStep[];
}

export interface ChatMessage {
  id: string;
  threadId: string;
  author: MessageAuthor;
  employeeId: string | null;
  body: string;
  at: number;
  attachments?: ChatAttachment[];
  runRecord?: RunRecord;
}

export interface Deliverable {
  id: string;
  name: string;
  kind: string;
  contributorIds: string[];
}

export type SopStatus = 'draft' | 'active' | 'archived';

export interface Sop {
  id: string;
  name: string;
  summary: string;
  status: SopStatus;
  stageCount: number;
  roleCount: number;
  lastRunLabel: string;
  runState: RunState;
}

export interface SopStage {
  id: string;
  name: string;
  role: string;
  state: 'done' | 'running' | 'pending';
}

export type ListingKind =
  | 'employee'
  | 'skill'
  | 'sop'
  | 'template'
  | 'layout'
  | 'prefab'
  | 'bundle';

export interface Listing {
  id: string;
  kind: ListingKind;
  name: string;
  summary: string;
  creator: string;
  rating: number;
  installs: number;
  version: string;
  tags: string[];
}

export type ActivityLevel = 'info' | 'ok' | 'warn' | 'error';

export interface ActivityEvent {
  id: string;
  at: number;
  level: ActivityLevel;
  source: string;
  title: string;
  detail: string;
}

export interface RunCost {
  tokens: number;
  costLabel: string;
  live: boolean;
}

export interface UsagePoint {
  label: string;
  runs: number;
  cost: number;
}

export interface FileNode {
  name: string;
  kind: 'dir' | 'file';
  depth: number;
}

export interface Skill {
  id: string;
  name: string;
  description: string;
  scope: 'global' | 'company' | 'employee';
}
