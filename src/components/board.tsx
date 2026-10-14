"use client";

import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  TouchSensor,
  closestCenter,
  closestCorners,
  pointerWithin,
  useDroppable,
  useSensor,
  useSensors,
  type CollisionDetection,
  type DragEndEvent,
  type DragOverEvent,
  type UniqueIdentifier,
} from "@dnd-kit/core";
import { SortableContext, arrayMove, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Plus, Tags } from "lucide-react";
import { useCallback, useEffect, useId, useMemo, useRef, useState, useTransition } from "react";
import { moveTask } from "@/app/actions";
import { useI18n } from "@/i18n/client";
import type { MessageKey } from "@/i18n/translate";
import { placeInColumn } from "@/lib/ordering";
import { STATUSES, STATUS_META, type Clock, type Status, type Tag, type Task } from "@/lib/types";
import { EMPTY_FILTERS, FilterBar, isFiltering, matchesFilters, shortcutBlocked, type Filters } from "./filters";
import { DoneDayPrompt, type DoneResolution } from "./done-day-prompt";
import { TagManager } from "./tag-manager";
import { CARD_WIDTH, COLUMN_WIDTH } from "./card-size";
import { TaskCard } from "./task-card";
import { TaskDialog } from "./task-dialog";
import { useDayRollover } from "./use-day-rollover";

type PendingMove = { movedId: number; from: Status; to: Status; order: number[] };

type DialogState ={ kind: "create"; status: Status } | { kind: "edit"; taskId: number } | { kind: "tags" } | null;

const COLUMN_PREFIX = "col:";
const columnId = (status: Status) => `${COLUMN_PREFIX}${status}`;
const isColumnId = (id: UniqueIdentifier) => String(id).startsWith(COLUMN_PREFIX);

function byPosition(a: Task, b: Task) {
  return a.position - b.position || b.id - a.id;
}

function SortableTask({
  task,
  tagsById,
  today,
  onOpen,
}: {
  task: Task;
  tagsById: Map<number, Tag>;
  today: string;
  onOpen: (task: Task) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: task.id });

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      {...attributes}
      {...listeners}
      aria-label={task.title}
      onClick={() => onOpen(task)}
      onKeyDown={(event) => {
        if (event.key === "Enter") onOpen(task);
        else listeners?.onKeyDown?.(event);
      }}
      className={`cursor-grab rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-accent active:cursor-grabbing ${
        isDragging ? "opacity-30" : ""
      }`}
    >
      <TaskCard task={task} tagsById={tagsById} today={today} />
    </div>
  );
}

function Column({
  status,
  tasks,
  total,
  highlighted,
  children,
  onAdd,
}: {
  status: Status;
  tasks: Task[];
  total: number;
  highlighted: boolean;
  children: React.ReactNode;
  onAdd: () => void;
}) {
  const { t } = useI18n();
  const { setNodeRef } = useDroppable({ id: columnId(status) });
  const points = tasks.reduce((sum, task) => sum + (task.storyPoints ?? 0), 0);
  const meta = STATUS_META[status];

  return (
    <section
      className={`flex max-h-full shrink-0 flex-col rounded-xl border transition-colors ${
        highlighted ? "border-accent/70 bg-accent/5" : "border-transparent bg-surface-2"
      }`}
      style={{ width: COLUMN_WIDTH }}
      aria-label={meta.label}
    >
      <header className="flex items-center gap-2 px-3 pt-3 pb-2">
        <span className="size-2.5 rounded-full" style={{ backgroundColor: meta.dot }} />
        <h2 className="text-sm font-semibold">{meta.label}</h2>
        <span className="rounded-full bg-surface px-2 text-xs font-medium text-muted" title={t("board.taskCount")}>
          {tasks.length === total ? total : `${tasks.length}/${total}`}
        </span>
        {status === "done" && <span className="text-xs text-muted">{t("board.doneToday")}</span>}
        {points > 0 && (
          <span className="text-xs text-muted" title={t("board.totalPoints")}>
            {points} SP
          </span>
        )}
        <button type="button" className="icon-btn ml-auto size-7" title={t("board.addToColumn", { column: meta.label })} onClick={onAdd}>
          <Plus className="size-4" />
        </button>
      </header>
      <div ref={setNodeRef} className="flex min-h-24 flex-1 flex-col gap-2 overflow-y-auto px-2 pb-2">
        {children}
        {tasks.length === 0 && (
          <div className="flex flex-1 items-center justify-center rounded-lg border border-dashed border-border py-6 text-xs text-muted">
            {status === "done" ? t("board.emptyDone") : t("board.dropHere")}
          </div>
        )}
      </div>
    </section>
  );
}

