import type { EmployeeAppearance } from '@/lib/avatar.js';
import type { AttachmentKind, VaultRef } from '@offisim/shared-types';

export type { EmployeeAppearance };

/**
 * Renderer view-model types. These are presentation contracts for the desktop
 * UI; they are intentionally decoupled from the core runtime/db schema. Browser
 * preview can use fixtures, but release data must come from Tauri repositories
 * and sandboxed commands.
 */

export type RunState = 'idle' | 'running' | 'paused' | 'error' | 'done';

export interface Company {
  id: string;
  name: string;
  initials: string;
  accentA: string;
  accentB: string;
  /** Real template label chosen at creation (e.g. "R&D Company"), or "Custom". */
  templateLabel: string;
}

export interface Project {
  id: string;
  companyId: string;
  name: string;
  workspaceRoot: string | null;
  branch: string | null;
}

export interface TemplateEmployee {
  name: string;
  role: string;
  appearance: EmployeeAppearance;
}

export interface CompanyTemplate {
  id: string;
  name: string;
  description: string;
  layoutPreset: string;
  employees: TemplateEmployee[];
}

export type EmployeeKind = 'internal' | 'external';

/** Live presence derived from the runtime: idle in office, executing a run,
 *  blocked on a gate, failed, or offline/asleep. */
export type EmployeePresence = 'working' | 'idle' | 'blocked' | 'failed' | 'offline';

export interface Employee {
  id: string;
  name: string;
  role: string;
  kind: EmployeeKind;
  brandLabel?: string;
  online: boolean;
  /** Richer presence used by Office team dock, Personnel roster and Contacts. */
  presence?: EmployeePresence;
  avatarA: string;
  avatarB: string;
  appearance?: EmployeeAppearance;
  discipline: string;
  modelLabel: string;
  skillCount: number;
  /** Office zone the workstation sits in, e.g. "Engineering Bay". */
  zoneLabel?: string;
  /** Persisted workstation assignment; zone-level moves use the zone id as the workstation id. */
  workstationId?: string | null;
  /** Desk/seat label within the zone, e.g. "Desk 1". */
  deskLabel?: string;
  expertise?: string[];
  /** Disabled employees stay in the roster but do not run. */
  disabled?: boolean;
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
  vaultRef?: VaultRef;
  mimeType?: string;
  byteLength?: number;
  kind?: AttachmentKind;
  summary?: string;
}

export interface RunRecordStep {
  id: string;
  label: string;
  detail: string;
  state: 'done' | 'running' | 'pending' | 'error';
}

/** One Activity entry inside a sedimented run record (tool call / event). */
export interface RunActivityEntry {
  id: string;
  /** Tool / domain label e.g. "read", "edit", "bash". */
  tool: string;
  detail: string;
  state: 'done' | 'running' | 'pending' | 'error';
  /** Collapsed repeat count for consecutive identical entries. */
  repeat?: number;
}

/** One Plan step inside a run record: who did what, role and cost. */
export interface RunPlanStep {
  id: string;
  label: string;
  assigneeId: string | null;
  roleLabel: string;
  costLabel?: string;
  state: 'done' | 'running' | 'pending' | 'error';
}

export interface RunRecord {
  id: string;
  title: string;
  meta: string;
  costLabel: string;
  steps: RunRecordStep[];
  /** Activity + Plan sub-regions shown when the record is expanded. */
  activity?: RunActivityEntry[];
  plan?: RunPlanStep[];
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
  threadId?: string | null;
  name: string;
  kind: string;
  contributorIds: string[];
  fileName?: string | null;
  mimeType?: string | null;
  contentSize?: number;
  /** Short body preview shown in the expanded deliverable card. */
  preview?: string;
  /** Default export format label, e.g. "MD". */
  format?: string;
}

/* --- Git workbench (left workspace panel, Git tab) --------------------------*/

export type GitFileStatus = 'added' | 'modified' | 'deleted' | 'renamed';

export interface GitFileChange {
  path: string;
  status: GitFileStatus;
  staged: boolean;
  added: number;
  removed: number;
}

export type GitCheckState = 'pass' | 'fail' | 'running';

export interface GitCheck {
  id: string;
  label: string;
  state: GitCheckState;
}

export interface GitWorkbench {
  branch: string;
  ahead: number;
  behind: number;
  changes: GitFileChange[];
  /** Unified diff preview lines for the focused file. */
  diffPreview: Array<{ kind: 'add' | 'remove' | 'context'; text: string }>;
  checks: GitCheck[];
}

