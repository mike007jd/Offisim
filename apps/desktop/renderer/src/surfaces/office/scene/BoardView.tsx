import { useBoardTasks, useEmployees } from '@/data/queries.js';
import {
  BOARD_TRANSITIONS,
  type BoardColumn,
  type BoardTask,
  type Employee,
} from '@/data/types.js';
import { EmployeeAvatar } from '@/design-system/grammar/EmployeeAvatar.js';
import { Icon } from '@/design-system/icons/Icon.js';
import { cn } from '@/lib/utils.js';
import { SkeletonRows } from '@/surfaces/shared/SurfaceStates.js';
import {
  DndContext,
  type DragEndEvent,
  DragOverlay,
  type DragStartEvent,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import { AlertTriangle, Plus } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';

const COLUMNS: ReadonlyArray<{ id: BoardColumn; label: string }> = [
  { id: 'todo', label: 'Todo' },
  { id: 'doing', label: 'Doing' },
  { id: 'blocked', label: 'Blocked' },
  { id: 'review', label: 'Review' },
  { id: 'done', label: 'Done' },
];

const TAG_LABEL: Record<NonNullable<BoardTask['tag']>, string> = {
  pm: 'PM',
  human: 'Human',
  employee: 'Employee',
  manager: 'Manager',
};

function TaskCard({
  task,
  employee,
  dragging,
}: {
  task: BoardTask;
  employee: Employee | undefined;
  dragging?: boolean;
}) {
  return (
    <div className={cn('off-board-card', dragging && 'is-dragging')}>
      <div className="off-board-card-top">
        {task.tag ? (
          <span className={cn('off-board-tag', `is-${task.tag}`)}>{TAG_LABEL[task.tag]}</span>
        ) : null}
        <span className="off-board-card-title">{task.title}</span>
      </div>
      {task.blockedReason ? (
        <p className="off-board-card-blocked">
          <Icon icon={AlertTriangle} size="sm" />
          {task.blockedReason}
        </p>
      ) : null}
      <div className="off-board-card-foot">
        {employee ? (
          <EmployeeAvatar
            seed={employee.id}
            appearance={employee.appearance}
            colorA={employee.avatarA}
            colorB={employee.avatarB}
            size={18}
            brand={employee.kind === 'external'}
          />
        ) : null}
        <span className="off-board-card-name">{employee?.name ?? 'Unassigned'}</span>
        {task.costLabel ? <span className="off-board-card-cost">{task.costLabel}</span> : null}
      </div>
    </div>
  );
}

function DraggableCard({ task, employee }: { task: BoardTask; employee: Employee | undefined }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: task.id });
  return (
    <div
      ref={setNodeRef}
      className="off-board-card-wrap off-focusable"
      style={{ opacity: isDragging ? 0.4 : 1 }}
      {...attributes}
      {...listeners}
    >
      <TaskCard task={task} employee={employee} />
    </div>
  );
}

function Column({
  column,
  tasks,
  byId,
}: {
  column: { id: BoardColumn; label: string };
  tasks: BoardTask[];
  byId: Map<string, Employee>;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: column.id });
  return (
    <div ref={setNodeRef} className={cn('off-board-col', `is-${column.id}`, isOver && 'is-over')}>
      <div className="off-board-col-head">
        <span className="off-board-col-title">{column.label}</span>
        <span className="off-board-col-count">{tasks.length}</span>
      </div>
      <div className="off-board-col-body">
        {tasks.map((task) => (
          <DraggableCard
            key={task.id}
            task={task}
            employee={task.assigneeId ? byId.get(task.assigneeId) : undefined}
          />
        ))}
        <button type="button" className="off-board-add off-focusable">
          <Icon icon={Plus} size="sm" />
          Add card
        </button>
      </div>
    </div>
  );
}

export function BoardView() {
  const board = useBoardTasks();
  const employees = useEmployees();
  const [tasks, setTasks] = useState<BoardTask[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));

  useEffect(() => {
    if (board.data) setTasks(board.data);
  }, [board.data]);

  const byId = useMemo(
    () => new Map((employees.data ?? []).map((e) => [e.id, e])),
    [employees.data],
  );

  if (board.isLoading) return <SkeletonRows rows={6} className="p-[var(--off-sp-7)]" />;

  function onDragEnd(event: DragEndEvent) {
    setActiveId(null);
    const { active, over } = event;
    if (!over) return;
    const target = COLUMNS.find((c) => c.id === over.id)?.id;
    if (!target) return;
    const task = tasks.find((t) => t.id === active.id);
    if (!task || task.column === target) return;
    // CAS-guarded: reject moves the kanban state machine would not allow.
    if (!BOARD_TRANSITIONS[task.column].includes(target)) {
      setWarning(`Invalid transition: ${task.column} → ${target}`);
      window.setTimeout(() => setWarning(null), 2600);
      return;
    }
    setWarning(null);
    setTasks((prev) => prev.map((t) => (t.id === active.id ? { ...t, column: target } : t)));
  }

  const activeTask = tasks.find((t) => t.id === activeId) ?? null;

  return (
    <div className="off-board-wrap">
      {warning ? (
        <div className="off-board-warn" role="alert">
          <Icon icon={AlertTriangle} size="sm" />
          {warning}
        </div>
      ) : null}
      <div className="off-board">
        <DndContext
          sensors={sensors}
          onDragStart={(e: DragStartEvent) => setActiveId(e.active.id as string)}
          onDragEnd={onDragEnd}
          onDragCancel={() => setActiveId(null)}
        >
          {COLUMNS.map((column) => (
            <Column
              key={column.id}
              column={column}
              tasks={tasks.filter((t) => t.column === column.id)}
              byId={byId}
            />
          ))}
          <DragOverlay>
            {activeTask ? (
              <TaskCard
                task={activeTask}
                employee={activeTask.assigneeId ? byId.get(activeTask.assigneeId) : undefined}
                dragging
              />
            ) : null}
          </DragOverlay>
        </DndContext>
      </div>
    </div>
  );
}
