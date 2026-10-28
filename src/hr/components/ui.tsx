"use client";
import * as Dialog from "@radix-ui/react-dialog";
import { X, FileText } from "lucide-react";
import type { ReactNode } from "react";

type BadgeTone = "danger" | "warning" | "success" | "neutral" | "info" | "outline";
const badgeTones: Record<string, BadgeTone> = {
  overdue: "danger",
  "missing evidence": "danger",
  "attention required": "danger",
  "incomplete information": "danger",
  "due soon": "warning",
  "awaiting verification": "warning",
  quarantined: "warning",
  "quarantined — awaiting scanner": "warning",
  "up to date": "success",
  "checks up to date": "success",
  verified: "success",
  complete: "success",
  "all clear": "success",
  active: "neutral",
  onboarding: "neutral",
  "new starter": "neutral",
  archived: "outline",
  "not applicable": "outline",
  "previous version": "outline",
  "not assessed": "outline",
  "not yet reviewed": "outline",
  sample: "info",
  delivered: "info",
  "on leave": "info",
  information: "info",
};
export function Badge({
  children,
  variant,
}: {
  children: ReactNode;
  variant?: BadgeTone;
}) {
  const text = String(children);
  const tone = variant || badgeTones[text.toLowerCase()] || "neutral";
  const legacyTone = {
    danger: "red",
    warning: "amber",
    success: "green",
    neutral: "slate",
    info: "blue",
    outline: "slate",
  }[tone];
  return (
    <span className={`badge ${legacyTone} cs-badge cs-badge--${tone}`}>
      <span className="status-dot" />
      {text === "Onboarding" ? "New starter" : children}
    </span>
  );
}
export function Avatar({
  name,
  large = false,
}: {
  name: string;
  large?: boolean;
}) {
  return (
    <span
      className={`avatar avatar-${name.charCodeAt(0) % 5} cs-av cs-av--${"abcde"[name.charCodeAt(0) % 5]} ${large ? "large cs-av--lg" : ""}`}
      aria-hidden="true"
    >
      {name
        .split(" ")
        .map((n) => n[0])
        .slice(0, 2)
        .join("")}
    </span>
  );
}
export function Drawer({
  title,
  description,
  children,
  onClose,
  wide = false,
  className = "",
}: {
  title: string;
  description?: string;
  children: ReactNode;
  onClose: () => void;
  wide?: boolean;
  className?: string;
}) {
  return (
    <Dialog.Root
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="overlay" />
        <Dialog.Content className={`drawer ${wide ? "wide" : ""} ${className}`}>
          <header>
            <div>
              <Dialog.Title>{title}</Dialog.Title>
              <Dialog.Description>
                {description || "CSB HR Hub · fictional pilot"}
              </Dialog.Description>
            </div>
            <Dialog.Close className="icon-btn" aria-label="Close panel">
              <X size={20} />
            </Dialog.Close>
          </header>
          <div className="drawer-body">{children}</div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
export function Empty({ title, detail }: { title: string; detail: string }) {
  return (
    <div className="empty cs-empty">
      <FileText size={28} />
      <h3>{title}</h3>
      <p>{detail}</p>
    </div>
  );
}

export function ComplianceMeter({
  verified,
  due = 0,
  overdue = 0,
  missing = 0,
  large = false,
  legend = false,
}: {
  verified: number;
  due?: number;
  overdue?: number;
  missing?: number;
  large?: boolean;
  legend?: boolean;
}) {
  const total = verified + due + overdue + missing;
  const part = (count: number) => (total ? (count / total) * 100 : 0);
  return (
    <div className="cs-meter-wrap">
      <div
        className={`cs-meter ${large ? "cs-meter--lg" : ""}`}
        role="img"
        aria-label={`${verified} verified, ${due} due soon, ${overdue} overdue, ${missing} missing of ${total} required checks`}
      >
        <i className="ok" style={{ width: `${part(verified)}%` }} />
        <i className="due" style={{ width: `${part(due)}%` }} />
        <i className="over" style={{ width: `${part(overdue)}%` }} />
        <i className="miss" style={{ width: `${part(missing)}%` }} />
      </div>
      {legend && (
        <div className="cs-legend">
          {[ ["ok", "verified", verified], ["due", "due soon", due], ["over", "overdue", overdue], ["miss", "missing", missing] ].map(([tone, label, count]) => (
            <span key={String(label)}><i className={String(tone)} /> <b>{count}</b> {label}</span>
          ))}
        </div>
      )}
    </div>
  );
}

export function KpiStrip({
  items,
}: {
  items: { label: string; value: string | number; note: string; href?: string; spark?: number[]; hot?: boolean; }[];
}) {
  return (
    <div className="cs-kpis" style={{ "--n": items.length } as React.CSSProperties}>
      {items.map((item) => {
        const points = item.spark?.length ? item.spark : [];
        const max = Math.max(1, ...points);
        const min = Math.min(0, ...points);
        const path = points.map((n, i) => `${points.length > 1 ? (i / (points.length - 1)) * 100 : 50},${22 - ((n - min) / Math.max(1, max - min)) * 18}`).join(" ");
        const body = <><span className="cs-kpi__label">{item.label}</span><span className="cs-kpi__row"><strong className="cs-kpi__value">{item.value}</strong></span><span className="cs-kpi__note">{item.note}</span>{points.length > 1 && <svg className="cs-spark" viewBox="0 0 100 24" preserveAspectRatio="none" aria-hidden="true"><polyline points={path} className={item.hot ? "hot" : ""} /></svg>}</>;
        return item.href ? <a className="cs-kpi" href={item.href} key={item.label}>{body}</a> : <div className="cs-kpi" key={item.label}>{body}</div>;
      })}
    </div>
  );
}

export function FacetBar({
  items,
  value,
  onChange,
}: {
  items: { label: string; count: number; tone?: "danger" | "warning" | "success" | "neutral" }[];
  value: string;
  onChange: (value: string) => void;
}) {
  return <div className="cs-facets" role="group" aria-label="People compliance filter">{items.map((item) => <button key={item.label} type="button" className="cs-facet" aria-pressed={value === item.label} onClick={() => onChange(item.label)}><i className={`cs-facet__${item.tone || "neutral"}`} />{item.label}<b>{item.count}</b></button>)}</div>;
}

export function Timeline({
  items,
}: {
  items: { title: string; detail?: string; time?: string }[];
}) {
  return <div className="cs-timeline">{items.map((item, index) => <article key={`${item.title}-${index}`}><i /><div><strong>{item.title}</strong>{item.detail && <p>{item.detail}</p>}{item.time && <small>{item.time}</small>}</div></article>)}</div>;
}

export function Segmented({
  items,
  value,
  onChange,
  label,
}: {
  items: { label: string; count?: number }[];
  value: string;
  onChange: (value: string) => void;
  label: string;
}) {
  return <div className="cs-seg" role="group" aria-label={label}>{items.map((item) => <button type="button" key={item.label} aria-pressed={item.label === value} onClick={() => onChange(item.label)}>{item.label}{item.count !== undefined && <span className="cs-count">{item.count}</span>}</button>)}</div>;
}
export function Field({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
    </label>
  );
}
