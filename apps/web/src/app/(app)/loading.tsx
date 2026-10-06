import { Skeleton } from '@/components/ui/states';

/** Layout-shaped skeleton for every app screen (Design.md §3 loading state). */
export default function Loading() {
  return (
    <div aria-busy="true" aria-label="Loading">
      <Skeleton className="h-8 w-64" />
      <Skeleton className="mt-2 h-4 w-96 max-w-full" />
      <div className="mt-8 divide-y-2 divide-border rounded-base border-2 border-border bg-surface shadow-hard">
        {[0, 1, 2, 3].map((row) => (
          <div key={row} className="flex items-center gap-4 px-4 py-4">
            <Skeleton className="h-4 flex-1" />
            <Skeleton className="hidden h-4 w-24 md:block" />
            <Skeleton className="hidden h-4 w-16 md:block" />
          </div>
        ))}
      </div>
    </div>
  );
}
