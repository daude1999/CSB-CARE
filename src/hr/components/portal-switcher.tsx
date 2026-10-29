"use client";
import { useEffect } from "react";
import { ChevronDown } from "lucide-react";

/** A portal this person may open, as decided on the server (src/server/auth/portals.ts). */
export type PortalChoice = { id: string; name: string; code: string; summary: string; home: string; planned?: string; colour?: string };

/**
 * The platform's portal button, drawn in the HR Hub's own style. The rest of the HR Hub is unchanged.
 * Every choice is a full page load, so the HR Hub's styles and the other portals' styles never mix.
 * While the next portal loads, the chosen entry and a thin bar in that module's colour show it is on its way
 * (public/hr/hr-motion.css); coming back with the browser's Back button clears them.
 */
export function PortalSwitcher({ portals }: { portals: PortalChoice[] }) {
  useEffect(() => {
    const clear = () => {
      document.documentElement.removeAttribute("data-portal-leaving");
      document.querySelectorAll(".portal-switch [data-pending]").forEach((el) => el.removeAttribute("data-pending"));
    };
    window.addEventListener("pageshow", clear);
    return () => window.removeEventListener("pageshow", clear);
  }, []);
  const leave = (e: React.MouseEvent<HTMLAnchorElement>, p: PortalChoice) => {
    if (p.id === "hr" || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.currentTarget.setAttribute("data-pending", "true");
    const root = document.documentElement;
    root.setAttribute("data-portal-leaving", p.id);
    if (p.colour) root.style.setProperty("--portal-next", p.colour);
  };
  return (
    <details className="portal-switch" data-testid="portal-switcher">
      <summary>
        <span className="portal-switch__code" aria-hidden="true">HR</span>
        <span className="portal-switch__name" data-testid="current-portal">HR &amp; Workforce</span>
        <ChevronDown size={14} aria-hidden="true" />
      </summary>
      <div className="portal-switch__menu">
        <p className="portal-switch__label">Switch portal</p>
        <ul>
          {portals.map((p) => (
            <li key={p.id}>
              <a href={p.home} onClick={(e) => leave(e, p)} className={p.id === "hr" ? "is-current" : undefined} aria-current={p.id === "hr" ? "page" : undefined}>
                <span className={`portal-switch__code${p.planned ? " is-planned" : ""}`} aria-hidden="true">{p.code}</span>
                <span className="portal-switch__text">
                  <strong>{p.name}</strong>
                  <small>{p.summary}</small>
                </span>
                {p.planned ? <span className="portal-switch__tag is-planned">Planned · {p.planned}</span> : <span className="portal-switch__tag">Working now</span>}
              </a>
            </li>
          ))}
        </ul>
      </div>
    </details>
  );
}
