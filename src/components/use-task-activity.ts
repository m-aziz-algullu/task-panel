"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { ACTIVE_RUN_STATUSES, type AgentRun, type TaskComment } from "@/lib/types";

const POLL_MS = 3_000;

const isActive = (run: AgentRun | null) =>
  run != null && (ACTIVE_RUN_STATUSES as readonly string[]).includes(run.status);

/**
 * A task's comments and latest agent run, refreshed every few seconds while a
 * run is queued or running. When a run ends the page refreshes too, since the
 * agent may have moved the task to another column.
 */
export function useTaskActivity(taskId: number) {
  const router = useRouter();
  const [comments, setComments] = useState<TaskComment[] | null>(null);
  const [run, setRun] = useState<AgentRun | null>(null);
  const [failed, setFailed] = useState(false);
  const wasActive = useRef(false);

  const load = useCallback(
    () =>
      fetch(`/api/tasks/${taskId}/activity`, { cache: "no-store" })
        .then((response) => (response.ok ? response.json() : Promise.reject(new Error(String(response.status)))))
        .then((data: { comments: TaskComment[]; run: AgentRun | null }) => {
          setComments(data.comments);
          setRun(data.run);
          setFailed(false);
          const active = isActive(data.run);
          if (wasActive.current && !active) router.refresh();
          wasActive.current = active;
        })
        .catch(() => setFailed(true)),
    [taskId, router],
  );

  useEffect(() => {
    void load();
  }, [load]);

  const active = isActive(run);
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => void load(), POLL_MS);
    return () => clearInterval(timer);
  }, [active, load]);

  return { comments, setComments, run, failed, reload: load };
}
