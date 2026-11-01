"use client";
import { useEffect, useState } from "react";
import { londonTime } from "@/lib/london";

/**
 * The current UK time (Europe/London, 24-hour HH:MM), kept live while the page is open. The first paint uses the
 * server's instant so server and browser render the same text (no hydration mismatch); after that it follows the
 * browser's clock, checked every second so the minute turns over on time. GMT or BST comes from the time zone rules in
 * `londonTime`, never from the browser's own zone. It always shows the real time now, whatever date the page is showing.
 */
export function LiveLondonTime({ initial, className, testId }: { initial: number; className?: string; testId?: string }) {
  const [now, setNow] = useState(() => ({ at: initial, text: londonTime(new Date(initial)) }));
  useEffect(() => {
    const tick = () => {
      const at = Date.now();
      const text = londonTime(new Date(at));
      setNow((prev) => (prev.text === text ? prev : { at, text }));
    };
    tick();
    const t = setInterval(tick, 1000);
    return () => clearInterval(t);
  }, []);
  return (
    <time dateTime={new Date(now.at).toISOString()} className={className} data-testid={testId}>
      <span className="sr-only">Current UK time </span>
      {now.text}
    </time>
  );
}