export interface RunCost {
  tokens: number;
  costLabel: string;
  live: boolean;
}

export interface FileNode {
  name: string;
  path: string;
  kind: 'dir' | 'file';
  depth: number;
}

export type ZoneKind = 'workspace' | 'meeting' | 'lounge';

export interface OfficeZone {
  id: string;
  label: string;
  kind: ZoneKind;
  /** Centre + footprint in office units (top-down x/z plane). */
  cx: number;
  cz: number;
  w: number;
  d: number;
}

export interface OfficePlacement {
  employeeId: string;
  x: number;
  z: number;
  /** Facing angle in degrees (0 faces +z / toward camera). */
  rotation: number;
}

export interface OfficeSceneLayout {
  zones: OfficeZone[];
  placements: OfficePlacement[];
  /** Office floor footprint in office units. */
  floorW: number;
  floorD: number;
}

export interface Skill {
  id: string;
  name: string;
  description: string;
  scope: 'global' | 'company' | 'employee';
}

/* --- Run-state layer (assistant-ui driven) ----------------------------------
 * The chat run is the source of truth for the Office pipeline pill, the Stop
 * control, stage status readout and the chat error banner. The renderer
 * drives these states through the assistant-ui external-store runtime. */

export type PipelineStageState = 'done' | 'active' | 'pending';

/** One stage of the orchestration pipeline (Boss → Manager → PM → Employee →
 *  Summary). */
export interface PipelineStage {
  id: string;
  label: string;
  state: PipelineStageState;
}

/** The live run currently broadcasting over the stage. */
export interface RunPipeline {
  /** Short title of the work in flight, e.g. "Edge case review". */
  title: string;
  /** Employee currently holding the run. */
  assigneeId: string | null;
  stages: PipelineStage[];
  /** Progress as completed/total tool steps. */
  stepDone: number;
  stepTotal: number;
}

/** A recoverable chat run failure. Drives the in-thread ErrorBanner. */
export interface RunError {
  id: string;
  message: string;
  /** Technical detail revealed under "Details". */
  technicalDetail: string;
}

/* --- Meetings ---------------------------------------------------------------*/

export type MeetingStatus = 'running' | 'paused' | 'idle';
export type ActionItemPriority = 'high' | 'medium' | 'low';

export interface MeetingActionItem {
  id: string;
  description: string;
  assigneeId: string | null;
  priority: ActionItemPriority;
  done: boolean;
}

export interface MeetingTranscriptLine {
  id: string;
  speakerId: string | null;
  text: string;
}

export interface MeetingState {
  status: MeetingStatus;
  threadId: string;
  title: string;
  inRoomIds: string[];
  transcript: MeetingTranscriptLine[];
  actionItems: MeetingActionItem[];
}

/* --- Chat attachment staging ------------------------------------------------*/

export type AttachmentStatus = 'attached' | 'error';

/** Canonical staging failure reasons (size cap, dedupe, unsupported, etc.). */
export type AttachmentFailReason =
  | 'too-large'
  | 'duplicate'
  | 'unsupported-type'
  | 'storage-unavailable'
  | 'too-many';

export const ATTACHMENT_FAIL_MESSAGE: Record<AttachmentFailReason, string> = {
  'too-large': 'File exceeds the 8 MB attachment limit.',
  duplicate: 'This file is already attached.',
  'unsupported-type': 'This file type can’t be attached.',
  'storage-unavailable': 'Attachment storage is unavailable right now.',
  'too-many': 'You can attach up to 6 files per message.',
};

export interface StagedAttachment {
  id: string;
  name: string;
  ext: string;
  sizeLabel: string;
  status: AttachmentStatus;
  mimeType?: string;
  byteLength?: number;
  bytes?: Uint8Array;
  sha256?: string;
  attachmentId?: string;
  file?: { arrayBuffer(): Promise<ArrayBuffer> };
  kind?: AttachmentKind;
  summary?: string;
  /** Present when status is "error". */
  failReason?: AttachmentFailReason;
}

/* --- Cross-session resume ---------------------------------------------------*/

export type UnfinishedThreadState = 'running' | 'blocked';

export interface UnfinishedThread {
  threadId: string;
  companyId: string;
  projectId: string;
  name: string;
  state: UnfinishedThreadState;
}
