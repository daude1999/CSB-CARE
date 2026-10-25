"use client";

export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="card max-w-xl">
      <h1>Something went wrong</h1>
      <p className="mt-2 text-sm text-slate-600">
        {error.message?.includes("not found") ? error.message : "The page could not be loaded. The error has been logged."} {error.digest ? <span className="text-xs text-slate-400">Ref: {error.digest}</span> : null}
      </p>
      <button className="btn-primary mt-4" onClick={reset}>Try again</button>
    </div>
  );
}
