"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { usePathname } from "next/navigation";
import Link from "@/components/link";
import {
  ArrowsInSimple, ArrowsOutSimple, CalendarPlus, CaretRight, ClipboardText, FileArrowUp, Minus, PaperPlaneRight, Paperclip, Sparkle, UserPlus, X,
} from "@phosphor-icons/react";
import { askCsbCoordinator, coordinatorUploadTargets, uploadToCoordinator } from "@/app/csb-coordinator-chat-actions";

type Message = { role: "user" | "assistant"; content: string; links?: { label: string; href: string }[]; notice?: string | null; choices?: UploadChoice[] };
/** Where an attached document can go, offered as buttons in the conversation. */
type UploadChoice = { key: string; label: string; target: "intake" | "new"; intakeId: string | null; serviceUserId: string | null };

const ACCEPT = "application/pdf,.pdf,.doc,.docx,image/png,image/jpeg";

/** Which existing screens this employee may open; worked out on the server from their permissions. */
export interface CoordinatorAccess {
  intake: boolean;
  createServiceUser: boolean;
  carePlans: boolean;
  buildRota: boolean;
}

const WELCOME =
  "Hello! I'm your AI CSB Coordinator.\n\nI can help you with support plans, service-user setup, care plans, rotas, risk assessments and day-to-day care coordination.";
const initial: Message = { role: "assistant", content: WELCOME };

const ID = /^[a-zA-Z0-9]{10,40}$/;

