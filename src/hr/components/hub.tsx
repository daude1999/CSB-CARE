"use client";
import {
  useEffect,
  useState,
  useCallback,
  useRef,
  type ReactNode,
} from "react";
import { usePathname, useRouter, useSearchParams } from "@/hr/nav";
import Link from "@/hr/nav";
import { BranchWorkspace, AlertsWorkspace } from "./workspace-widgets";
import { EmployeePanel } from "./employee-panel";
import { health, documentState, documentDue } from "@/hr/lib/presentation";
import {
  Users,
  Files,
  ShieldCheck,
  Building2,
  Bell,
  Upload,
  Settings,
  Search,
  ChevronRight,
  ChevronLeft,
  Plus,
  Download,
  Filter,
  MoreHorizontal,
  CheckCircle2,
  FolderOpen,
  SlidersHorizontal,
  FileText,
  ExternalLink,
  ZoomIn,
  ZoomOut,
  History,
  Home,
  Lock,
  Command,
  GraduationCap,
} from "lucide-react";
import {
  useReactTable,
  getCoreRowModel,
  getSortedRowModel,
  getPaginationRowModel,
  flexRender,
  type ColumnDef,
  type SortingState,
} from "@tanstack/react-table";
import Papa from "papaparse";
import { Avatar, Badge, Drawer, Empty, Field } from "./ui";
import PdfPreview from "./pdf-preview";
import { DocumentCentre } from "./document-centre";
import { HRTasks } from "./hr-tasks";
import { HRHome } from "./hr-home";
import { HRRecord } from "./hr-record";
import { HubHeader } from "./hub-header";
import { HUB_SEARCH_EVENT } from "@/lib/portals";
import { documentTitle } from "@/hr/lib/document-groups";
import { employeeRoute } from "@/hr/lib/routes";
import {
  checkCategory,
  checkStatus,
  sortCheckCategories,
  employeeStatus,
  priorities,
  canEdit,
  sensitive,
  type State,
  type OrganisationSettings,
  type User,
  type Employee,
  type Check as Review,
  type Doc,
  type ImportRow,
} from "@/hr/lib/domain";
type Data = Omit<State, "settings"> & {
  settings: OrganisationSettings;
  allBranches: boolean;
  user: User;
  today: string;
};
type Modal =
  | { type: "employee"; employee?: Employee }
  | { type: "document"; document: Doc }
  | { type: "upload"; employee?: Employee; previous?: Doc }
  | { type: "review"; check: Review }
  | { type: "note"; employee: Employee; document?: string }
  | { type: "quick"; employee: Employee }
  | null;
const navigation = [
  { id: "dashboard", name: "Dashboard", icon: Home },
  { id: "people", name: "People", icon: Users },
  { id: "documents", name: "Documents", icon: Files },
  { id: "compliance", name: "Compliance", icon: ShieldCheck },
  { id: "branches", name: "Branches", icon: Building2 },
  { id: "alerts", name: "Alerts", icon: Bell },
  { id: "imports", name: "Imports", icon: Upload },
  { id: "training", name: "Training", icon: GraduationCap },
  { id: "settings", name: "Settings", icon: Settings },
];
const formatDate = (s: string | null) =>
  s
    ? new Intl.DateTimeFormat("en-GB", {
        day: "numeric",
        month: "short",
        year: "numeric",
        timeZone: "Europe/London",
      }).format(new Date(s.length === 10 ? s + "T12:00:00Z" : s))
    : "Not set";
