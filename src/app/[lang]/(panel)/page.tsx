import { Suspense } from "react";
import { Board } from "@/components/board";
import { BoardSkeleton } from "@/components/skeletons";
import { getBoardData } from "@/lib/data";

async function BoardData() {
  const { tasks, tags, routines, clock, agent } = await getBoardData();
  return <Board tasks={tasks} tags={tags} routines={routines} clock={clock} agent={agent} />;
}

export default function BoardPage() {
  return (
    <Suspense fallback={<BoardSkeleton />}>
      <BoardData />
    </Suspense>
  );
}