export function Board({ tasks: serverTasks, tags, clock }: { tasks: Task[]; tags: Tag[]; clock: Clock }) {
  // Local copy for optimistic drag-and-drop; reset whenever the server sends fresh data.
  const [tasks, setTasks] = useState(serverTasks);
  const [syncedFrom, setSyncedFrom] = useState(serverTasks);
  if (syncedFrom !== serverTasks) {
    setSyncedFrom(serverTasks);
    setTasks(serverTasks);
  }

  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [dialog, setDialog] = useState<DialogState>(null);
  const [activeId, setActiveId] = useState<number | null>(null);
  const [overStatus, setOverStatus] = useState<Status | null>(null);
  const [pendingDone, setPendingDone] = useState<PendingMove | null>(null);
  const { t, intlLocale } = useI18n();
  const [error, setError] = useState<MessageKey | null>(null);
  const [, startTransition] = useTransition();
  const lastDragEnd = useRef(0);
  const dndId = useId();

  useDayRollover(clock.nextDayAt);

  const tagsById = useMemo(() => new Map(tags.map((tag) => [tag.id, tag])), [tags]);

  const columns = useMemo(() => {
    const result = {} as Record<Status, { all: Task[]; visible: Task[] }>;
    for (const status of STATUSES) {
      const all = tasks.filter((task) => task.status === status).sort(byPosition);
      result[status] = { all, visible: all.filter((task) => matchesFilters(task, filters, intlLocale)) };
    }
    return result;
  }, [tasks, filters, intlLocale]);

  const statusOf = useCallback(
    (id: UniqueIdentifier): Status | null => {
      if (isColumnId(id)) return String(id).slice(COLUMN_PREFIX.length) as Status;
      return tasks.find((task) => task.id === id)?.status ?? null;
    },
    [tasks],
  );

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.key === "n" || event.key === "N") && !shortcutBlocked(event)) {
        event.preventDefault();
        setDialog({ kind: "create", status: "backlog" });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 6 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
      // Enter opens the task, so only Space picks a card up.
      keyboardCodes: { start: ["Space"], cancel: ["Escape"], end: ["Space", "Enter"] },
    }),
  );

  // Prefer the card under the pointer; in a column's empty space, the nearest card in that column.
  const collisionDetection: CollisionDetection = useCallback(
    (args) => {
      const within = pointerWithin(args);
      const card = within.find((hit) => !isColumnId(hit.id));
      if (card) return [card];
      const column = within.find((hit) => isColumnId(hit.id));
      if (column) {
        const ids = new Set(columns[statusOf(column.id)!].visible.map((task) => task.id));
        const containers = args.droppableContainers.filter((container) => ids.has(Number(container.id)));
        return containers.length > 0 ? closestCenter({ ...args, droppableContainers: containers }) : [column];
      }
      return closestCorners(args);
    },
    [columns, statusOf],
  );

  const openTask = (task: Task) => {
    // A drag ends with a click on the card it started from; don't treat that as "open".
    if (Date.now() - lastDragEnd.current < 250) return;
    setDialog({ kind: "edit", taskId: task.id });
  };

  const commitMove = ({ movedId, from, to, order }: PendingMove, resolution: DoneResolution) => {
    const completedDay = resolution.completedDay ?? clock.today;
    // Late completions are stamped at the end of their day; today's get "now".
    const completedAt = completedDay === clock.today ? new Date().toISOString() : `${completedDay}T23:59:59.999Z`;
    setTasks((current) =>
      current.map((task) => {
        if (task.id === movedId) {
          const stillDone = from === "done" && to === "done";
          return {
            ...task,
            status: to,
            day: resolution.day ?? task.day,
            position: order.indexOf(movedId),
            completedAt: to === "done" ? (stillDone ? task.completedAt : completedAt) : null,
            completedDay: to === "done" ? (stillDone ? task.completedDay : completedDay) : null,
          };
        }
        return task.status === to && order.includes(task.id) ? { ...task, position: order.indexOf(task.id) } : task;
      }),
    );
    startTransition(async () => {
      const result = await moveTask(movedId, to, order, resolution);
      if (!result.ok) {
        setError(result.error);
        setTasks(serverTasks);
      }
    });
  };

  const onDragOver = ({ over }: DragOverEvent) => setOverStatus(over ? statusOf(over.id) : null);

  const onDragEnd = ({ active, over }: DragEndEvent) => {
    setActiveId(null);
    setOverStatus(null);
    lastDragEnd.current = Date.now();
    if (!over) return;

    const movedId = Number(active.id);
    const from = statusOf(active.id);
    const to = statusOf(over.id);
    if (!from || !to) return;

    const visibleIds = columns[to].visible.map((task) => task.id);
    let newVisible: number[];
    if (from === to) {
      const oldIndex = visibleIds.indexOf(movedId);
      const newIndex = isColumnId(over.id) ? visibleIds.length - 1 : visibleIds.indexOf(Number(over.id));
      if (oldIndex === newIndex) return;
      newVisible = arrayMove(visibleIds, oldIndex, newIndex);
    } else {
      const translated = active.rect.current.translated;
      const below = translated ? translated.top > over.rect.top + over.rect.height / 2 : false;
      const index = isColumnId(over.id) ? visibleIds.length : visibleIds.indexOf(Number(over.id)) + (below ? 1 : 0);
      newVisible = [...visibleIds.slice(0, index), movedId, ...visibleIds.slice(index)];
    }

    const order = placeInColumn(
      columns[to].all.map((task) => task.id),
      newVisible,
      movedId,
    );
    const moved = tasks.find((task) => task.id === movedId);
    const move = { movedId, from, to, order };
    // A task planned for another day needs a decision before it can land in Done.
    if (moved && to === "done" && from !== "done" && moved.day !== clock.today) {
      setPendingDone(move);
      return;
    }
    commitMove(move, {});
  };

  const activeTask = activeId == null ? null : tasks.find((task) => task.id === activeId);
  const editingTask = dialog?.kind === "edit" ? tasks.find((task) => task.id === dialog.taskId) : undefined;

  return (
    <div className="flex h-[calc(100dvh-3.5rem)] flex-col">
      <div className="flex flex-wrap items-center gap-3 px-4 py-3">
        <FilterBar tags={tags} filters={filters} onChange={setFilters} />
        <div className="ml-auto flex items-center gap-2">
          <button type="button" className="btn btn-outline" onClick={() => setDialog({ kind: "tags" })}>
            <Tags className="size-4" /> {t("board.tags")}
          </button>
          <button
            type="button"
            className="btn btn-primary"
            title={t("board.newTaskShortcut")}
            onClick={() => setDialog({ kind: "create", status: "backlog" })}
          >
            <Plus className="size-4" /> {t("board.newTask")}
          </button>
        </div>
      </div>

      {error && (
        <div className="mx-4 mb-2 flex items-center gap-2 rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-700 dark:text-red-300">
          {t(error)}
          <button type="button" className="ml-auto text-xs underline" onClick={() => setError(null)}>
            {t("common.close")}
          </button>
        </div>
      )}

      <DndContext
        id={dndId}
        sensors={sensors}
        collisionDetection={collisionDetection}
        onDragStart={({ active }) => setActiveId(Number(active.id))}
        onDragOver={onDragOver}
        onDragEnd={onDragEnd}
        onDragCancel={() => {
          setActiveId(null);
          setOverStatus(null);
        }}
      >
        <div className="flex min-h-0 flex-1 items-start gap-3 overflow-x-auto px-4 pb-4">
          {STATUSES.map((status) => {
            const column = columns[status];
            return (
              <Column
                key={status}
                status={status}
                tasks={column.visible}
                total={column.all.length}
                highlighted={activeId != null && overStatus === status && statusOf(activeId) !== status}
                onAdd={() => setDialog({ kind: "create", status })}
              >
                <SortableContext items={column.visible.map((task) => task.id)} strategy={verticalListSortingStrategy}>
                  {column.visible.map((task) => (
                    <SortableTask key={task.id} task={task} tagsById={tagsById} today={clock.today} onOpen={openTask} />
                  ))}
                </SortableContext>
              </Column>
            );
          })}
        </div>
        <DragOverlay>
          {activeTask && (
            <div style={{ width: CARD_WIDTH }}>
              <TaskCard task={activeTask} tagsById={tagsById} today={clock.today} lifted />
            </div>
          )}
        </DragOverlay>
      </DndContext>

      {isFiltering(filters) && tasks.length > 0 && STATUSES.every((s) => columns[s].visible.length === 0) && (
        <p className="pb-4 text-center text-sm text-muted">{t("board.noMatch")}</p>
      )}

      {dialog?.kind === "create" && (
        <TaskDialog defaultStatus={dialog.status} tags={tags} clock={clock} onClose={() => setDialog(null)} />
      )}
      {dialog?.kind === "edit" && editingTask && (
        <TaskDialog key={editingTask.id} task={editingTask} tags={tags} clock={clock} onClose={() => setDialog(null)} />
      )}
      {dialog?.kind === "tags" && <TagManager tags={tags} onClose={() => setDialog(null)} />}
      {pendingDone && (
        <DoneDayPrompt
          task={tasks.find((task) => task.id === pendingDone.movedId)!}
          today={clock.today}
          onCancel={() => setPendingDone(null)}
          onResolve={(resolution) => {
            const move = pendingDone;
            setPendingDone(null);
            commitMove(move, resolution);
          }}
        />
      )}
    </div>
  );
}
