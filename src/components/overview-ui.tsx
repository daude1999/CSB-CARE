"use client";
import { useState } from "react";
import { ArrowLeft, ArrowRight, DotsSixVertical } from "@phosphor-icons/react";

export interface ArrangeItem {
  key: string;
  name: string;
  node: React.ReactNode;
}

/** Grid columns for the bottom row: tiles share the width, two by two under 1100px, one column on a phone. */
const COLUMNS: Record<number, string> = {
  1: "",
  2: "sm:grid-cols-2",
  3: "sm:grid-cols-2 min-[1100px]:grid-cols-3",
  4: "sm:grid-cols-2 min-[1100px]:grid-cols-4",
};

/**
 * The module tiles along the bottom of the Overview. In arrange mode (?arrange=1) each tile can be dragged, or moved
 * with its arrow buttons from the keyboard, and the order is saved to the member's own account. The "Rearrange" link
 * that starts it sits beside the greeting.
 */
export function ModuleGrid({ items, arranging, saveAction, columns }: { items: ArrangeItem[]; arranging: boolean; saveAction: (fd: FormData) => Promise<void>; columns: number }) {
  const [order, setOrder] = useState(items.map((i) => i.key));
  const [dragging, setDragging] = useState<string | null>(null);
  const [announce, setAnnounce] = useState("");
  const byKey = new Map(items.map((i) => [i.key, i] as const));
  const shown = arranging ? order.map((k) => byKey.get(k)).filter((i): i is ArrangeItem => Boolean(i)) : items;

  const move = (key: string, to: number) => {
    const from = order.indexOf(key);
    if (from < 0 || to < 0 || to >= order.length || from === to) return;
    const next = [...order];
    next.splice(from, 1);
    next.splice(to, 0, key);
    setOrder(next);
    setAnnounce(`${byKey.get(key)?.name} moved to position ${to + 1} of ${order.length}.`);
  };

  return (
    <>
      {arranging ? (
        <div className="flex flex-col gap-2 rounded-[10px] border border-dashed border-[#9db9e6] bg-[#f3f8ff] px-4 py-2.5 sm:flex-row sm:items-center" data-testid="arrange-bar">
          <p className="flex-1 text-meta text-[#1b2533]"><span className="font-semibold">Arrange your module tiles.</span> Drag a tile to a new place, or use its arrow buttons. Only you see this order.</p>
          <div className="flex flex-wrap items-center gap-2">
            <form action={saveAction}>
              <input type="hidden" name="back" value="/overview?arrange=1" />
              <input type="hidden" name="reset" value="1" />
              <button type="submit" className="h-[32px] rounded-[7px] px-3 text-meta font-medium text-[#1b2533] hover:bg-black/5">Standard order</button>
            </form>
            <a href="/overview" className="flex h-[32px] items-center rounded-[7px] border border-[#d5dbe5] bg-white px-3 text-meta font-medium text-[#1b2533] hover:bg-[#fafbfc]">Cancel</a>
            <form action={saveAction}>
              <input type="hidden" name="back" value="/overview?arrange=1" />
              <input type="hidden" name="order" value={order.join(",")} />
              <button type="submit" className="h-[32px] rounded-[7px] bg-[#1565c0] px-3.5 text-meta font-semibold text-white hover:bg-[#11589f]">Save order</button>
            </form>
          </div>
        </div>
      ) : null}
      <p aria-live="polite" className="sr-only">{announce}</p>
      <div className={`grid grid-cols-1 gap-[16px] [&>*]:min-w-0 ${COLUMNS[columns] ?? COLUMNS[4]}`} data-testid="module-tiles">
        {shown.map((item, i) =>
          arranging ? (
            <div
              key={item.key}
              data-testid={`arrange-${item.key}`}
              draggable
              onDragStart={(e) => {
                setDragging(item.key);
                e.dataTransfer.effectAllowed = "move";
                e.dataTransfer.setData("text/plain", item.key);
              }}
              onDragEnd={() => setDragging(null)}
              onDragOver={(e) => {
                e.preventDefault();
                if (dragging && dragging !== item.key) move(dragging, order.indexOf(item.key));
              }}
              onDrop={(e) => e.preventDefault()}
              className={`relative flex cursor-grab flex-col rounded-[12px] bg-[#eaf1fb] p-1.5 outline-dashed outline-2 outline-offset-2 active:cursor-grabbing ${dragging === item.key ? "opacity-50 outline-[#1565c0]" : "outline-[#9db9e6]"}`}
            >
              <div className="flex items-center gap-1 px-1 pb-1.5">
                <span className="flex flex-1 items-center gap-1.5 text-caption font-medium text-[#3a4658]"><DotsSixVertical size={16} weight="bold" aria-hidden="true" />Drag to move · position {i + 1}</span>
                <button type="button" onClick={() => move(item.key, i - 1)} disabled={i === 0} aria-label={`Move ${item.name} earlier`} className="flex h-7 w-7 items-center justify-center rounded-[6px] border border-[#d5dbe5] bg-white text-[#1b2533] hover:bg-[#f3f5f9] disabled:opacity-40">
                  <ArrowLeft size={14} weight="bold" aria-hidden="true" />
                </button>
                <button type="button" onClick={() => move(item.key, i + 1)} disabled={i === shown.length - 1} aria-label={`Move ${item.name} later`} className="flex h-7 w-7 items-center justify-center rounded-[6px] border border-[#d5dbe5] bg-white text-[#1b2533] hover:bg-[#f3f5f9] disabled:opacity-40">
                  <ArrowRight size={14} weight="bold" aria-hidden="true" />
                </button>
              </div>
              <div inert className="flex flex-1 flex-col [&>*]:flex-1">{item.node}</div>
            </div>
          ) : (
            <div key={item.key} className="flex flex-col [&>*]:flex-1">{item.node}</div>
          ),
        )}
      </div>
    </>
  );
}
