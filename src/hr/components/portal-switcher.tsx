"use client";
import { ChevronDown } from "lucide-react";

/** A portal this person may open, as decided on the server (src/server/auth/portals.ts). */
export type PortalChoice = { id: string; name: string; code: string; summary: string; home: string; planned?: string };

/**
 * The platform's portal button, drawn in the HR Hub's own style. The rest of the HR Hub is unchanged.
 * Every choice is a full page load, so the HR Hub's styles and the other portals' styles never mix.
 */
export function PortalSwitcher({ portals }: { portals: PortalChoice[] }) {
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
              <a href={p.home} className={p.id === "hr" ? "is-current" : undefined} aria-current={p.id === "hr" ? "page" : undefined}>
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
