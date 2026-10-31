/**
 * Visit colours shared by the roster (week), the day timeline and the planner. Upcoming visits are solid, drafts are
 * pale and dashed, finished ones green, missed ones red, so the state reads at a glance; every colour also has a text
 * label in the key and the visit's title, so colour is never the only signal.
 */
export type Tone = "ok" | "review" | "empty" | "done" | "cancelled" | "missed" | "draft" | "active";

export const TONE_CLASS: Record<Tone, string> = {
  ok: "border-[#1d3f73] bg-[#1d3f73] text-white",
  draft: "border-dashed border-[#8a99ad] bg-[#eef1f5] text-[#3c4a5c]",
  review: "border-[#e0a526] bg-[#fff4d6] text-[#7a4b00]",
  empty: "border-dashed border-[#d9473f] bg-white text-[#a3242c]",
  done: "border-[#2f8a55] bg-[#e4f4ea] text-[#165c35]",
  active: "border-[#2f6fb5] bg-[#e3effb] text-[#1d4f91]",
  missed: "border-[#c0392b] bg-[#fbe3e1] text-[#8f1f17]",
  cancelled: "border-slate-200 bg-slate-50 text-slate-400 line-through",
};

export const TONE_LABEL: Record<Tone, string> = {
  ok: "Upcoming",
  draft: "Draft (not published)",
  review: "Needs review",
  empty: "Unassigned",
  done: "Completed",
  active: "In progress",
  missed: "Missed",
  cancelled: "Cancelled",
};

export type ShadeTone = "leave" | "sick" | "unavailable" | "requested";
export const SHADE_CLASS: Record<ShadeTone, string> = {
  leave: "bg-[#e6f1fb]",
  sick: "bg-[#fbeaea]",
  unavailable: "bg-[repeating-linear-gradient(135deg,#f1f3f6_0,#f1f3f6_6px,#e6e9ee_6px,#e6e9ee_12px)]",
  requested: "bg-[#f4f0fb]",
};
export const SHADE_TEXT: Record<ShadeTone, string> = { leave: "text-[#1d4f91]", sick: "text-[#a3242c]", unavailable: "text-slate-600", requested: "text-[#5b3fa3]" };
