"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

type Progress = { documents: { id: string; stage: string | null; note: string | null }[]; busy: boolean };

/**
 * Keeps the intake page up to date while its documents are read in the background. It asks where each reading is
 * every few seconds, refreshes the page when a stage changes, and (on hosts without a worker) asks the server to run
 * the waiting reading. The reading itself is a saved job: closing the page does not stop or lose it.
 */
export function ReadProgress({ intakeId }: { intakeId: string }) {
  const router = useRouter();
  const [message, setMessage] = useState("Reading in the background. This page updates by itself.");
  const last = useRef<string>("");
  const running = useRef(false);

  useEffect(() => {
    let stopped = false;
    const run = () => {
      if (running.current) return;
      running.current = true;
      fetch("/api/care-coordinator/reads/run", { method: "POST" })
        .catch(() => undefined)
        .finally(() => { running.current = false; });
    };
    const tick = async () => {
      try {
        const res = await fetch(`/api/care-coordinator/intakes/${encodeURIComponent(intakeId)}/progress`, { cache: "no-store" });
        if (!res.ok) return;
        const p = (await res.json()) as Progress;
        const key = p.documents.map((d) => `${d.id}:${d.stage}:${d.note}`).join("|");
        if (last.current && key !== last.current) router.refresh();
        last.current = key;
        if (p.busy) run();
        else {
          setMessage("Reading finished.");
          stopped = true;
        }
      } catch {
        setMessage("Checking the reading again shortly.");
      }
    };
    void tick();
    const timer = setInterval(() => { if (!stopped) void tick(); }, 4000);
    return () => clearInterval(timer);
  }, [intakeId, router]);

  return <p role="status" aria-live="polite" className="text-meta text-slate-600">{message}</p>;
}
