import { eq, and, desc } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import * as schema from '@aics/db-local';
import type {
  CheckpointRepository, CompanyRepository, EmployeeRepository,
  EventRepository, GraphCheckpointRow, GraphThreadRow,
  HandoffEventRow, HandoffRepository, MeetingRepository,
  MeetingSessionRow, NewGraphCheckpoint, NewGraphThread,
  NewHandoffEvent, NewMeetingSession, NewRuntimeEvent,
  NewTaskRun, NewToolCall, RuntimeRepositories,
  TaskRunRepository, TaskRunRow, ThreadRepository,
  ToolCallRepository, ToolCallRow,
} from './repositories.js';

type Db = BetterSQLite3Database<typeof schema>;

function now(): string {
  return new Date().toISOString();
}

export function createDrizzleRepositories(db: Db): RuntimeRepositories {
  const companies: CompanyRepository = {
    async findById(id) {
      const rows = db.select().from(schema.companies).where(eq(schema.companies.company_id, id)).all();
      return (rows[0] as unknown as ReturnType<CompanyRepository['findById']> extends Promise<infer T> ? T : never) ?? null;
    },
  };

  const threads: ThreadRepository = {
    async create(t: NewGraphThread) {
      const row = { ...t, created_at: now(), updated_at: now() };
      db.insert(schema.graphThreads).values(row).run();
      return row as GraphThreadRow;
    },
    async findById(id) {
      const rows = db.select().from(schema.graphThreads).where(eq(schema.graphThreads.thread_id, id)).all();
      return (rows[0] as GraphThreadRow | undefined) ?? null;
    },
    async updateStatus(id, status) {
      db.update(schema.graphThreads)
        .set({ status, updated_at: now() })
        .where(eq(schema.graphThreads.thread_id, id))
        .run();
    },
  };

  const taskRuns: TaskRunRepository = {
    async create(t: NewTaskRun) {
      const row = { ...t, finished_at: null };
      db.insert(schema.taskRuns).values(row).run();
      return row as TaskRunRow;
    },
    async findById(id) {
      const rows = db.select().from(schema.taskRuns).where(eq(schema.taskRuns.task_run_id, id)).all();
      return (rows[0] as TaskRunRow | undefined) ?? null;
    },
    async findByThread(threadId) {
      return db.select().from(schema.taskRuns).where(eq(schema.taskRuns.thread_id, threadId)).all() as TaskRunRow[];
    },
    async updateStatus(id, status, outputJson) {
      const finished = ['completed', 'failed', 'cancelled'].includes(status) ? now() : null;
      db.update(schema.taskRuns)
        .set({ status, output_json: outputJson ?? undefined, finished_at: finished ?? undefined })
        .where(eq(schema.taskRuns.task_run_id, id))
        .run();
    },
  };

  const employees: EmployeeRepository = {
    async findById(id) {
      const rows = db.select().from(schema.employees).where(eq(schema.employees.employee_id, id)).all();
      return (rows[0] as unknown as ReturnType<EmployeeRepository['findById']> extends Promise<infer T> ? T : never) ?? null;
    },
    async findByCompany(companyId) {
      return db.select().from(schema.employees).where(eq(schema.employees.company_id, companyId)).all() as any;
    },
    async findByRole(companyId, roleSlug) {
      return db.select().from(schema.employees)
        .where(and(eq(schema.employees.company_id, companyId), eq(schema.employees.role_slug, roleSlug)))
        .all() as any;
    },
  };

  const toolCalls: ToolCallRepository = {
    async create(t: NewToolCall) {
      const row = { ...t, finished_at: null };
      db.insert(schema.toolCalls).values(row).run();
      return row as ToolCallRow;
    },
    async updateResult(id, status, responseJson) {
      db.update(schema.toolCalls)
        .set({ status, response_json: responseJson, finished_at: now() })
        .where(eq(schema.toolCalls.tool_call_id, id))
        .run();
    },
  };

  const handoffs: HandoffRepository = {
    async create(h: NewHandoffEvent) {
      db.insert(schema.handoffEvents).values(h).run();
      return h as HandoffEventRow;
    },
    async findByThread(threadId) {
      return db.select().from(schema.handoffEvents)
        .where(eq(schema.handoffEvents.thread_id, threadId)).all() as HandoffEventRow[];
    },
  };

  const meetings: MeetingRepository = {
    async create(m: NewMeetingSession) {
      db.insert(schema.meetingSessions).values(m).run();
      return m as MeetingSessionRow;
    },
    async findById(id) {
      const rows = db.select().from(schema.meetingSessions)
        .where(eq(schema.meetingSessions.meeting_id, id)).all();
      return (rows[0] as MeetingSessionRow | undefined) ?? null;
    },
    async updateStatus(id, status, summaryJson) {
      db.update(schema.meetingSessions)
        .set({ status, summary_json: summaryJson ?? undefined, updated_at: now() })
        .where(eq(schema.meetingSessions.meeting_id, id))
        .run();
    },
  };

  const checkpoints: CheckpointRepository = {
    async save(c: NewGraphCheckpoint) {
      db.insert(schema.graphCheckpoints).values(c).run();
    },
    async findLatest(threadId) {
      const rows = db.select().from(schema.graphCheckpoints)
        .where(eq(schema.graphCheckpoints.thread_id, threadId))
        .orderBy(desc(schema.graphCheckpoints.checkpoint_seq))
        .limit(1)
        .all();
      return (rows[0] as GraphCheckpointRow | undefined) ?? null;
    },
    async findBySeq(threadId, seq) {
      const rows = db.select().from(schema.graphCheckpoints)
        .where(and(
          eq(schema.graphCheckpoints.thread_id, threadId),
          eq(schema.graphCheckpoints.checkpoint_seq, seq),
        ))
        .all();
      return (rows[0] as GraphCheckpointRow | undefined) ?? null;
    },
  };

  const events: EventRepository = {
    async insert(e: NewRuntimeEvent) {
      db.insert(schema.runtimeEvents).values(e).run();
    },
  };

  return { companies, threads, taskRuns, employees, toolCalls, handoffs, meetings, checkpoints, events };
}