/** The record the current page is about, read from its address. The server re-checks access before using it. */
export function pageContext(path: string | null): { intakeId: string | null; serviceUserId: string | null } {
  const intake = path?.match(/^\/rota\/coordinator\/([^/?#]+)/)?.[1];
  const su = path?.match(/^\/rota\/(?:service-users|care-plans)\/([^/?#]+)/)?.[1];
  return { intakeId: intake && ID.test(intake) ? intake : null, serviceUserId: su && ID.test(su) ? su : null };
}

/** The four suggested actions. Each opens the existing CRM screen for that job; none acts from the chat. */
export function suggestedActions(access: CoordinatorAccess, path: string | null) {
  const { intakeId, serviceUserId } = pageContext(path);
  const su = serviceUserId ? encodeURIComponent(serviceUserId) : null;
  return [
    access.intake && { key: "support-plan", title: "Process Support Plan", subtitle: "Upload and extract key information", href: intakeId ? `/rota/coordinator/${encodeURIComponent(intakeId)}` : "/rota/coordinator", icon: FileArrowUp },
    access.createServiceUser && { key: "service-user", title: "Create Service User", subtitle: "Set up a new service user record", href: "/rota/service-users/new", icon: UserPlus },
    access.carePlans && { key: "care-plan", title: "Prepare Care Plan", subtitle: su ? "Generate a draft care plan from documents" : "Choose the person, then draft their plan", href: su ? `/rota/care-plans/${su}` : "/rota/care-plans", icon: ClipboardText },
    access.buildRota && { key: "rota", title: "Build Rota", subtitle: "Create or update a rota for a service user", href: su ? `/rota/service-users/${su}?tab=rota` : "/rota/build", icon: CalendarPlus },
  ].filter((a): a is Exclude<typeof a, false> => Boolean(a));
}

/**
 * The one AI CSB Coordinator: a launcher fixed to the bottom right of every CRM page this employee may use, which opens
 * a chat panel over the page. It is a fixed layer, so the page underneath never moves or resizes. Minimise keeps the
 * conversation; close clears it. Escape minimises, and focus returns to the launcher.
 */
export function AiCsbCoordinatorLauncher({ access, aiOn = false }: { access: CoordinatorAccess; aiOn?: boolean }) {
  const pathname = usePathname();
  const { intakeId, serviceUserId } = pageContext(pathname);
  const actions = suggestedActions(access, pathname);
  const [open, setOpen] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [messages, setMessages] = useState<Message[]>([initial]);
  const [query, setQuery] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scrollBottom = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const launcher = useRef<HTMLButtonElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const [pending, setPending] = useState<File[]>([]);
  const [busyLabel, setBusyLabel] = useState("Searching your CRM records…");

  useEffect(() => { if (open) input.current?.focus(); }, [open]);
  useEffect(() => { if (open && messages.length > 1) scrollBottom.current?.scrollIntoView({ behavior: "smooth", block: "nearest" }); }, [messages, open, sending]);

  const hide = useCallback((clear: boolean) => {
    setOpen(false);
    setExpanded(false);
    if (clear) {
      setMessages([initial]);
      setPending([]);
      setQuery("");
      setError(null);
    }
    requestAnimationFrame(() => launcher.current?.focus());
  }, []);

  async function ask(q: string, opts: { intakeId?: string; attached?: string[]; hidden?: boolean } = {}) {
    const text = q.trim();
    if (text.length < 2 || (sending && !opts.hidden)) return;
    const history = messages.slice(1).filter((m) => !m.choices).slice(-8).map((m) => ({ role: m.role, content: m.content.slice(0, 4000) }));
    if (!opts.hidden) setMessages((m) => [...m, { role: "user", content: text }]);
    setQuery("");
    setSending(true);
    setBusyLabel(aiOn ? "AI CSB Coordinator is working on it…" : "Searching your CRM records…");
    setError(null);
    try {
      const r = await askCsbCoordinator({ question: text, intakeId: opts.intakeId ?? intakeId, path: opts.intakeId ? `/rota/coordinator/${opts.intakeId}` : (pathname ?? undefined), history, attached: opts.attached });
      setMessages((m) => [...m, { role: "assistant", content: r.answer, links: r.links, notice: r.notice }]);
    } catch {
      setError("The assistant couldn't answer just now. Nothing was changed in the CRM. Try again, or open the screen you need from the actions above.");
    } finally {
      setSending(false);
    }
  }

  /** The paperclip: choose files, then choose (or confirm) the intake they belong to. */
  async function onFiles(list: FileList | null) {
    const files = Array.from(list ?? []).slice(0, 3);
    if (fileInput.current) fileInput.current.value = "";
    if (!files.length || sending) return;
    setError(null);
    setPending(files);
    const t = await coordinatorUploadTargets(pathname ?? null);
    if (!t.ok) {
      setPending([]);
      setError(t.error);
      return;
    }
    const choices: UploadChoice[] = [
      ...(t.data.current ? [{ key: `i-${t.data.current.id}`, label: `Add to ${t.data.current.reference} (open on this page)`, target: "intake" as const, intakeId: t.data.current.id, serviceUserId: null }] : []),
      { key: "new", label: t.data.serviceUser ? `Start a new intake for ${t.data.serviceUser.name}` : "Start a new intake (new person)", target: "new", intakeId: null, serviceUserId: t.data.serviceUser?.id ?? null },
      ...t.data.recent.map((r) => ({ key: `i-${r.id}`, label: `Add to ${r.reference} ${r.title}`, target: "intake" as const, intakeId: r.id, serviceUserId: null })),
    ];
    const names = files.map((f) => f.name).join(", ");
    setMessages((m) => [...m, { role: "user", content: `📎 ${names}` }, { role: "assistant", content: "Where should this go? Choose the care intake, or start a new one. Nothing is approved or added to anyone's record from here.", choices }]);
  }

  async function attach(choice: UploadChoice) {
    const files = pending;
    if (!files.length || sending) return;
    setPending([]);
    setMessages((m) => m.map((x) => (x.choices ? { ...x, choices: undefined, content: `${x.content}\n\nChosen: ${choice.label}.` } : x)));
    setSending(true);
    setBusyLabel("Uploading securely and reading the document…");
    setError(null);
    const fd = new FormData();
    for (const f of files) fd.append("files", f);
    fd.set("target", choice.target);
    if (choice.intakeId) fd.set("intakeId", choice.intakeId);
    if (choice.serviceUserId) fd.set("serviceUserId", choice.serviceUserId);
    const r = await uploadToCoordinator(fd).catch(() => ({ ok: false as const, error: "The document could not be attached just now. Nothing was saved." }));
    setSending(false);
    if (!r.ok) {
      setError(r.error);
      return;
    }
    const d = r.data;
    const review = { label: `Open the full review (${d.reference})`, href: d.href };
    const head = d.alreadyOnIntake
      ? `This document is already on ${d.reference}, so I haven't started another intake or read it again.`
      : [`${d.created ? `Started ${d.reference} and attached` : `Attached to ${d.reference}:`} ${d.added.join(", ") || "nothing new"}.`, d.duplicates.length ? `Already on this intake, so not added or read again: ${d.duplicates.join(", ")}.` : "", d.failed.length ? `Could not be read just now: ${d.failed.map((f) => `${f.name} (${f.error})`).join("; ")}. Press Read again on the intake, or add the facts by hand.` : ""].filter(Boolean).join(" ");
    if (aiOn && d.added.length && !d.failed.length) {
      setMessages((m) => [...m, { role: "assistant", content: `${head}\n\nNow checking what was extracted…`, links: [review] }]);
      await ask("I've uploaded this council support plan. Please process everything and prepare the service user, care plan, risks, care package and rota for review.", { intakeId: d.intakeId, attached: d.added, hidden: true });
    } else {
      setMessages((m) => [...m, { role: "assistant", content: `${head}\n\n${d.summary}`, links: [review] }]);
    }
  }
  function submit(e: FormEvent) {
    e.preventDefault();
    void ask(query);
  }
  /** On a phone the panel covers the page, so it steps aside when an action opens another screen. */
  function afterAction() {
    if (window.matchMedia("(max-width: 639px)").matches) hide(false);
  }

  const canAttach = access.intake;
  const context = intakeId ? "Using the care intake open on this page" : serviceUserId ? "Using the service user open on this page" : null;

  return (
    <>
      {open ? (
        <section
          role="dialog"
          aria-modal="false"
          aria-labelledby="ai-csb-title"
          data-testid="ai-coordinator-panel"
          data-expanded={expanded ? "true" : "false"}
          onKeyDown={(e) => { if (e.key === "Escape") { e.stopPropagation(); hide(false); } }}
          className={`ai-csb-panel fixed z-[80] flex flex-col overflow-hidden bg-white ${expanded ? "ai-csb-panel-expanded" : ""}`}
        >
          <header className="flex items-center gap-2.5 border-b border-[#e6edf0] pb-3.5 pl-4 pr-2.5 pt-4">
            <span aria-hidden="true" className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[12px] bg-[#0b6b74] text-white shadow-[0_4px_12px_rgba(11,107,116,.28)]"><Sparkle size={24} weight="fill" /></span>
            <span className="min-w-0 flex-1 pr-1">
              <strong id="ai-csb-title" className="block whitespace-nowrap text-[16px] font-semibold leading-[21px] text-[#13303b]">AI CSB Coordinator</strong>
              <span className="block truncate text-[12px] leading-[17px] text-[#5d717c]">Your AI care coordination assistant</span>
            </span>
            <button type="button" onClick={() => setExpanded((x) => !x)} aria-label={expanded ? "Make the panel smaller" : "Expand the panel"} aria-pressed={expanded} title={expanded ? "Smaller" : "Expand"} data-testid="ai-expand" className="ai-csb-icon-btn hidden sm:flex">
              {expanded ? <ArrowsInSimple size={18} aria-hidden="true" /> : <ArrowsOutSimple size={18} aria-hidden="true" />}
            </button>
            <button type="button" onClick={() => hide(false)} aria-label="Minimise AI CSB Coordinator" title="Minimise (keeps the conversation)" data-testid="ai-minimise" className="ai-csb-icon-btn"><Minus size={18} aria-hidden="true" /></button>
            <button type="button" onClick={() => hide(true)} aria-label="Close AI CSB Coordinator" title="Close (clears the conversation)" data-testid="ai-close" className="ai-csb-icon-btn"><X size={18} aria-hidden="true" /></button>
          </header>
          <div className="flex items-center gap-2 border-b border-[#eef2f4] bg-[#fbfcfd] px-5 py-2 text-[12px]" data-testid="ai-status">
            <span aria-hidden="true" className="h-2 w-2 rounded-full bg-[#16a34a] shadow-[0_0_0_3px_rgba(22,163,74,.15)]" />
            <span className="whitespace-nowrap font-medium text-[#15803d]">Online</span>
            <span className="min-w-0 truncate text-[#5d717c]">{aiOn ? "· Claude AI, using your CRM records" : "· Answers from your CRM records only"}</span>
          </div>
          {context ? <p className="border-b border-[#e3eff0] bg-[#f2f9f9] px-5 py-1.5 text-[12px] font-medium text-[#0b6b74]" data-testid="ai-context">{context}</p> : null}

          <div role="log" aria-label="Conversation with AI CSB Coordinator" aria-live="polite" className="min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain px-5 py-5">
            {messages.map((m, i) => (
              <div key={i} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
                {m.role === "assistant" ? <span aria-hidden="true" className="mr-2 mt-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-[8px] bg-[#e3f1f1] text-[#0b6b74]"><Sparkle size={15} weight="fill" /></span> : null}
                <div className={`max-w-[86%] whitespace-pre-wrap px-4 py-3 text-[13.5px] leading-[21px] ${m.role === "user" ? "rounded-[18px] rounded-br-[6px] bg-[#0b6b74] text-white" : "rounded-[18px] rounded-tl-[6px] bg-[#eff4f8] text-[#22404d]"}`}>
                  <span className="sr-only">{m.role === "user" ? "You: " : "AI CSB Coordinator: "}</span>{m.content}
                  {m.notice ? <span className="mt-2 block whitespace-normal rounded-[10px] border border-amber-200 bg-amber-50 px-2.5 py-1.5 text-[12px] leading-[17px] text-amber-900" data-testid="ai-notice">{m.notice}</span> : null}
                  {m.choices?.length ? (
                    <span className="mt-2.5 flex flex-col gap-1.5 whitespace-normal" data-testid="ai-upload-choices">
                      {m.choices.map((c) => (
                        <button key={c.key} type="button" onClick={() => void attach(c)} disabled={sending} className="rounded-[10px] border border-[#b9d8da] bg-white px-3 py-2 text-left text-[12.5px] font-semibold text-[#0b6b74] hover:bg-[#e3f1f1] disabled:opacity-50">{c.label}</button>
                      ))}
                      <button type="button" onClick={() => { setPending([]); setMessages((all) => all.map((x) => (x.choices ? { ...x, choices: undefined, content: `${x.content}\n\nCancelled. Nothing was uploaded.` } : x))); }} className="self-start px-1 text-[12px] text-[#5d717c] underline">Cancel</button>
                    </span>
                  ) : null}
                  {m.links?.length ? (
                    <span className="mt-2.5 flex flex-wrap gap-1.5 whitespace-normal">
                      {m.links.map((l) => (
                        <Link key={l.href + l.label} href={l.href} onClick={afterAction} className="inline-flex items-center gap-1 rounded-full border border-[#b9d8da] bg-white px-2.5 py-1 text-[12px] font-semibold text-[#0b6b74] no-underline hover:bg-[#e3f1f1]">
                          {l.label}<CaretRight size={12} weight="bold" aria-hidden="true" />
                        </Link>
                      ))}
                    </span>
                  ) : null}
                </div>
              </div>
            ))}
            {messages.length === 1 && actions.length ? (
              <nav aria-label="Suggested actions" data-testid="ai-suggested-actions">
                <p className="mb-2.5 text-[13px] font-semibold text-[#13303b]">Try one of these:</p>
                <ul className="space-y-2">
                  {actions.map((a) => (
                    <li key={a.key}>
                      <Link href={a.href} onClick={afterAction} data-testid={`ai-action-${a.key}`} className="ai-csb-action group">
                        <span aria-hidden="true" className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[10px] border-[1.5px] border-[#a9d3d4] bg-white text-[#0b6b74]"><a.icon size={21} /></span>
                        <span className="min-w-0 flex-1">
                          <span className="block text-[13.5px] font-semibold leading-[18px] text-[#13303b]">{a.title}</span>
                          <span className="block text-[12px] leading-[16px] text-[#5d717c]">{a.subtitle}</span>
                        </span>
                        <CaretRight size={15} aria-hidden="true" className="shrink-0 text-[#8aa1ab] group-hover:text-[#0b6b74]" />
                      </Link>
                    </li>
                  ))}
                </ul>
                <p className="mt-2.5 text-[11.5px] leading-[16px] text-[#6b7f89]">{aiOn ? "Each action opens the CRM screen for that job. I can prepare drafts for review, but nothing is approved or published from the chat." : "Each action opens the CRM screen for that job. Nothing is created, approved or published from the chat."}</p>
              </nav>
            ) : null}
            {sending ? (
              <div role="status" className="flex items-center gap-2 pl-9 text-[12.5px] text-[#5d717c]">
                <span aria-hidden="true" className="flex gap-1"><span className="ai-csb-dot" /><span className="ai-csb-dot [animation-delay:120ms]" /><span className="ai-csb-dot [animation-delay:240ms]" /></span>
                {busyLabel}
              </div>
            ) : null}
            {error ? <div role="alert" className="rounded-[12px] border border-rose-200 bg-rose-50 px-3.5 py-3 text-[12.5px] text-rose-800">{error}</div> : null}
            <div ref={scrollBottom} />
          </div>

          <form onSubmit={submit} className="ai-csb-input border-t border-[#e6edf0] bg-white px-4 pt-3">
            <div className="flex items-end gap-2 rounded-[16px] border border-[#d8e3e7] bg-[#f8fafb] py-1.5 pl-1.5 pr-1.5 focus-within:border-[#0b6b74] focus-within:bg-white focus-within:shadow-[0_0_0_3px_rgba(11,107,116,.12)]">
              {canAttach ? (
                <>
                  <input ref={fileInput} type="file" accept={ACCEPT} multiple className="sr-only" tabIndex={-1} aria-hidden="true" data-testid="ai-attach-input" onChange={(e) => void onFiles(e.target.files)} />
                  <button type="button" onClick={() => fileInput.current?.click()} disabled={sending} aria-label="Attach a support plan or referral document" title="Attach a support plan or referral document (PDF, up to 4 MB)" data-testid="ai-attach" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] text-[#4b6470] hover:bg-[#e3f1f1] hover:text-[#0b6b74] disabled:opacity-40">
                    <Paperclip size={20} aria-hidden="true" />
                  </button>
                </>
              ) : null}
              <label htmlFor="ai-csb-input" className="sr-only">Message AI CSB Coordinator</label>
              <textarea
                id="ai-csb-input"
                ref={input}
                rows={1}
                maxLength={2000}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); void ask(query); } }}
                placeholder="Ask AI CSB Coordinator anything..."
                className={`max-h-32 min-h-[36px] min-w-0 flex-1 resize-none bg-transparent ${query ? "" : "overflow-hidden whitespace-nowrap"} px-1.5 py-[7px] text-[14px] leading-[22px] text-[#13303b] outline-none placeholder:text-[#7c8f99]`}
              />
              <button type="submit" aria-label="Send message" data-testid="ai-send" disabled={sending || query.trim().length < 2} className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] bg-[#0b6b74] text-white hover:bg-[#08545b] disabled:opacity-40">
                <PaperPlaneRight size={18} weight="fill" aria-hidden="true" />
              </button>
            </div>
            <p className="px-1 pb-3 pt-1.5 text-[11px] text-[#6b7f89]">Enter to send, Shift+Enter for a new line. A person approves every change.</p>
          </form>
        </section>
      ) : (
        <button
          ref={launcher}
          type="button"
          onClick={() => setOpen(true)}
          aria-haspopup="dialog"
          data-testid="ai-launcher-button"
          className="ai-csb-launcher fixed z-[80] flex items-center gap-2 rounded-full bg-[#0a4f57] py-3 pl-3.5 pr-4 text-[14px] font-semibold text-white shadow-[0_10px_30px_rgba(7,61,69,.32)] transition hover:-translate-y-0.5 hover:bg-[#073f46] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0a4f57]"
        >
          <Sparkle size={20} weight="fill" aria-hidden="true" />
          AI CSB Coordinator
        </button>
      )}
    </>
  );
}
