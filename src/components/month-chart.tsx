"use client";
import { Bar, BarChart, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { MonthBar } from "@/server/reports/trends";

const FILL = { base: "#41403b", current: "#178aa8", overdue: "#be123c" } as const;

/** Single-series monthly column chart in the board-paper style: one ink, one highlighted month. */
export function MonthChart({ data, unit, label }: { data: MonthBar[]; unit: string; label: string }) {
  return (
    <figure aria-label={label}>
      <div className="h-48">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 8, right: 4, bottom: 0, left: -24 }} barCategoryGap="28%">
            <XAxis dataKey="label" tickLine={false} axisLine={{ stroke: "#cfcbbf" }} tick={{ fontSize: 10, fill: "#76726a", fontFamily: "IBM Plex Mono" }} interval={0} />
            <YAxis allowDecimals={false} tickLine={false} axisLine={false} tick={{ fontSize: 10, fill: "#a29d91", fontFamily: "IBM Plex Mono" }} width={48} />
            <Tooltip
              cursor={{ fill: "rgba(26,27,29,0.05)" }}
              content={({ active, payload }) => {
                const p = active && payload?.[0] ? (payload[0].payload as MonthBar) : null;
                return p ? (
                  <div className="rounded-sm border border-slate-200 bg-white px-3 py-2 text-xs shadow-md">
                    <div className="font-mono uppercase tracking-[0.06em] text-slate-500">{p.label}</div>
                    <div className="mt-0.5 text-navy-900"><span className="font-serif text-base font-semibold">{p.value}</span> {unit}</div>
                  </div>
                ) : null;
              }}
            />
            <Bar dataKey="value" maxBarSize={24} radius={[4, 4, 0, 0]} isAnimationActive={false}>
              {data.map((d) => <Cell key={d.key} fill={FILL[d.highlight ?? "base"]} />)}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </figure>
  );
}
