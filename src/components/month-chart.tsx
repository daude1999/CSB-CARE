"use client";
import { Bar, BarChart, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { MonthBar } from "@/server/reports/trends";

const FILL = { base: "#4a7fc9", current: "#0f2a4f", overdue: "#e4544f" } as const;

/** Single-series monthly column chart in the dashboard colours: one blue, the current month in navy. */
export function MonthChart({ data, unit, label }: { data: MonthBar[]; unit: string; label: string }) {
  return (
    <figure aria-label={label}>
      <div className="h-48">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 8, right: 4, bottom: 0, left: -24 }} barCategoryGap="28%">
            <XAxis dataKey="label" tickLine={false} axisLine={{ stroke: "var(--slate-300)" }} tick={{ fontSize: 11, fill: "var(--slate-600)", fontFamily: "var(--font-sans)" }} interval={0} />
            <YAxis allowDecimals={false} tickLine={false} axisLine={false} tick={{ fontSize: 11, fill: "var(--slate-500)", fontFamily: "var(--font-sans)" }} width={48} />
            <Tooltip
              cursor={{ fill: "rgba(26,27,29,0.05)" }}
              content={({ active, payload }) => {
                const p = active && payload?.[0] ? (payload[0].payload as MonthBar) : null;
                return p ? (
                  <div className="rounded-sm border border-slate-200 bg-white px-3 py-2 text-xs shadow-md">
                    <div className="text-slate-600">{p.label}</div>
                    <div className="mt-0.5 text-navy-900"><span className="text-base font-medium">{p.value}</span> {unit}</div>
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
