import { STATUSES, STATUS_META } from "@/lib/types";
import { CARD_WIDTH, COLUMN_WIDTH } from "./card-size";

function CardSkeleton() {
  return <div className="h-24 animate-pulse rounded-lg border border-border bg-surface" />;
}

export function BoardSkeleton() {
  return (
    <div className="flex h-[calc(100dvh-3.5rem)] flex-col">
      <div className="h-[3.75rem]" />
      <div className="flex min-h-0 flex-1 items-start gap-3 overflow-x-hidden px-4 pb-4">
        {STATUSES.map((status, i) => (
          <section
            key={status}
            className="flex shrink-0 flex-col gap-2 rounded-xl border border-transparent bg-surface-2 p-2"
            style={{ width: COLUMN_WIDTH }}
          >
            <div className="flex items-center gap-2 px-1 pt-1 pb-1">
              <span className="size-2.5 rounded-full" style={{ backgroundColor: STATUS_META[status].dot }} />
              <span className="text-sm font-semibold">{STATUS_META[status].label}</span>
            </div>
            {Array.from({ length: 3 - (i % 2) }, (_, j) => (
              <CardSkeleton key={j} />
            ))}
          </section>
        ))}
      </div>
    </div>
  );
}

export function CompletedSkeleton({ title }: { title: string }) {
  return (
    <div className="flex flex-col gap-6 px-4 py-4">
      <h1 className="text-lg font-semibold">{title}</h1>
      <div className="grid gap-3" style={{ gridTemplateColumns: `repeat(auto-fill, ${CARD_WIDTH})` }}>
        {Array.from({ length: 4 }, (_, i) => (
          <CardSkeleton key={i} />
        ))}
      </div>
    </div>
  );
}