export default function Hub() {
  // Read through Next.js so the server and the browser start from the same branch (no hydration mismatch).
  const initialBranch = useSearchParams().get("branch");
  const [scope, updateScope] = useState(() => initialBranch || "all");
  const setScope = (value: string) => {
    const url = new URL(window.location.href);
    url.searchParams.set("branch", value);
    window.history.replaceState(null, "", url);
    updateScope(value);
  };
  const [epoch, setEpoch] = useState(0);
  return (
    <Workspace
      key={`${scope}:${epoch}`}
      scope={scope}
      setScope={setScope}
      reset={() => {
        setScope("all");
        setEpoch((n) => n + 1);
      }}
    />
  );
}
function Workspace({
  scope,
  setScope,
  reset: _reset,
}: {
  scope: string;
  setScope: (s: string) => void;
  reset: () => void;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const section = pathname.split("/")[1] || "dashboard";
  const employeeId = pathname.split("/")[2];
  const [data, setData] = useState<Data | null>(null);
  const [auth, setAuth] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [modal, setModal] = useState<Modal>(null);
  const [commandOpen, setCommandOpen] = useState(false);
  const requestVersion = useRef(0);
  const refresh = useCallback(async () => {
    const version = ++requestVersion.current;
    const response = await fetch(`/api/hr/hub?branch=${scope}`, {
      cache: "no-store",
    });
    const result = await response.json();
    if (version !== requestVersion.current) return;
    if (response.status === 401) {
      setData(null);
      setAuth(true);
      return;
    }
    if (!response.ok) {
      setData(null);
      setModal(null);
      setError(result.error);
      return;
    }
    setData(result);
    setAuth(false);
  }, [scope]);
  useEffect(() => {
    let active = true;
    const counter = requestVersion;
    queueMicrotask(() => {
      if (active)
        refresh().catch(() =>
          setError("Could not reach the server. Please refresh."),
        );
    });
    return () => {
      active = false;
      counter.current++;
    };
  }, [refresh]);
  useEffect(() => {
    const visibility = () => {
      if (document.visibilityState === "hidden") {
        requestVersion.current++;
        setData(null);
        setModal(null);
      } else
        refresh().catch(() => setError("Could not revalidate your access."));
    };
    document.addEventListener("visibilitychange", visibility);
    return () => document.removeEventListener("visibilitychange", visibility);
  }, [refresh]);
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setCommandOpen((open) => !open);
      } else if (
        event.key === "/" &&
        !["INPUT", "TEXTAREA", "SELECT"].includes(
          (event.target as HTMLElement).tagName,
        )
      ) {
        event.preventDefault();
        setCommandOpen(true);
      }
    };
    // The platform's top-bar search opens the HR Hub's search on HR pages.
    const onSearch = () => setCommandOpen(true);
    document.addEventListener("keydown", onKeyDown);
    window.addEventListener(HUB_SEARCH_EVENT, onSearch);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      window.removeEventListener(HUB_SEARCH_EVENT, onSearch);
    };
  }, []);
  async function mutate(body: unknown) {
    setError("");
    const response = await fetch("/api/hr/hub", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error);
    await refresh();
    return result;
  }
  function success(message: string) {
    setModal(null);
    setNotice(message);
    setTimeout(() => setNotice(""), 6000);
  }
  // In the platform there is one sign-in for every portal, so an expired session goes to the platform sign-in page.
  if (auth) {
    if (typeof window !== "undefined") window.location.assign("/login");
    return null;
  }
  if (!data)
    return (
      <div className="cs h-embed">
        <div className="boot">
          <p>{error || "Opening your HR workspace…"}</p>
          {error && (
            <button
              onClick={() => {
                setError("");
                refresh();
              }}
            >
              Try again
            </button>
          )}
          <div className="skeleton" />
        </div>
      </div>
    );
  const editable = canEdit(data.user);
  const tasksPage = searchParams.get("view") === "tasks";
  const selected = data.employees.find((e) => e.id === employeeId);
  const title =
    section === "dashboard"
      ? "Home"
      : section === "alerts" && tasksPage
        ? "My tasks"
        : navigation.find((n) => n.id === section)?.name || "Home";
  const active = data.employees.filter((e) => e.status !== "Archived");
  const activeIds = new Set(active.map((e) => e.id));
  const attention = data.checks
    .filter(
      (c) =>
        activeIds.has(c.employee) &&
        !["Up to date", "Not applicable"].includes(checkStatus(c, data.today)),
    )
    .sort(
      (a, b) =>
        priorities[checkStatus(a, data.today)] -
          priorities[checkStatus(b, data.today)] ||
        (a.due || "").localeCompare(b.due || ""),
    );
  const openEmployee = (id: string) => router.push(employeeRoute(id, scope));
  function actionTable(items: Review[], limit?: number) {
    return (
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>Employee</th>
              <th>Requirement</th>
              {!limit && (
                <>
                  <th>Branch</th>
                  <th>Evidence</th>
                  <th>Last reviewed</th>
                </>
              )}
              <th>Review status</th>
              <th>Due date</th>
              {!limit && <th>HR owner</th>}
              <th />
            </tr>
          </thead>
          <tbody>
            {items.slice(0, limit).map((c) => {
              const e = data!.employees.find((e) => e.id === c.employee)!;
              return (
                <tr key={c.id}>
                  <td>
                    <button
                      className="person-cell"
                      onClick={() => openEmployee(e.id)}
                    >
                      <Avatar name={e.name} />
                      <span>
                        <strong>{e.name}</strong>
                        <small>
                          {data!.branches.find((b) => b.id === e.branch)?.name}
                        </small>
                      </span>
                    </button>
                  </td>
                  <td>
                    <span className="item-label">
                      <ShieldCheck size={16} />
                      {c.name}
                    </span>
                  </td>
                  {!limit && (
                    <>
                      <td>
                        {data!.branches.find((b) => b.id === e.branch)?.name}
                      </td>
                      <td>{c.evidence ? "On file" : "Missing evidence"}</td>
                      <td>{formatDate(c.checkedAt)}</td>
                    </>
                  )}
                  <td>
                    <Badge>{checkStatus(c, data!.today)}</Badge>
                  </td>
                  <td
                    className={
                      checkStatus(c, data!.today) === "Overdue"
                        ? "overdue-date"
                        : ""
                    }
                  >
                    {formatDate(c.due)}
                  </td>
                  {!limit && (
                    <td>
                      {data!.tasks
                        ?.filter(
                          (t) =>
                            t.requirement === c.id && t.status !== "Complete",
                        )
                        .map(
                          (t) =>
                            data!.users.find((u) => u.id === t.assignedTo)
                              ?.name,
                        )
                        .filter(Boolean)
                        .join(", ") || "Unassigned"}
                    </td>
                  )}
                  <td>
                    <button
                      className="text-btn"
                      onClick={() =>
                        editable
                          ? setModal({ type: "review", check: c })
                          : openEmployee(e.id)
                      }
                    >
                      Review <ChevronRight size={14} />
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {!items.length && (
          <Empty
            title="You’re all caught up"
            detail="No review items match this view."
          />
        )}
      </div>
    );
  }
  return (
    <>
      <HubHeader
        title={
          selected
            ? selected.name
            : section === "dashboard"
              ? "HR Dashboard"
              : title
        }
        back={
          selected
            ? "/hr/people?branch=" + scope
            : section === "dashboard"
              ? undefined
              : "/hr/dashboard?branch=" + scope
        }
        scope={scope}
        setScope={setScope}
        data={data}
      />
      <div className="cs h-embed">
        <div className={"h-content " + (selected ? "h-record-page" : "h-wrap")}>
          {notice && (
            <div role="status" className="toast">
              <CheckCircle2 size={18} />
              {notice}
            </div>
          )}
          {error && (
            <div role="alert" className="error">
              {error}
              <button onClick={() => setError("")}>Dismiss</button>
            </div>
          )}
          {section === "dashboard" && (
            <HRHome
              data={data}
              scope={scope}
              onAdd={() => setModal({ type: "employee" })}
              onUpload={() => setModal({ type: "upload" })}
              onDocument={(d) => setModal({ type: "document", document: d })}
            />
          )}
          {section === "training" && (
            <>
              <PageHeading
                title="Training"
                subtitle="Employee training requirements across your permitted workforce."
              />
              <section className="h-sheet">
                <div className="table-scroll">
                  <table className="h-dir h-dir--fit">
                    <thead>
                      <tr>
                        <th>Employee</th>
                        <th>Training requirement</th>
                        <th>Status</th>
                        <th>Next review</th>
                        <th>Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.checks
                        .filter(
                          (c) =>
                            activeIds.has(c.employee) &&
                            /training|certificate|first aid|manual handling|driving/i.test(
                              c.name + " " + c.category,
                            ),
                        )
                        .map((c) => {
                          const e = data.employees.find(
                            (e) => e.id === c.employee,
                          )!;
                          return (
                            <tr key={c.id}>
                              <td>
                                <Link
                                  className="h-emp"
                                  href={employeeRoute(e.id, scope)}
                                >
                                  <Avatar name={e.name} />
                                  <b>{e.name}</b>
                                </Link>
                              </td>
                              <td>{c.name}</td>
                              <td>
                                <Badge>{checkStatus(c, data.today)}</Badge>
                              </td>
                              <td>{formatDate(c.due)}</td>
                              <td>
                                <Link
                                  className="h-go"
                                  href={employeeRoute(e.id, scope)}
                                >
                                  Open profile <ChevronRight size={14} />
                                </Link>
                              </td>
                            </tr>
                          );
                        })}
                    </tbody>
                  </table>
                </div>
              </section>
            </>
          )}
          {section === "people" && !employeeId && (
            <People
              data={data}
              scope={scope}
              setScope={setScope}
              setModal={setModal}
              mutate={mutate}
              notify={setNotice}
            />
          )}
          {section === "people" &&
            employeeId &&
            (selected ? (
              <HRRecord
                employee={selected}
                data={data}
                scope={scope}
                mutate={mutate}
                onEdit={() =>
                  setModal({ type: "employee", employee: selected })
                }
                onUpload={() =>
                  setModal({ type: "upload", employee: selected })
                }
                onDocument={(d) => setModal({ type: "document", document: d })}
                onReview={(c) =>
                  editable
                    ? setModal({ type: "review", check: c })
                    : openEmployee(c.employee)
                }
                onNote={() => setModal({ type: "note", employee: selected })}
              />
            ) : (
              <Empty
                title="Employee not available"
                detail="This record is outside your selected or authorised branch scope."
              />
            ))}
          {section === "documents" && (
            <DocumentCentre
              data={data}
              scope={scope}
              onOpen={(d) => setModal({ type: "document", document: d })}
              onReview={(c) =>
                editable
                  ? setModal({ type: "review", check: c })
                  : openEmployee(c.employee)
              }
              onUpload={() => setModal({ type: "upload" })}
            />
          )}
          {section === "compliance" && (
            <Compliance data={data} actionTable={actionTable} />
          )}
          {section === "branches" && (
            <BranchWorkspace
              data={data}
              scope={scope}
              onBranch={(id) => {
                setScope(id);
                router.push(`/people?branch=${id}`);
              }}
            />
          )}
          {section === "alerts" && !tasksPage && (
            <AlertsWorkspace
              data={data}
              onEmployee={openEmployee}
              onReview={(c) =>
                editable
                  ? setModal({ type: "review", check: c })
                  : openEmployee(c.employee)
              }
              mutate={mutate}
              notify={success}
            />
          )}
          {section === "alerts" && (
            <HRTasks
              data={data}
              scope={scope}
              mutate={mutate}
              initialFilter={tasksPage ? "Assigned to me" : undefined}
            />
          )}
          {section === "imports" && (
            <Imports data={data} mutate={mutate} notify={setNotice} />
          )}
          {section === "settings" && (
            <SettingsPage data={data} mutate={mutate} notify={setNotice} />
          )}
        </div>
        {commandOpen && (
          <CommandPalette
            data={data}
            scope={scope}
            close={() => setCommandOpen(false)}
            editable={editable}
            onAdd={() => {
              setCommandOpen(false);
              setModal({ type: "employee" });
            }}
            onUpload={() => {
              setCommandOpen(false);
              setModal({ type: "upload" });
            }}
            onReview={() => {
              setCommandOpen(false);
              const first = attention.find((c) => c.required);
              if (first && editable) setModal({ type: "review", check: first });
              else if (first) openEmployee(first.employee);
            }}
            onEmployee={(id) => {
              setCommandOpen(false);
              openEmployee(id);
            }}
            onDocument={(id) => {
              setCommandOpen(false);
              const doc = data.documents.find((item) => item.id === id);
              if (doc) setModal({ type: "document", document: doc });
            }}
          />
        )}
        {modal?.type === "employee" && (
          <EmployeeForm
            data={data}
            employee={modal.employee}
            close={() => setModal(null)}
            mutate={mutate}
            done={() => success("Employee record saved.")}
          />
        )}
        {modal?.type === "document" && (
          <DocumentPreview
            document={modal.document}
            data={data}
            close={() => {
              setModal(null);
              refresh();
            }}
            onReview={(c) => setModal({ type: "review", check: c })}
            onNote={() =>
              setModal({
                type: "note",
                document: modal.document.id,
                employee: data.employees.find(
                  (e) => e.id === modal.document.employee,
                )!,
              })
            }
            replace={() =>
              setModal({
                type: "upload",
                employee: data.employees.find(
                  (e) => e.id === modal.document.employee,
                ),
                previous: modal.document,
              })
            }
          />
        )}
        {modal?.type === "upload" && (
          <UploadForm
            data={data}
            employee={modal.employee}
            previous={modal.previous}
            close={() => setModal(null)}
            done={async () => {
              await refresh();
              success(
                "Files received into quarantine. Scanning is required before access.",
              );
            }}
          />
        )}
        {modal?.type === "review" && (
          <ReviewForm
            check={modal.check}
            data={data}
            close={() => setModal(null)}
            mutate={mutate}
            done={() =>
              success("Review recorded. Statuses and reminders updated.")
            }
          />
        )}
        {modal?.type === "note" && (
          <NoteForm
            employee={modal.employee}
            document={modal.document}
            close={() => setModal(null)}
            mutate={mutate}
            done={() => success("HR note saved.")}
          />
        )}
        {modal?.type === "quick" && (
          <EmployeePanel
            data={data}
            employee={modal.employee}
            close={() => {
              setModal(null);
              const url = new URL(window.location.href);
              url.searchParams.delete("peek");
              window.history.replaceState(null, "", url);
            }}
            openRecord={() => {
              const params = new URLSearchParams(window.location.search);
              params.delete("peek");
              router.push(
                employeeRoute(
                  modal.employee.id,
                  scope,
                  "/people?" + params.toString(),
                ),
              );
              setModal(null);
            }}
            onDocument={(d) => setModal({ type: "document", document: d })}
            onReview={(c) => setModal({ type: "review", check: c })}
            onNote={() => setModal({ type: "note", employee: modal.employee })}
            onEdit={() =>
              setModal({ type: "employee", employee: modal.employee })
            }
            onUpload={() =>
              setModal({ type: "upload", employee: modal.employee })
            }
          />
        )}
      </div>
    </>
  );
}
function PageHeading({
  title,
  subtitle,
  action,
}: {
  title: string;
  subtitle: string;
  action?: ReactNode;
}) {
  return (
    <div className="page-heading">
      <div>
        <h1>{title}</h1>
        <p>{subtitle}</p>
      </div>
      {action}
    </div>
  );
}
type Mutate = (body: unknown) => Promise<Record<string, unknown>>;
function People({
  data,
  scope,
  setScope,
  setModal,
  mutate,
  notify,
}: {
  data: Data;
  scope: string;
  setScope: (s: string) => void;
  setModal: (m: Modal) => void;
  mutate: Mutate;
  notify: (s: string) => void;
}) {
  const router = useRouter();
  const openRecord = (e: Employee) =>
    router.push(
      employeeRoute(
        e.id,
        scope,
        "/people?" + new URLSearchParams(window.location.search).toString(),
      ),
    );
  const params =
    typeof window !== "undefined"
      ? new URLSearchParams(window.location.search)
      : new URLSearchParams();
  const openPeek = (e: Employee) => {
    const url = new URL(window.location.href);
    url.searchParams.set("peek", e.id);
    window.history.pushState(null, "", url);
    setModal({ type: "quick", employee: e });
  };
  const [view, setView] = useState(params.get("view") || "All people");
  const [search, setSearch] = useState(params.get("q") || "");
  const [job, setJob] = useState(params.get("job") || "");
  const [employment, setEmployment] = useState(params.get("employment") || "");
  const [review, setReview] = useState(params.get("review") || "");
  const [due, setDue] = useState(params.get("due") || "");
  const [manager, setManager] = useState(params.get("manager") || "");
  const [sorting, setSorting] = useState<SortingState>([]);
  const [visibility, setVisibility] = useState<Record<string, boolean>>({
    updated: false,
    nextReview: false,
    missing: false,
    documents: false,
  });
  const [showColumns, setShowColumns] = useState(false);
  const [saveName, setSaveName] = useState("");
  const [error, setError] = useState("");
  const checks = (id: string) => data.checks.filter((c) => c.employee === id);
  const matches = (e: Employee, status: string) =>
    checks(e.id).some((c) => checkStatus(c, data.today) === status);
  const peopleStatus = (e: Employee) => {
    const statuses = checks(e.id)
      .filter((c) => c.required)
      .map((c) => checkStatus(c, data.today));
    if (statuses.includes("Overdue")) return "Overdue";
    if (statuses.includes("Missing evidence")) return "Missing evidence";
    if (statuses.includes("Due soon")) return "Due soon";
    return "Checks up to date";
  };
  const filtered = data.employees.filter((e) => {
    if (
      !(e.name + " " + e.staffId + " " + e.email)
        .toLowerCase()
        .includes(search.toLowerCase()) ||
      (job && e.job !== job) ||
      (manager && e.lineManager !== manager) ||
      (employment && e.status !== employment) ||
      (review && !matches(e, review)) ||
      (due && !checks(e.id).some((c) => c.due && c.due <= due))
    )
      return false;
    if (view === "Archived" || employment === "Archived")
      return e.status === "Archived";
    if (e.status === "Archived") return false;
    if (view === "Active") return e.status === view;
    if (view === "New starters") return e.status === "Onboarding";
    if (view === "Reviews due") return matches(e, "Due soon");
    if (view === "Overdue") return matches(e, "Overdue");
    if (view === "Missing documents") return matches(e, "Missing evidence");
    if (view === "All clear") return peopleStatus(e) === "Checks up to date";
    if (view === "Due soon") return peopleStatus(e) === "Due soon";
    if (view === "Up to date")
      return employeeStatus(checks(e.id), data.today) === "Checks up to date";
    return true;
  });
  const columns: ColumnDef<Employee>[] = [
    {
      accessorKey: "name",
      header: "Employee",
      cell: ({ row }) => (
        <button
          onClick={() => openRecord(row.original)}
          className="person-cell h-emp"
        >
          <Avatar name={row.original.name} />
          <span>
            <strong>{row.original.name}</strong>
            <small>{row.original.email}</small>
          </span>
        </button>
      ),
    },
    {
      accessorKey: "staffId",
      header: "Staff ID",
      cell: ({ row }) => <span className="mono">{row.original.staffId}</span>,
    },
    { accessorKey: "job", header: "Role" },
    {
      accessorKey: "branch",
      header: "Branch",
      cell: ({ row }) =>
        data.branches.find((b) => b.id === row.original.branch)?.name,
    },
    {
      accessorKey: "lineManager",
      header: "Manager",
      cell: ({ row }) =>
        row.original.lineManager ? (
          <span className="h-mgr">
            <Avatar name={row.original.lineManager} />
            {row.original.lineManager}
          </span>
        ) : (
          "—"
        ),
    },
    {
      accessorKey: "status",
      header: "Employment",
      cell: ({ row }) => <Badge variant="neutral">{row.original.status}</Badge>,
    },
    {
      id: "reviewStatus",
      accessorFn: (e) => employeeStatus(checks(e.id), data.today),
      header: "Compliance",
      cell: ({ row }) => (
        <Badge>{health(checks(row.original.id), data.today)}</Badge>
      ),
    },
    {
      accessorKey: "start",
      header: "Start date",
      cell: ({ row }) => formatDate(row.original.start),
    },
    {
      id: "nextReview",
      accessorFn: (e) =>
        checks(e.id)
          .filter((c) => c.required && c.due)
          .map((c) => c.due!)
          .sort()[0],
      header: "Next review",
      cell: ({ row }) =>
        formatDate(
          checks(row.original.id)
            .filter((c) => c.required && c.due)
            .map((c) => c.due!)
            .sort()[0] || null,
        ),
    },
    {
      id: "missing",
      header: "Missing docs",
      cell: ({ row }) => (
        <span className="count-pill">
          {
            checks(row.original.id).filter(
              (c) => checkStatus(c, data.today) === "Missing evidence",
            ).length
          }
        </span>
      ),
    },
    {
      id: "documents",
      header: "Documents",
      cell: ({ row }) => (
        <span className="item-label">
          <FileText size={14} />
          {data.documents.filter((d) => d.employee === row.original.id).length}
        </span>
      ),
    },
    {
      accessorKey: "updated",
      header: "Updated",
      cell: ({ row }) => formatDate(row.original.updated),
    },
    {
      id: "actions",
      header: "",
      cell: ({ row }) => (
        <button
          className="icon-btn"
          aria-label={`Quick view ${row.original.name}`}
          onClick={() => openPeek(row.original)}
        >
          <MoreHorizontal size={18} />
        </button>
      ),
    },
  ];
  // TanStack owns its mutable table instance; React Compiler must not memoize it.

  const table = useReactTable({
    data: filtered,
    columns,
    state: { sorting, columnVisibility: visibility },
    onSortingChange: setSorting,
    onColumnVisibilityChange: setVisibility,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    autoResetPageIndex: false,
    initialState: {
      pagination: { pageSize: 12, pageIndex: Number(params.get("page") || 0) },
    },
  });
  const pageIndex = table.getState().pagination.pageIndex;
  useEffect(() => {
    const url = new URL(window.location.href);
    for (const [key, value] of Object.entries({
      view,
      q: search,
      employment,
      job,
      review,
      due,
      manager,
      page: String(pageIndex),
    })) {
      if (value) url.searchParams.set(key, value);
      else url.searchParams.delete(key);
    }
    if (url.href !== window.location.href)
      window.history.replaceState(null, "", url);
  }, [view, search, job, review, due, pageIndex, employment, manager]);
  const reset = () => {
    setView("All people");
    setSearch("");
    setEmployment("");
    setJob("");
    setReview("");
    setDue("");
    setManager("");
    table.setPageIndex(0);
  };
  return (
    <>
      <PageHeading
        title="People"
        subtitle="Manage your workforce across CSB."
        action={
          <div className="button-group">
            {canEdit(data.user) && (
              <button
                className="secondary-button"
                onClick={() => router.push("/imports?branch=" + scope)}
              >
                <Upload size={16} /> Import CSV
              </button>
            )}
            <button
              className="primary"
              disabled={!canEdit(data.user)}
              onClick={() => setModal({ type: "employee" })}
            >
              <Plus size={17} /> Add employee
            </button>
          </div>
        }
      />
      <section className="h-sheet people-panel h-directory">
        <div className="h-tabs" role="tablist" aria-label="Employment views">
          {[
            "All employees",
            "Active",
            "New starters",
            "On leave",
            "Archived",
          ].map((v) => {
            const internal = v === "All employees" ? "All people" : v;
            const count = data.employees.filter((e) =>
              v === "All employees"
                ? e.status !== "Archived"
                : v === "New starters"
                  ? e.status === "Onboarding"
                  : e.status === internal,
            ).length;
            return (
              <button
                key={v}
                role="tab"
                aria-selected={view === internal}
                disabled={v === "On leave"}
                title={
                  v === "On leave"
                    ? "Coming soon — leave status is not tracked"
                    : undefined
                }
                onClick={() => {
                  setView(internal);
                  table.setPageIndex(0);
                }}
              >
                {v}
                <span className="cs-count">{count}</span>
              </button>
            );
          })}
        </div>
        <div className="table-toolbar">
          <div className="local-search">
            <Search size={16} />
            <input
              aria-label="Search people"
              placeholder="Search people…"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                table.setPageIndex(0);
              }}
            />
          </div>
          <select
            aria-label="People branch"
            value={scope}
            onChange={(ev) => setScope(ev.target.value)}
          >
            <option value="all">Branch: All</option>
            {data.branches.map((b) => (
              <option value={b.id} key={b.id}>
                {b.name}
              </option>
            ))}
          </select>
          <select
            aria-label="Filter job role"
            value={job}
            onChange={(event) => {
              setJob(event.target.value);
              table.setPageIndex(0);
            }}
          >
            <option value="">Role</option>
            {[...new Set(data.employees.map((employee) => employee.job))].map(
              (role) => (
                <option key={role}>{role}</option>
              ),
            )}
          </select>
          <select
            aria-label="Employment status"
            value={employment}
            onChange={(ev) => {
              setEmployment(ev.target.value);
              table.setPageIndex(0);
            }}
          >
            <option value="">Employment</option>
            {["Active", "Onboarding", "Archived"].map((s) => (
              <option key={s} value={s}>
                {s === "Onboarding" ? "New starter" : s}
              </option>
            ))}
          </select>
          <select
            aria-label="Filter manager"
            value={manager}
            onChange={(ev) => {
              setManager(ev.target.value);
              table.setPageIndex(0);
            }}
          >
            <option value="">Manager</option>
            {[
              ...new Set(
                data.employees.map((e) => e.lineManager).filter(Boolean),
              ),
            ].map((m) => (
              <option key={m}>{m}</option>
            ))}
          </select>
          <select
            aria-label="Filter review status"
            value={review}
            onChange={(e) => {
              setReview(e.target.value);
              table.setPageIndex(0);
            }}
          >
            <option value="">Compliance</option>
            {Object.keys(priorities).map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
          <button
            className="secondary-button"
            disabled={!canEdit(data.user)}
            onClick={() => {
              const link = document.createElement("a");
              link.href = `/api/hr/hub?export=csv&branch=${scope}&ids=${filtered.map((e) => e.id).join(",")}`;
              link.download = "csb-people.csv";
              link.click();
            }}
          >
            <Download size={16} /> Export
          </button>
          <div className="column-control">
            <button
              className="secondary-button"
              onClick={() => setShowColumns(!showColumns)}
            >
              <SlidersHorizontal size={15} /> Columns
            </button>
            {showColumns && (
              <div className="popover">
                {table
                  .getAllLeafColumns()
                  .filter((c) => !["name", "actions"].includes(c.id))
                  .map((c) => (
                    <label key={c.id}>
                      <input
                        type="checkbox"
                        checked={c.getIsVisible()}
                        onChange={c.getToggleVisibilityHandler()}
                      />
                      {typeof c.columnDef.header === "string"
                        ? c.columnDef.header
                        : c.id}
                    </label>
                  ))}
              </div>
            )}
          </div>
        </div>
        <details className="h-directory-tools">
          <summary>Saved views & advanced filters</summary>
          <div className="filter-row">
            <Filter size={14} />
            <label>
              Due by{" "}
              <input
                type="date"
                aria-label="Due by"
                value={due}
                onChange={(e) => {
                  setDue(e.target.value);
                  table.setPageIndex(0);
                }}
              />
            </label>
            <button className="text-btn" onClick={reset}>
              Reset filters
            </button>
            <div className="save-view">
              <select
                aria-label="Saved views"
                defaultValue=""
                onChange={(e) => {
                  const v = data.views.find((v) => v.id === e.target.value);
                  if (v) {
                    const restored = new URL(window.location.href);
                    for (const [key, value] of Object.entries({
                      view: v.filters.view || "All people",
                      q: v.filters.search || "",
                      employment: v.filters.employment || "",
                      manager: v.filters.manager || "",
                      job: v.filters.job || "",
                      review: v.filters.review || "",
                      due: v.filters.due || "",
                      page: "0",
                    })) {
                      restored.searchParams.set(key, value);
                    }
                    window.history.replaceState(null, "", restored);
                    setView(v.filters.view || "All people");
                    setSearch(v.filters.search || "");
                    setEmployment(v.filters.employment || "");
                    setManager(v.filters.manager || "");
                    setJob(v.filters.job || "");
                    setReview(v.filters.review || "");
                    setDue(v.filters.due || "");
                    if (
                      v.filters.branch === "all" ||
                      data.user.branches.includes(v.filters.branch)
                    )
                      setScope(v.filters.branch);
                    setVisibility(
                      Object.fromEntries(
                        table
                          .getAllLeafColumns()
                          .map((c) => [c.id, v.columns.includes(c.id)]),
                      ),
                    );
                  }
                }}
              >
                <option value="">Saved views</option>
                {data.views.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.name}
                  </option>
                ))}
              </select>
              <input
                aria-label="View name"
                placeholder="Name this view"
                value={saveName}
                onChange={(e) => setSaveName(e.target.value)}
              />
              <button
                className="text-btn"
                disabled={!saveName.trim()}
                onClick={async () => {
                  try {
                    await mutate({
                      action: "save-view",
                      name: saveName,
                      filters: {
                        view,
                        search,
                        job,
                        review,
                        due,
                        employment,
                        manager,
                        branch: scope,
                      },
                      columns: table.getVisibleLeafColumns().map((c) => c.id),
                    });
                    notify("Personal view saved.");
                    setSaveName("");
                  } catch (e) {
                    setError((e as Error).message);
                  }
                }}
              >
                Save view
              </button>
            </div>
          </div>
        </details>
        {error && <div className="error">{error}</div>}
        <p className="people-table-hint">
          Scroll horizontally to see branch, role and compliance details.
        </p>
        <div className="table-scroll">
          <table className="people-table h-dir">
            <thead>
              {table.getHeaderGroups().map((group) => (
                <tr key={group.id}>
                  {group.headers.map((header) => (
                    <th key={header.id}>
                      {header.column.getCanSort() ? (
                        <button
                          className="sort-button"
                          onClick={header.column.getToggleSortingHandler()}
                        >
                          {flexRender(
                            header.column.columnDef.header,
                            header.getContext(),
                          )}
                          <span>
                            {header.column.getIsSorted() === "desc"
                              ? "↓"
                              : header.column.getIsSorted() === "asc"
                                ? "↑"
                                : "↕"}
                          </span>
                        </button>
                      ) : (
                        flexRender(
                          header.column.columnDef.header,
                          header.getContext(),
                        )
                      )}
                    </th>
                  ))}
                </tr>
              ))}
            </thead>
            <tbody>
              {table.getRowModel().rows.map((row) => (
                <tr
                  key={row.id}
                  onClick={(event) => {
                    if ((event.target as HTMLElement).closest("button,a,input"))
                      return;
                    openRecord(row.original);
                  }}
                >
                  {row.getVisibleCells().map((cell) => (
                    <td key={cell.id}>
                      {flexRender(
                        cell.column.columnDef.cell,
                        cell.getContext(),
                      )}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
          {!filtered.length && (
            <Empty
              title="No matching employees"
              detail="Try another search or reset your filters."
            />
          )}
        </div>
        <div className="pagination">
          <span>
            {filtered.length} employees · Page{" "}
            {table.getState().pagination.pageIndex + 1} of{" "}
            {Math.max(1, table.getPageCount())}
          </span>
          <div>
            <button
              className="secondary-button"
              disabled={!table.getCanPreviousPage()}
              onClick={() => table.previousPage()}
            >
              <ChevronLeft size={15} /> Previous
            </button>
            <button
              className="secondary-button"
              disabled={!table.getCanNextPage()}
              onClick={() => table.nextPage()}
            >
              Next <ChevronRight size={15} />
            </button>
          </div>
        </div>
      </section>
    </>
  );
}
function Compliance({
  data,
  actionTable,
}: {
  data: Data;
  actionTable: (items: Review[], limit?: number) => ReactNode;
}) {
  const [status, setStatus] = useState(
    typeof window !== "undefined"
      ? new URLSearchParams(window.location.search).get("status") ||
          "All checks"
      : "All checks",
  );
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("");
  const [branch, setBranch] = useState("");
  const active = new Set(
    data.employees.filter((e) => e.status !== "Archived").map((e) => e.id),
  );
  const categories = sortCheckCategories(
    Array.from(
      new Set(
        data.checks
          .filter((c) => active.has(c.employee) && c.required)
          .map(checkCategory),
      ),
    ),
  );
  const checks = data.checks
    .filter(
      (c) =>
        active.has(c.employee) &&
        c.required &&
        (!category || checkCategory(c) === category) &&
        (!branch ||
          data.employees.find((e) => e.id === c.employee)?.branch === branch) &&
        (c.name + " " + data.employees.find((e) => e.id === c.employee)?.name)
          .toLowerCase()
          .includes(search.toLowerCase()) &&
        (status === "All checks" || checkStatus(c, data.today) === status),
    )
    .sort(
      (a, b) =>
        priorities[checkStatus(a, data.today)] -
        priorities[checkStatus(b, data.today)],
    );
  return (
    <>
      <PageHeading
        title="Compliance"
        subtitle="Evidence, decisions and organisational review dates in one place."
      />
      <div className="category-summary-strip">
        {categories.map((cat) => (
          <button
            key={cat}
            className={category === cat ? "active" : ""}
            onClick={() => setCategory(category === cat ? "" : cat)}
          >
            <strong>{cat}</strong>
            <span>
              {
                data.checks.filter(
                  (c) =>
                    active.has(c.employee) &&
                    c.required &&
                    checkCategory(c) === cat &&
                    !["Up to date", "Not applicable"].includes(
                      checkStatus(c, data.today),
                    ),
                ).length
              }{" "}
              need attention
            </span>
          </button>
        ))}
      </div>
      <div className="info-banner">
        <ShieldCheck size={20} />
        <span>{data.settings.dbsPolicy}</span>
      </div>
      <section className="panel bounded-register">
        <div className="tabs">
          {[
            "All checks",
            "Overdue",
            "Due soon",
            "Missing evidence",
            "Awaiting verification",
            "Up to date",
          ].map((s) => (
            <button
              key={s}
              className={status === s ? "active" : ""}
              onClick={() => setStatus(s)}
            >
              {s === "All checks"
                ? "Overview"
                : s === "Up to date"
                  ? "Complete"
                  : s}
            </button>
          ))}
        </div>
        <div className="table-toolbar">
          <div className="local-search">
            <Search size={16} />
            <input
              aria-label="Search compliance"
              placeholder="Search employees or checks"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <select
            aria-label="Compliance branch"
            value={branch}
            onChange={(e) => setBranch(e.target.value)}
          >
            <option value="">All permitted branches</option>
            {data.branches.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
          <select
            aria-label="Compliance category"
            value={category}
            onChange={(e) => setCategory(e.target.value)}
          >
            <option value="">All categories</option>
            {categories.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
          <span className="muted">{checks.length} checks</span>
        </div>
        {actionTable(checks)}
      </section>
    </>
  );
}
function EmployeeForm({
  data,
  employee,
  close,
  mutate,
  done,
}: {
  data: Data;
  employee?: Employee;
  close: () => void;
  mutate: Mutate;
  done: () => void;
}) {
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [branch, setBranch] = useState(employee?.branch || data.branches[0].id);
  const [employmentStatus, setEmploymentStatus] = useState(
    employee?.status || "Onboarding",
  );
  return (
    <Drawer
      title={employee ? "Edit employee" : "Add employee"}
      description="An HR record only. No login account or invitation is created."
      onClose={close}
    >
      <form
        onSubmit={async (event) => {
          event.preventDefault();
          setBusy(true);
          setError("");
          const form = new FormData(event.currentTarget);
          try {
            await mutate({
              action: "employee",
              id: employee?.id,
              version: employee?.version,
              confirmTransfer: form.get("confirmTransfer") === "on",
              confirmArchive: form.get("confirmArchive") === "on",
              employee: Object.fromEntries(
                [
                  "staffId",
                  "name",
                  "branch",
                  "job",
                  "status",
                  "start",
                  "email",
                  "phone",
                  "addressLine1",
                  "addressLine2",
                  "city",
                  "county",
                  "postcode",
                  "country",
                  "preferredName",
                  "department",
                  "lineManager",
                  "employmentType",
                  "dateOfBirth",
                  "leavingDate",
                  "emergencyName",
                  "emergencyRelationship",
                  "emergencyPhone",
                  "identificationType",
                  "identificationLastFour",
                ]
                  .filter(
                    (key) =>
                      data.user.sensitive ||
                      ![
                        "addressLine1",
                        "addressLine2",
                        "city",
                        "county",
                        "postcode",
                        "country",
                        "dateOfBirth",
                        "emergencyName",
                        "emergencyRelationship",
                        "emergencyPhone",
                        "identificationType",
                        "identificationLastFour",
                      ].includes(key),
                  )
                  .map((key) => [key, form.get(key) || ""]),
              ),
            });
            done();
          } catch (e) {
            setError((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <div className="info-banner">
          Use fictional employee details only in this pilot.
        </div>
        <Field label="Full name">
          <input
            name="name"
            autoComplete="off"
            required
            minLength={2}
            defaultValue={employee?.name}
          />
        </Field>
        <div className="form-grid">
          <Field label="Staff ID">
            <input
              name="staffId"
              required
              pattern="[A-Za-z0-9_-]+"
              defaultValue={employee?.staffId}
            />
          </Field>
          <Field label="Branch">
            <select
              name="branch"
              value={branch}
              onChange={(e) => setBranch(e.target.value)}
            >
              {data.branches.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
          </Field>
        </div>
        <Field label="Job role">
          <input
            aria-label="Job role"
            name="job"
            list="jobs"
            required
            defaultValue={employee?.job}
          />
          <datalist id="jobs">
            {[
              "Care Support Worker",
              "Senior Support Worker",
              "Care Coordinator",
              "Registered Manager",
              "HR Administrator",
            ].map((j) => (
              <option key={j}>{j}</option>
            ))}
          </datalist>
        </Field>
        <div className="form-grid">
          <Field label="Employment status">
            <select
              name="status"
              value={employmentStatus}
              onChange={(e) =>
                setEmploymentStatus(e.target.value as Employee["status"])
              }
            >
              {["Active", "Onboarding", "Archived"].map((s) => (
                <option key={s} value={s}>
                  {s === "Onboarding" ? "New starter" : s}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Start date">
            <input
              type="date"
              name="start"
              required
              defaultValue={employee?.start || data.today}
            />
          </Field>
        </div>
        <Field label="Preferred name">
          <input
            name="preferredName"
            maxLength={100}
            defaultValue={employee?.preferredName}
          />
        </Field>
        <Field label="Department / team">
          <input
            name="department"
            maxLength={100}
            defaultValue={employee?.department}
          />
        </Field>
        <Field label="Line manager">
          <input
            name="lineManager"
            maxLength={100}
            defaultValue={employee?.lineManager}
          />
        </Field>
        <Field label="Employment type">
          <input
            name="employmentType"
            maxLength={100}
            defaultValue={employee?.employmentType}
          />
        </Field>
        <Field label="Leaving date">
          <input
            name="leavingDate"
            type="date"
            maxLength={10}
            defaultValue={employee?.leavingDate}
          />
        </Field>
        {data.user.sensitive && (
          <fieldset className="address-fields">
            <legend>Private personal details</legend>
            <Field label="Date of birth">
              <input
                name="dateOfBirth"
                type="date"
                maxLength={10}
                defaultValue={employee?.dateOfBirth}
              />
            </Field>
            <Field label="Emergency contact name">
              <input
                name="emergencyName"
                maxLength={100}
                defaultValue={employee?.emergencyName}
              />
            </Field>
            <Field label="Emergency contact relationship">
              <input
                name="emergencyRelationship"
                maxLength={100}
                defaultValue={employee?.emergencyRelationship}
              />
            </Field>
            <Field label="Emergency contact phone">
              <input
                name="emergencyPhone"
                maxLength={40}
                defaultValue={employee?.emergencyPhone}
              />
            </Field>
            <Field label="Identification type">
              <input
                name="identificationType"
                maxLength={100}
                defaultValue={employee?.identificationType}
              />
            </Field>
            <Field label="Identification reference (last four only)">
              <input
                name="identificationLastFour"
                maxLength={4}
                defaultValue={employee?.identificationLastFour}
              />
            </Field>
          </fieldset>
        )}{" "}
        <Field label="Email address (optional)">
          <input
            type="email"
            name="email"
            defaultValue={employee?.email}
            placeholder="name@example.com"
          />
        </Field>
        {employmentStatus === "Archived" && employee?.status !== "Archived" && (
          <label className="checkbox warning">
            <input type="checkbox" name="confirmArchive" required />
            Confirm archiving this employee. Outstanding reminders will be
            cancelled.
          </label>
        )}
        <Field label="Phone number (optional)">
          <input name="phone" defaultValue={employee?.phone} />
        </Field>
        {data.user.sensitive && (
          <fieldset className="address-fields">
            <legend>Home address</legend>
            <p className="muted">
              Employee residential address. Leave unknown fields blank.
            </p>
            <Field label="Address line 1">
              <input
                name="addressLine1"
                maxLength={200}
                defaultValue={employee?.addressLine1}
              />
            </Field>
            <Field label="Address line 2">
              <input
                name="addressLine2"
                maxLength={200}
                defaultValue={employee?.addressLine2}
              />
            </Field>
            <Field label="Town / city">
              <input
                name="city"
                maxLength={100}
                defaultValue={employee?.city}
              />
            </Field>
            <Field label="County / region">
              <input
                name="county"
                maxLength={100}
                defaultValue={employee?.county}
              />
            </Field>
            <Field label="Postcode">
              <input
                name="postcode"
                maxLength={20}
                defaultValue={employee?.postcode}
              />
            </Field>
            <Field label="Country">
              <input
                name="country"
                maxLength={100}
                defaultValue={employee?.country}
              />
            </Field>
          </fieldset>
        )}
        {employee && branch !== employee.branch && (
          <label className="checkbox warning">
            <input type="checkbox" name="confirmTransfer" required />
            Confirm branch transfer. Previous branch users will lose access to
            this employee and their documents.
          </label>
        )}
        {error && (
          <div className="error" role="alert">
            {error}
          </div>
        )}
        <div className="form-actions">
          <button type="button" className="secondary-button" onClick={close}>
            Cancel
          </button>
          <button className="primary" disabled={busy}>
            {busy ? "Saving…" : "Save employee"}
          </button>
        </div>
      </form>
    </Drawer>
  );
}
function ReviewForm({
  check,
  data,
  close,
  mutate,
  done,
}: {
  check: Review;
  data: Data;
  close: () => void;
  mutate: Mutate;
  done: () => void;
}) {
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const expected = checkCategory(check);
  // The next review must be in the future; an overdue date is never offered
  // as the default.
  const minDue = new Date(Date.parse(data.today + "T00:00:00Z") + 86400000)
    .toISOString()
    .slice(0, 10);
  const evidence = data.documents.filter(
    (d) =>
      d.employee === check.employee &&
      d.category === expected &&
      d.state === "Sample",
  );
  return (
    <Drawer
      title={`Record ${check.name.replace(/^(?!DBS)\w/, (c) => c.toLowerCase())}`}
      description={data.employees.find((e) => e.id === check.employee)?.name}
      onClose={close}
    >
      <div className="info-banner">
        <ShieldCheck size={20} />
        <span>
          Record a review you performed outside this application. Uploading a
          file alone never verifies evidence.
        </span>
      </div>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setError("");
          setBusy(true);
          const f = new FormData(e.currentTarget);
          try {
            await mutate({
              action: "review",
              id: check.id,
              version: check.version,
              evidence: f.get("evidence"),
              due: f.get("due"),
              confirm: f.get("confirm") === "on",
            });
            done();
          } catch (err) {
            setError((err as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <Field label="Evidence reviewed">
          <select name="evidence" required defaultValue={check.evidence || ""}>
            <option value="">Select released evidence</option>
            {evidence.map((d) => (
              <option key={d.id} value={d.id}>
                {d.filename} · v{d.version}
              </option>
            ))}
          </select>
        </Field>
        {!evidence.length && (
          <p className="warning">
            No released evidence in this category. Uploaded files remain
            quarantined until scanning is configured.
          </p>
        )}
        <Field
          label={
            check.name === "DBS review"
              ? "Next organisational DBS review date"
              : "Next review date"
          }
        >
          <input
            type="date"
            name="due"
            required={check.recurring}
            min={minDue}
            defaultValue={check.due && check.due >= minDue ? check.due : ""}
          />
        </Field>
        <p className="muted">
          {check.name === "DBS review"
            ? "This is not a DBS expiry date. No Update Service query is performed."
            : "The reviewer is responsible for setting an appropriate date."}
        </p>
        <div className="detail-list">
          <p>
            <span>Recorded by</span>
            {data.user.name}
          </p>
          <p>
            <span>Verification</span>Explicit HR decision
          </p>
        </div>
        <label className="checkbox">
          <input name="confirm" type="checkbox" required />I reviewed the linked
          evidence and confirm this verification decision.
        </label>
        {error && (
          <div role="alert" className="error">
            {error}
          </div>
        )}
        <div className="form-actions">
          <button type="button" className="secondary-button" onClick={close}>
            Cancel
          </button>
          <button className="primary" disabled={busy || !evidence.length}>
            {busy ? "Recording…" : "Record review"}
          </button>
        </div>
      </form>
    </Drawer>
  );
}
function NoteForm({
  employee,
  document,
  close,
  mutate,
  done,
}: {
  employee: Employee;
  document?: string;
  close: () => void;
  mutate: Mutate;
  done: () => void;
}) {
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <Drawer title="Add HR note" description={employee.name} onClose={close}>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget);
          setBusy(true);
          try {
            await mutate({
              action: "note",
              employee: employee.id,
              document,
              text: f.get("text"),
            });
            done();
          } catch (err) {
            setError((err as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <Field label="Note">
          <textarea name="text" rows={8} required maxLength={3000} />
        </Field>
        <p className="muted">
          Keep notes necessary and factual. Do not record criminal-record
          narratives here.
        </p>
        {error && (
          <div className="error" role="alert">
            {error}
          </div>
        )}
        <button className="primary" disabled={busy}>
          {busy ? "Saving…" : "Save note"}
        </button>
      </form>
    </Drawer>
  );
}
function DocumentPreview({
  document: d,
  data,
  close,
  replace,
  onReview,
  onNote,
}: {
  document: Doc;
  data: Data;
  close: () => void;
  replace: () => void;
  onReview: (c: Review) => void;
  onNote: () => void;
}) {
  const versionIds = new Set([d.id]);
  let count = 0;
  while (count !== versionIds.size) {
    count = versionIds.size;
    for (const file of data.documents) {
      if (file.employee !== d.employee) continue;
      if (versionIds.has(file.id) && file.previous)
        versionIds.add(file.previous);
      if (file.previous && versionIds.has(file.previous))
        versionIds.add(file.id);
    }
  }
  const [zoom, setZoom] = useState(100);
  const previewRef = useRef<HTMLDivElement>(null);
  const [history, setHistory] = useState(false);
  const [url, setUrl] = useState("");
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    let blobUrl = "";
    if (d.state === "Sample")
      fetch(`/api/hr/documents?id=${d.id}`, { cache: "no-store" })
        .then(async (response) => {
          if (!response.ok) throw new Error((await response.json()).error);
          const blob = await response.blob();
          if (active) {
            blobUrl = URL.createObjectURL(blob);
            setUrl(blobUrl);
          }
        })
        .catch((e) => {
          if (active) setError(e.message);
        });
    return () => {
      active = false;
      if (blobUrl) URL.revokeObjectURL(blobUrl);
    };
  }, [d.id, d.state]);
  return (
    <Drawer
      title={documentTitle(d, data.checks)}
      description={`${data.employees.find((e) => e.id === d.employee)?.name} · ${d.category}`}
      onClose={close}
      wide
    >
      <div className="preview-toolbar">
        <Badge>{d.state}</Badge>
        <span>Version {d.version}</span>
        <div className="spacer" />
        <button
          className="icon-btn"
          aria-label="Zoom out"
          onClick={() => setZoom((z) => Math.max(50, z - 25))}
        >
          <ZoomOut size={18} />
        </button>
        <span>{zoom}%</span>
        <button
          className="icon-btn"
          aria-label="Zoom in"
          onClick={() => setZoom((z) => Math.min(200, z + 25))}
        >
          <ZoomIn size={18} />
        </button>
        {url && (
          <button
            className="icon-btn"
            onClick={() =>
              previewRef.current
                ?.requestFullscreen()
                .catch(() =>
                  setError(
                    "Full-screen mode is unavailable in this browser. Use the zoom controls.",
                  ),
                )
            }
            aria-label="Full-screen document"
          >
            <ExternalLink size={18} />
          </button>
        )}
      </div>
      {error && <div className="error">{error}</div>}
      <div className="preview-layout">
        <div className="preview-canvas" ref={previewRef}>
          {d.state === "Quarantined" ? (
            <Empty
              title="File is safely quarantined"
              detail="Malware scanning is not configured. This file cannot be previewed or downloaded, and does not verify a check."
            />
          ) : url ? (
            <PdfPreview url={url} zoom={zoom} name={d.filename} />
          ) : (
            <div className="skeleton">Authorising preview…</div>
          )}
        </div>
        <aside className="preview-details">
          <h3>Document information</h3>
          <p className="muted">{d.filename}</p>
          <Badge>{documentState(d, data)}</Badge>
          <div className="detail-list">
            <p>
              <span>Employee</span>
              {data.employees.find((e) => e.id === d.employee)?.name}
            </p>
            <p>
              <span>Branch</span>
              {
                data.branches.find(
                  (b) =>
                    b.id ===
                    data.employees.find((e) => e.id === d.employee)?.branch,
                )?.name
              }
            </p>
            <p>
              <span>Verified by</span>
              {data.checks.find((c) => c.evidence === d.id)?.reviewer ||
                "Not verified"}
            </p>
            <p>
              <span>Category</span>
              {d.category}
            </p>
            <p>
              <span>Uploaded by</span>
              {d.uploader}
            </p>
            <p>
              <span>Uploaded</span>
              {formatDate(d.uploaded)}
            </p>
            <p>
              <span>Issue date</span>
              {formatDate(d.issueDate)}
            </p>
            <p>
              <span>Review date</span>
              {formatDate(documentDue(d, data))}
            </p>
            <p>
              <span>Expiry date</span>
              {d.category === "DBS"
                ? "Not applicable"
                : formatDate(d.expiryDate)}
            </p>
            <p>
              <span>Retention review</span>
              {formatDate(d.retentionDate)}
            </p>
          </div>
          <p className="muted">
            Document presence does not establish verification. See the
            employee’s Compliance tab.
          </p>
          <a
            className={`secondary-button full ${d.state !== "Sample" ? "disabled" : ""}`}
            href={
              d.state === "Sample"
                ? `/api/hr/documents?id=${d.id}&download=1`
                : undefined
            }
          >
            <Download size={16} /> Download
          </a>
          <button
            className="secondary-button full"
            disabled={!canEdit(data.user)}
            onClick={replace}
          >
            <Upload size={16} /> Replace document
          </button>
          {canEdit(data.user) && (
            <>
              <button className="secondary-button full" onClick={onNote}>
                Add document note
              </button>
              {data.checks
                .filter((c) => c.evidence === d.id)
                .map((c) => (
                  <button
                    key={c.id}
                    className="secondary-button full"
                    onClick={() => onReview(c)}
                  >
                    Record review · {c.name}
                  </button>
                ))}
            </>
          )}
          <button className="text-btn" onClick={() => setHistory(!history)}>
            <History size={16} /> Version history
          </button>
          {history && (
            <div className="version-history">
              {data.documents
                .filter((x) => versionIds.has(x.id))
                .map((x) => (
                  <p key={x.id}>
                    <strong>
                      Version {x.version} · {x.state}
                    </strong>
                    <small>
                      {formatDate(x.uploaded)} · {x.uploader}
                    </small>
                  </p>
                ))}
            </div>
          )}
          <h3>Document notes</h3>
          {data.notes
            .filter((n) => n.document === d.id)
            .map((n) => (
              <article className="employee-note" key={n.id}>
                <p>{n.text}</p>
                <small>
                  {n.author} · {formatDate(n.at)}
                </small>
              </article>
            ))}
          {!data.notes.some((n) => n.document === d.id) && (
            <p className="muted">No accessible notes for this document.</p>
          )}
          <div className="sample-watermark">DEMO — NOT A REAL CERTIFICATE</div>
        </aside>
      </div>
    </Drawer>
  );
}
function UploadForm({
  data,
  employee,
  previous,
  close,
  done,
}: {
  data: Data;
  employee?: Employee;
  previous?: Doc;
  close: () => void;
  done: () => Promise<void>;
}) {
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [results, setResults] = useState<Record<string, string>>({});
  const [error, setError] = useState("");
  const input = useRef<HTMLInputElement>(null);
  return (
    <Drawer
      title={previous ? "Replace document" : "Upload documents"}
      description="Fictional test files only. All uploads enter quarantine."
      onClose={close}
    >
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          if (!files.length) {
            setError("Choose at least one file");
            return;
          }
          const form = new FormData(e.currentTarget);
          setBusy(true);
          setError("");
          let failed = false;
          for (const file of files) {
            const key = file.name;
            setResults((r) => ({ ...r, [key]: "Uploading…" }));
            const f = new FormData();
            f.set("employee", String(form.get("employee")));
            f.set("category", String(form.get("category")));
            f.set(
              "fictional",
              form.get("fictional") === "on" ? "true" : "false",
            );
            f.set("file", file);
            for (const field of [
              "issueDate",
              "reviewDate",
              "expiryDate",
              "retentionDate",
            ])
              f.set(field, String(form.get(field) || ""));
            if (previous) f.set("previous", previous.id);
            try {
              await new Promise<void>((resolve, reject) => {
                const xhr = new XMLHttpRequest();
                xhr.open("POST", "/api/hr/documents");
                xhr.upload.onprogress = (event) => {
                  if (event.lengthComputable)
                    setResults((r) => ({
                      ...r,
                      [key]: `Uploading ${Math.round((event.loaded / event.total) * 100)}%`,
                    }));
                };
                xhr.onload = () => {
                  const result = JSON.parse(xhr.responseText);
                  if (xhr.status >= 200 && xhr.status < 300) {
                    setResults((r) => ({
                      ...r,
                      [key]: "Quarantined — awaiting scanner",
                    }));
                    resolve();
                  } else reject(new Error(result.error));
                };
                xhr.onerror = () =>
                  reject(new Error("Upload connection failed"));
                xhr.send(f);
              });
            } catch (err) {
              failed = true;
              setResults((r) => ({ ...r, [key]: (err as Error).message }));
            }
          }
          setBusy(false);
          if (!failed) await done();
        }}
      >
        <Field label="Employee">
          <select name="employee" defaultValue={employee?.id || ""} required>
            <option value="">Select an employee</option>
            {data.employees
              .filter((e) => !employee || e.id === employee.id)
              .map((e) => (
                <option key={e.id} value={e.id}>
                  {e.name} · {e.staffId}
                </option>
              ))}
          </select>
        </Field>
        <Field label="Category">
          <select
            name="category"
            defaultValue={previous?.category || "Training"}
          >
            {data.settings.documentTypes
              .map((t) => t.name)
              .filter(
                (c) =>
                  (!previous || previous.category === c) &&
                  (!sensitive(c, data.settings) || data.user.sensitive),
              )
              .map((c) => (
                <option key={c}>{c}</option>
              ))}
          </select>
        </Field>
        <div className="form-grid">
          <Field label="Issue date (optional)">
            <input type="date" name="issueDate" />
          </Field>
          <Field label="Organisational review date (optional)">
            <input type="date" name="reviewDate" />
          </Field>
          <Field label="Expiry date (not for DBS)">
            <input type="date" name="expiryDate" />
          </Field>
          <Field label="Retention review date (optional)">
            <input type="date" name="retentionDate" />
          </Field>
        </div>
        <div
          className="dropzone"
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            setFiles(
              Array.from(e.dataTransfer.files).slice(0, previous ? 1 : 20),
            );
          }}
        >
          <Upload size={30} />
          <strong>Drop your files here</strong>
          <span>PDF, JPG or PNG · up to 10 MB each</span>
          <button
            type="button"
            className="secondary-button"
            onClick={() => input.current?.click()}
          >
            Choose files
          </button>
          <input
            ref={input}
            type="file"
            aria-label="Choose upload files"
            multiple={!previous}
            accept=".pdf,.jpg,.jpeg,.png"
            hidden
            onChange={(e) => setFiles(Array.from(e.target.files || []))}
          />
        </div>
        {files.map((file) => (
          <div className="upload-result" key={file.name}>
            <FileText size={17} />
            <span>
              {file.name}
              <small>
                {results[file.name] || `${Math.ceil(file.size / 1024)} KB`}
              </small>
            </span>
          </div>
        ))}
        <label className="checkbox">
          <input type="checkbox" name="fictional" required />
          These are harmless fictional files, containing no real personal data.
        </label>
        <div className="warning">
          Scanner not configured. Uploaded evidence remains unavailable and
          unverified. Existing released versions remain accessible.
        </div>
        {error && <div className="error">{error}</div>}
        <div className="form-actions">
          <button type="button" className="secondary-button" onClick={close}>
            Cancel
          </button>
          <button className="primary" disabled={busy}>
            {busy ? "Uploading…" : "Upload to quarantine"}
          </button>
        </div>
      </form>
    </Drawer>
  );
}
function Imports({
  data,
  mutate,
  notify,
}: {
  data: Data;
  mutate: Mutate;
  notify: (s: string) => void;
}) {
  const [tab, setTab] = useState("CSV employees");
  const [rows, setRows] = useState<Record<string, string>[]>([]);
  const [fields, setFields] = useState<string[]>([]);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [batchId, setBatchId] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const batch =
    data.imports.find((i) => i.id === batchId) || data.imports.at(-1);
  const columns = [
    "staffId",
    "name",
    "branch",
    "job",
    "status",
    "start",
    "email",
  ];
  const admin = data.user.role === "Organisation Admin";
  return (
    <>
      <PageHeading
        title="Imports"
        subtitle="Prepare, validate and approve. Your source data stays untouched."
      />
      <section className="panel">
        <div className="tabs">
          {["CSV employees", "OneDrive preparation"].map((t) => (
            <button
              className={tab === t ? "active" : ""}
              key={t}
              onClick={() => setTab(t)}
            >
              {t}
            </button>
          ))}
        </div>
        {tab === "CSV employees" ? (
          <div className="padded">
            <div className="import-steps">
              <span className="active">1 Upload</span>
              <ChevronRight size={14} />
              <span className={rows.length ? "active" : ""}>2 Map columns</span>
              <ChevronRight size={14} />
              <span className={batch ? "active" : ""}>
                3 Validate & preview
              </span>
              <ChevronRight size={14} />
              <span className={batch?.state === "Imported" ? "active" : ""}>
                4 Approve & import
              </span>
            </div>
            <div className="info-banner">
              Employee imports never create login accounts or send invitations.
              Organisation Admin approval is required.
            </div>
            <Field label="Fictional employee CSV">
              <input
                type="file"
                accept=".csv"
                disabled={!admin || busy}
                onChange={async (e) => {
                  const file = e.target.files?.[0];
                  if (!file) return;
                  if (file.size > 500000) {
                    setError("CSV must be under 500 KB");
                    return;
                  }
                  const result = Papa.parse<Record<string, string>>(
                    await file.text(),
                    { header: true, skipEmptyLines: true },
                  );
                  if (result.errors.length) {
                    setError(result.errors[0].message);
                    return;
                  }
                  setRows(result.data);
                  setFields(result.meta.fields || []);
                  setMapping(
                    Object.fromEntries(
                      columns.map((c) => [
                        c,
                        result.meta.fields?.includes(c) ? c : "",
                      ]),
                    ),
                  );
                  setError("");
                }}
              />
            </Field>
            <p className="muted">
              Use branch IDs: {data.branches.map((b) => b.id).join(", ")}.
              Dates: YYYY-MM-DD. Maximum 500 rows.{" "}
              <a href="/sample-employees.csv" download>
                Download sample CSV
              </a>
            </p>
            {rows.length > 0 && (
              <>
                <h3>Map your columns</h3>
                <div className="mapping-grid">
                  {columns.map((c) => (
                    <Field label={c} key={c}>
                      <select
                        value={mapping[c] || ""}
                        onChange={(e) =>
                          setMapping({ ...mapping, [c]: e.target.value })
                        }
                      >
                        <option value="">
                          {c === "email" ? "Not included" : "Choose column"}
                        </option>
                        {fields.map((f) => (
                          <option key={f}>{f}</option>
                        ))}
                      </select>
                    </Field>
                  ))}
                </div>
                <button
                  className="primary"
                  disabled={busy}
                  onClick={async () => {
                    setBusy(true);
                    try {
                      const mapped = rows.map(
                        (row) =>
                          Object.fromEntries(
                            columns.map((c) => [c, row[mapping[c]] || ""]),
                          ) as ImportRow,
                      );
                      const result = await mutate({
                        action: "stage-import",
                        rows: mapped,
                      });
                      setBatchId(String(result.id));
                      notify("CSV staged. No live employee records changed.");
                    } catch (e) {
                      setError((e as Error).message);
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  Validate & preview {rows.length} rows
                </button>
              </>
            )}
            {error && (
              <div role="alert" className="error">
                {error}
              </div>
            )}
            {batch && (
              <div className="import-preview">
                <div className="panel-heading">
                  <div>
                    <h2>
                      {batch.state === "Imported"
                        ? "Import complete"
                        : "Staged import preview"}
                    </h2>
                    <p>
                      {batch.rows.length} rows ·{" "}
                      {batch.rows.filter((r) => r.error).length} errors ·{" "}
                      {batch.state}
                    </p>
                  </div>
                  <Badge>{batch.state}</Badge>
                </div>
                <div className="table-scroll">
                  <table>
                    <thead>
                      <tr>
                        <th>Staff ID</th>
                        <th>Name</th>
                        <th>Branch</th>
                        <th>Validation</th>
                      </tr>
                    </thead>
                    <tbody>
                      {batch.rows.map((r, i) => (
                        <tr key={i}>
                          <td>{r.staffId}</td>
                          <td>{r.name}</td>
                          <td>{r.branch}</td>
                          <td>
                            {r.error ? (
                              <span className="overdue-date">{r.error}</span>
                            ) : (
                              <Badge>Ready</Badge>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {batch.state === "Staged" && (
                  <form
                    onSubmit={async (e) => {
                      e.preventDefault();
                      setBusy(true);
                      try {
                        const result = await mutate({
                          action: "approve-import",
                          id: batch.id,
                        });
                        notify(
                          `${result.count} employee records imported. No invitations sent.`,
                        );
                      } catch (err) {
                        setError((err as Error).message);
                      } finally {
                        setBusy(false);
                      }
                    }}
                  >
                    <label className="checkbox">
                      <input type="checkbox" required />I approve these
                      fictional employee records and their branch assignments.
                    </label>
                    <button
                      className="primary"
                      disabled={
                        busy || batch.rows.some((r) => r.error) || !admin
                      }
                    >
                      Approve import
                    </button>
                    {batch.rows.some((r) => r.error) && (
                      <p className="muted">
                        Correct the CSV and upload again to resolve errors. This
                        staged batch does not affect employee records.
                      </p>
                    )}
                  </form>
                )}
                {batch.state === "Imported" && (
                  <p className="success-text">
                    {batch.count} records imported. Repeating approval is safe
                    and will not create duplicates.
                  </p>
                )}
              </div>
            )}
          </div>
        ) : (
          <div className="padded">
            <div className="connection-card">
              <div className="file-icon">
                <FolderOpen size={28} />
              </div>
              <div>
                <h2>OneDrive import preparation</h2>
                <p>Not connected · No source files have been accessed</p>
              </div>
              <Badge>Awaiting configuration</Badge>
            </div>
            <p>
              Future imports will use approved Microsoft Graph read access to a
              selected source. Folder names suggest matches; HR must confirm
              identity, branch and category. No source file will be changed.
            </p>
            <h3>Fictional sample preview</h3>
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Example source folder</th>
                    <th>Proposed match</th>
                    <th>Category</th>
                    <th>Review decision</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td>Liverpool / CSB-1001 / Training</td>
                    <td>Amelia Hart · Liverpool</td>
                    <td>Training</td>
                    <td>
                      <Badge>Needs approval</Badge>
                    </td>
                  </tr>
                  <tr>
                    <td>Unsorted / Amelia Hart</td>
                    <td>Two people share this name</td>
                    <td>Unknown</td>
                    <td>
                      <Badge>Manual review</Badge>
                    </td>
                  </tr>
                  <tr>
                    <td>Portsmouth / DBS scans</td>
                    <td>Not matched</td>
                    <td>DBS</td>
                    <td>
                      <Badge>Held for policy approval</Badge>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
            <div className="info-banner">
              <Lock size={19} />
              <span>
                Connection and migration are deferred. Required: tenant grant
                review, retention approval, matching sign-off, malware scanning
                and explicit import approval.
              </span>
            </div>
            <h3>Planned source provenance</h3>
            <p className="muted">
              Drive and item IDs · original path · version/checksum when
              available · per-item outcomes · resumable idempotent import.
              Notifications and invitations remain off.
            </p>
          </div>
        )}
      </section>
    </>
  );
}
function SettingsPage({
  data,
  mutate,
  notify,
}: {
  data: Data;
  mutate: Mutate;
  notify: (s: string) => void;
}) {
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [account, setAccount] = useState<User | null>(null);
  const admin = data.user.role === "Organisation Admin";
  return (
    <>
      <PageHeading
        title="Settings"
        subtitle="Explicit access. Clear policies. A controlled path to live data."
      />
      <div className="settings-grid">
        <section className="panel padded">
          <h2>Review & reminder policy</h2>
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              setBusy(true);
              const f = new FormData(e.currentTarget);
              try {
                await mutate({
                  action: "settings",
                  thresholds: String(f.get("thresholds"))
                    .split(",")
                    .map(Number),
                  dbsPolicy: f.get("dbsPolicy"),
                  retention: f.get("retention"),
                });
                notify("Organisation policies saved.");
              } catch (err) {
                setError((err as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            <Field label="Reminder thresholds (days before review)">
              <input
                name="thresholds"
                defaultValue={data.settings.thresholds.join(", ")}
                disabled={!admin}
              />
            </Field>
            <Field label="Organisational DBS review policy">
              <textarea
                name="dbsPolicy"
                rows={4}
                defaultValue={data.settings.dbsPolicy}
                disabled={!admin}
              />
            </Field>
            <Field label="Retention policy">
              <textarea
                name="retention"
                rows={4}
                defaultValue={data.settings.retention}
                disabled={!admin}
              />
            </Field>
            <p className="muted">
              Pilot defaults are organisational settings, not legal
              requirements. Employee-facing email remains off.
            </p>
            <button className="primary" disabled={!admin || busy}>
              Save policies
            </button>
          </form>
        </section>
        <section className="panel padded">
          <h2>Before going live</h2>
          {[
            ["Sign-in", "Uses your CSB platform sign-in"],
            [
              "Virus checking",
              "Not set up yet, so uploaded files stay locked",
            ],
            ["Emails", "Switched off. Nothing is sent outside the platform"],
            [
              "Automatic reminders",
              "Not scheduled yet. Use “Run reminder job” on Alerts",
            ],
            ["OneDrive import", "Not connected yet"],
          ].map(([name, state]) => (
            <div className="readiness-row" key={name}>
              <Lock size={16} />
              <div>
                <strong>{name}</strong>
                <small>{state}</small>
              </div>
            </div>
          ))}
          <div className="warning">
            This is a demo workspace. Do not enter real staff records until the
            go-live checks are complete.
          </div>
          <h3>Document categories</h3>
          <div className="category-chips">
            {data.settings.documentTypes
              .map((t) => t.name)
              .map((c) => (
                <span className="badge slate" key={c}>
                  {c}
                </span>
              ))}
          </div>
          <p className="muted">
            An administrator can manage categories and requirement applicability
            below.
          </p>
        </section>
      </div>
      <PolicyAdministration data={data} mutate={mutate} notify={notify} />
      <section className="panel">
        <div className="panel-heading">
          <div>
            <h2>Authorised accounts</h2>
            <p>Application access is separate from employee records.</p>
          </div>
          <span className="muted">New accounts can’t be invited from here yet</span>
        </div>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Account</th>
                <th>Role</th>
                <th>Assigned branches</th>
                <th>Status</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {data.users.map((u) => (
                <tr key={u.id}>
                  <td>
                    <span className="person-cell">
                      <Avatar name={u.name} />
                      {u.name}
                    </span>
                  </td>
                  <td>{u.role}</td>
                  <td>
                    {u.branches
                      .map((b) => data.branches.find((x) => x.id === b)?.name)
                      .join(", ")}
                  </td>
                  <td>
                    <Badge>{u.active ? "Active" : "Deactivated"}</Badge>
                  </td>
                  <td>
                    <button
                      className="text-btn"
                      disabled={!admin || u.id === data.user.id}
                      onClick={() => setAccount(u)}
                    >
                      Manage access
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      {error && <div className="error">{error}</div>}
      {account && (
        <Drawer
          title="Manage account access"
          description={account.name}
          onClose={() => setAccount(null)}
        >
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              setBusy(true);
              const f = new FormData(e.currentTarget);
              try {
                await mutate({
                  action: "account",
                  id: account.id,
                  role: f.get("role"),
                  branches: f.getAll("branch"),
                  sensitive: f.get("sensitive") === "on",
                  active: f.get("active") === "on",
                });
                notify("Account permissions updated.");
                setAccount(null);
              } catch (err) {
                setError((err as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            <Field label="Role">
              <select name="role" defaultValue={account.role}>
                {[
                  "Organisation Admin",
                  "Group HR",
                  "Branch HR",
                  "Branch Viewer",
                ].map((r) => (
                  <option key={r}>{r}</option>
                ))}
              </select>
            </Field>
            <h3>Assigned branches</h3>
            {data.branches.map((b) => (
              <label className="checkbox" key={b.id}>
                <input
                  type="checkbox"
                  name="branch"
                  value={b.id}
                  defaultChecked={account.branches.includes(b.id)}
                />
                {b.name}
              </label>
            ))}
            <label className="checkbox">
              <input
                type="checkbox"
                name="sensitive"
                defaultChecked={account.sensitive}
              />
              Sensitive document capability
            </label>
            <label className="checkbox">
              <input
                type="checkbox"
                name="active"
                defaultChecked={account.active}
              />
              Account active
            </label>
            <label className="checkbox warning">
              <input type="checkbox" required />I confirm these access changes.
            </label>
            {error && <div className="error">{error}</div>}
            <button className="primary" disabled={busy}>
              Save access
            </button>
          </form>
        </Drawer>
      )}
    </>
  );
}
function PolicyAdministration({
  data,
  mutate,
  notify,
}: {
  data: Data;
  mutate: Mutate;
  notify: (s: string) => void;
}) {
  const [selected, setSelected] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const admin = data.user.role === "Organisation Admin";
  const rule = data.settings.requirements.find((r) => r.id === selected);
  async function save(body: unknown, message: string) {
    setBusy(true);
    setError("");
    try {
      await mutate(body);
      notify(message);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <div className="settings-grid">
        <section className="panel padded">
          <h2>Requirements by role & branch</h2>
          <Field label="Requirement">
            <select
              value={selected}
              onChange={(e) => setSelected(e.target.value)}
            >
              <option value="">Add a requirement</option>
              {data.settings.requirements.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </select>
          </Field>
          <form
            key={selected}
            onSubmit={(e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              save(
                {
                  action: "requirement",
                  rule: {
                    id: selected,
                    name: f.get("name"),
                    category: f.get("category"),
                    job: f.get("job"),
                    branch: f.get("branch"),
                    recurring: f.get("recurring") === "on",
                    enabled: f.get("enabled") === "on",
                  },
                },
                "Requirement saved. Applicable employee checks recalculated.",
              );
            }}
          >
            <Field label="Requirement name">
              <input
                name="name"
                required
                defaultValue={rule?.name}
                disabled={!admin}
              />
            </Field>
            <Field label="Evidence category">
              <select
                name="category"
                defaultValue={rule?.category || "Training"}
                disabled={!admin}
              >
                {data.settings.documentTypes.map((t) => (
                  <option key={t.name}>{t.name}</option>
                ))}
              </select>
            </Field>
            <div className="form-grid">
              <Field label="Job role">
                <select
                  name="job"
                  defaultValue={rule?.job || ""}
                  disabled={!admin}
                >
                  <option value="">All job roles</option>
                  {[...new Set(data.employees.map((e) => e.job))].map((j) => (
                    <option key={j}>{j}</option>
                  ))}
                </select>
              </Field>
              <Field label="Applicable branch">
                <select
                  name="branch"
                  defaultValue={rule?.branch || ""}
                  disabled={!admin}
                >
                  <option value="">All branches</option>
                  {data.branches.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name}
                    </option>
                  ))}
                </select>
              </Field>
            </div>
            <label className="checkbox">
              <input
                name="recurring"
                type="checkbox"
                defaultChecked={rule?.recurring ?? true}
                disabled={!admin}
              />
              Recurring review date required
            </label>
            <label className="checkbox">
              <input
                name="enabled"
                type="checkbox"
                defaultChecked={rule?.enabled ?? true}
                disabled={!admin}
              />
              Requirement enabled
            </label>
            <label className="checkbox warning">
              <input type="checkbox" required disabled={!admin} />I approve
              applying this policy to matching employee records.
            </label>
            <button className="primary" disabled={!admin || busy}>
              Save requirement
            </button>
          </form>
        </section>
        <section className="panel padded">
          <h2>Document category access</h2>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              save(
                {
                  action: "category",
                  name: f.get("name"),
                  sensitive: f.get("sensitive") === "on",
                },
                "Document category saved.",
              );
            }}
          >
            <Field label="Category name">
              <input
                name="name"
                list="category-names"
                required
                disabled={!admin}
              />
            </Field>
            <datalist id="category-names">
              {data.settings.documentTypes.map((t) => (
                <option key={t.name}>{t.name}</option>
              ))}
            </datalist>
            <label className="checkbox">
              <input
                type="checkbox"
                name="sensitive"
                defaultChecked
                disabled={!admin}
              />
              Requires sensitive-document capability
            </label>
            <p className="muted">
              Use an existing category name to update access. DBS, identity and
              right-to-work categories always remain sensitive.
            </p>
            <button className="secondary-button full" disabled={!admin || busy}>
              Save category
            </button>
          </form>
          <hr />
          <h2>Add a branch</h2>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              save(
                { action: "branch", name: f.get("name") },
                "Branch added. Group HR and administrators have been assigned.",
              );
            }}
          >
            <Field label="New branch name">
              <input name="name" required disabled={!admin} />
            </Field>
            <p className="muted">
              Group HR and organisation administrators receive access. Assign
              branch users separately.
            </p>
            <button className="secondary-button full" disabled={!admin || busy}>
              Create branch
            </button>
          </form>
        </section>
      </div>
      {error && (
        <div className="error" role="alert">
          {error}
        </div>
      )}
    </>
  );
}

function CommandPalette({
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
