"use client";
import { useState } from "react";
import { useRouter } from "@/hr/nav";
import { health } from "@/hr/lib/presentation";
import { Search, ChevronRight, FileText, Command } from "lucide-react";
import { Avatar, Badge } from "./ui";
import { documentTitle } from "@/hr/lib/document-groups";
import { checkStatus } from "@/hr/lib/domain";
import { type Data } from "./hub-shared";
export function CommandPalette({
  data,
  onDocument,
  scope,
  close,
  editable,
  onAdd,
  onUpload,
  onReview,
  onEmployee,
}: {
  data: Data;
  scope: string;
  close: () => void;
  editable: boolean;
  onAdd: () => void;
  onUpload: () => void;
  onReview: () => void;
  onEmployee: (id: string) => void;
  onDocument: (id: string) => void;
}) {
  const router = useRouter();
  const [search, setSearch] = useState("");
  const [active, setActive] = useState(0);
  const actions = [
    ...(editable
      ? [
          {
            label: "Add employee",
            detail: "Create a people record",
            run: onAdd,
          },
        ]
      : []),
    ...(editable
      ? [
          {
            label: "Upload evidence",
            detail: "Add a document to an employee file",
            run: onUpload,
          },
        ]
      : []),
    {
      label: "Go to People",
      detail: "Browse employee records",
      run: () => {
        close();
        router.push("/people?branch=" + scope);
      },
    },
    {
      label: "Go to Compliance",
      detail: "Review requirements and evidence",
      run: () => {
        close();
        router.push("/compliance?branch=" + scope);
      },
    },
    {
      label: "Go to Documents",
      detail: "Open the document centre",
      run: () => {
        close();
        router.push("/documents?branch=" + scope);
      },
    },
    ...(editable &&
    data.checks.some(
      (c) => c.required && checkStatus(c, data.today) !== "Up to date",
    )
      ? [
          {
            label: "Record a review",
            detail: "Review the most urgent open requirement",
            run: onReview,
          },
        ]
      : []),
  ];
  const people = data.employees
    .filter((e) =>
      (e.name + " " + e.staffId + " " + e.job)
        .toLowerCase()
        .includes(search.toLowerCase()),
    )
    .slice(0, 5);
  const docs = data.documents
    .filter((d) =>
      (documentTitle(d, data.checks) + " " + d.filename)
        .toLowerCase()
        .includes(search.toLowerCase()),
    )
    .slice(0, 4);
  const shownActions = actions.filter((a) =>
    (a.label + " " + a.detail).toLowerCase().includes(search.toLowerCase()),
  );
  const options = [
    ...people.map((e) => ({
      label: e.name,
      detail:
        e.job +
        " · " +
        (data.branches.find((b) => b.id === e.branch)?.name || ""),
      run: () => onEmployee(e.id),
    })),
    ...docs.map((d) => ({
      label: documentTitle(d, data.checks),
      detail: d.filename,
      run: () => onDocument(d.id),
    })),
    ...shownActions,
  ];
  const run = (index: number) => options[index]?.run();
  return (
    <div
      className="cs-command-scrim"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) close();
      }}
    >
      <section
        className="cs-command"
        role="dialog"
        aria-modal="true"
        aria-label="Search or jump to"
      >
        <div className="cs-command__search">
          <Search size={18} />
          <input
            autoFocus
            placeholder="Search people, documents or actions…"
            value={search}
            onChange={(event) => {
              setSearch(event.target.value);
              setActive(0);
            }}
            onKeyDown={(event) => {
              if (event.key === "Escape") close();
              if (event.key === "ArrowDown") {
                event.preventDefault();
                setActive((n) => (n + 1) % Math.max(options.length, 1));
              }
              if (event.key === "ArrowUp") {
                event.preventDefault();
                setActive(
                  (n) =>
                    (n - 1 + Math.max(options.length, 1)) %
                    Math.max(options.length, 1),
                );
              }
              if (event.key === "Enter") {
                event.preventDefault();
                run(active);
              }
            }}
          />
          <kbd className="cs-kbd">ESC</kbd>
        </div>
        <div className="cs-command__results">
          {people.length > 0 && (
            <>
              <small>People</small>
              {people.map((e, i) => (
                <button
                  className={active === i ? "is-active" : ""}
                  key={e.id}
                  onMouseEnter={() => setActive(i)}
                  onClick={() => onEmployee(e.id)}
                >
                  <Avatar name={e.name} />
                  <span>
                    <b>{e.name}</b>
                    <small>
                      {e.job} · {e.staffId}
                    </small>
                  </span>
                  <Badge>
                    {health(
                      data.checks.filter((c) => c.employee === e.id),
                      data.today,
                    )}
                  </Badge>
                </button>
              ))}
            </>
          )}
          {docs.length > 0 && (
            <>
              <small>Documents</small>
              {docs.map((d, i) => {
                const n = people.length + i;
                return (
                  <button
                    className={active === n ? "is-active" : ""}
                    key={d.id}
                    onMouseEnter={() => setActive(n)}
                    onClick={() => onDocument(d.id)}
                  >
                    <FileText size={16} />
                    <span>
                      <b>{documentTitle(d, data.checks)}</b>
                      <small>{d.filename}</small>
                    </span>
                  </button>
                );
              })}
            </>
          )}
          {shownActions.length > 0 && (
            <>
              <small>Actions</small>
              {shownActions.map((a, i) => {
                const n = people.length + docs.length + i;
                return (
                  <button
                    className={active === n ? "is-active" : ""}
                    key={a.label}
                    onMouseEnter={() => setActive(n)}
                    onClick={a.run}
                  >
                    <Command size={16} />
                    <span>
                      <b>{a.label}</b>
                      <small>{a.detail}</small>
                    </span>
                    <ChevronRight size={15} />
                  </button>
                );
              })}
            </>
          )}
          {!options.length && <p>No matching people, documents or actions.</p>}
        </div>
        <footer>
          ↑↓ to navigate <span>Enter to open</span>
          <span>Esc to close</span>
        </footer>
      </section>
    </div>
  );
}
