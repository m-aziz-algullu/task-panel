import { LocaleSwitcher } from "@/components/locale-switcher";

export function AuthCard({ title, subtitle, children }: { title: string; subtitle: string; children: React.ReactNode }) {
  return (
    <main className="flex flex-1 items-center justify-center p-4">
      <div className="w-full max-w-sm rounded-xl border border-border bg-surface p-6 shadow-sm">
        <div className="mb-5 flex items-center gap-2">
          <span className="inline-flex size-8 shrink-0 items-center justify-center rounded-md bg-accent text-xs font-bold text-accent-fg">
            TP
          </span>
          <div className="min-w-0 flex-1">
            <h1 className="text-lg leading-tight font-semibold">{title}</h1>
            <p className="text-sm text-muted">{subtitle}</p>
          </div>
          <span className="self-start">
            <LocaleSwitcher />
          </span>
        </div>
        {children}
      </div>
    </main>
  );
}

export function FormSkeleton({ fields }: { fields: number }) {
  return (
    <div className="flex flex-col gap-3" aria-hidden>
      {Array.from({ length: fields }, (_, i) => (
        <div key={i} className="flex flex-col gap-1.5">
          <div className="h-4 w-16 rounded bg-surface-2" />
          <div className="h-9 animate-pulse rounded-md bg-surface-2" />
        </div>
      ))}
      <div className="h-8 animate-pulse rounded-md bg-surface-2" />
    </div>
  );
}
