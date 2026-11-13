"use client";

import { useMemo,useRef,useState,type FormEvent } from "react";
import Link from "@/components/link";
import { ModuleHeader } from "@/components/module-header-band";
import { ArrowRight, ArrowUp, CheckCircle, ChatCenteredDots, FileText, FolderOpen, LockKey, Plus, Sparkle, WarningCircle } from "@phosphor-icons/react";
import { askCsbCoordinator } from "@/app/csb-coordinator-chat-actions";

type Case={id:string;reference:string;title:string;status:string;documents:number;open:number;total:number;person:string|null};
type Msg={role:"user"|"assistant";content:string};
const prompts=[
  {title:"What needs attention?",text:"Review this intake and explain which facts, source discrepancies or actions need a coordinator's attention."},
  {title:"Prepare my next steps",text:"Give me a practical, prioritised checklist to get this intake ready to confirm and set up."},
  {title:"Review rota readiness",text:"What still needs checking before this intake can safely generate a rota? Distinguish confirmed facts from missing information."},
  {title:"Summarise source findings",text:"Summarise the verified facts from this intake and identify anything historical, unverified or conflicting."},
];
const opening:Msg={role:"assistant",content:"Welcome to AI CSB Coordinator. Select a case to work with its actual documents and review status, or ask me about your care-coordination workflow. I can guide you through the next steps and take you directly to the right CRM screen."};
export function CsbCoordinatorWorkspace({cases,initialId,aiEnabled}:{cases:Case[];initialId:string|null;aiEnabled:boolean}){
  const [selected,setSelected]=useState<string|null>(cases.some(c=>c.id===initialId)?initialId:null);
  const [messages,setMessages]=useState<Msg[]>([opening]);
  const [question,setQuestion]=useState("");
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState<string|null>(null);
  const end=useRef<HTMLDivElement>(null);
  const current=useMemo(()=>cases.find(c=>c.id===selected)||null,[selected,cases]);
  const caseUrl=current?`/rota/coordinator/${current.id}`:null;
  // No manager approval since 7 Nov 2026: an intake in review with nothing left to check is ready to confirm.
  const ready=cases.filter(c=>["DRAFT","SUBMITTED","APPROVED"].includes(c.status)&&c.open===0).length;
  const saving=cases.filter(c=>c.status==="APPLYING").length;
  const totalOpen=cases.reduce((n,c)=>n+c.open,0);
  function chooseCase(id:string|null){
    setSelected(id);setMessages([opening]);setError(null);
  }
  async function send(value:string){
    const q=value.trim();
    if(!q||busy)return;
    const previous=messages.filter(m=>m!==opening).slice(-8);
    setMessages(m=>[...m,{role:"user",content:q}]);setQuestion("");setBusy(true);setError(null);
    try{
      const res=await askCsbCoordinator({question:q,intakeId:selected,history:previous});
      setMessages(m=>[...m,{role:"assistant",content:res.answer}]);
      requestAnimationFrame(()=>end.current?.scrollIntoView({behavior:"smooth",block:"end"}));
    }catch{
      setError("I couldn't retrieve a reliable answer. The case has not been changed. Please try again.");
    }finally{setBusy(false)}
  }
  function onSubmit(e:FormEvent<HTMLFormElement>){e.preventDefault();void send(question);}
  return <div className="space-y-5">
    <ModuleHeader title="AI CSB Coordinator" description="Your connected workspace for support plans, service-user setup, care documentation and rota preparation." actions={<Link href="/rota/coordinator" className="mh-btn mh-btn-primary"><Plus size={16} weight="bold"/> New intake</Link>} />
    <div className="panel">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {[
          {n:ready,label:"Ready to confirm",icon:<CheckCircle size={17}/>},
          {n:saving,label:"Being saved",icon:<LockKey size={17}/>},
          {n:totalOpen,label:"Facts to review",icon:<FileText size={17}/>},
        ].map(x=><div key={x.label} className="rounded-xl border border-rule bg-page p-3"><div className="mb-2 flex items-center gap-2 text-[#557284]">{x.icon}<span className="text-xs">{x.label}</span></div><div className="text-2xl font-semibold tracking-tight text-[#18384b]">{x.n}</div></div>)}
      </div>
    </div>
    <div className="grid min-h-[655px] gap-4 xl:grid-cols-[330px_minmax(0,1fr)]">
      <aside className="flex min-h-[620px] flex-col rounded-[22px] border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-100 px-5 py-4"><div className="flex items-center justify-between"><h2 className="font-semibold text-slate-900">Your active cases</h2><span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600">{cases.length}</span></div><p className="mt-1 text-xs text-slate-500">Choose a case to give the assistant context.</p></div>
        <div className="max-h-[440px] flex-1 space-y-2 overflow-y-auto p-3">
          <button type="button" onClick={()=>chooseCase(null)} className={`flex w-full items-center gap-3 rounded-xl border p-3 text-left transition ${!selected?"border-[#8dc9c9] bg-[#eaf8f6]":"border-transparent hover:bg-slate-50"}`}>
            <div className="rounded-lg bg-white p-2 text-[#176d78]"><ChatCenteredDots size={21}/></div>
            <div><div className="text-sm font-semibold text-[#17364b]">General assistant</div><div className="text-xs text-slate-500">Ask about care coordination</div></div>
          </button>
          {cases.map(c=><button type="button" key={c.id} onClick={()=>chooseCase(c.id)} className={`w-full rounded-xl border p-3 text-left transition ${selected===c.id?"border-[#8dc9c9] bg-[#eaf8f6]":"border-transparent hover:border-slate-100 hover:bg-slate-50"}`}>
            <div className="mb-1.5 flex items-center justify-between gap-2"><span className="text-xs font-semibold tracking-wide text-[#176d78]">{c.reference}</span><span className="text-[11px] text-slate-500">{c.documents} docs</span></div>
            <div className="line-clamp-2 text-sm font-semibold text-slate-800">{c.title}</div>
            <div className="mt-1 line-clamp-1 text-xs text-slate-500">{c.person||"New service-user intake"}</div>
            <div className="mt-3 flex items-center justify-between gap-2"><span className="rounded-full bg-white px-2 py-1 text-[11px] text-slate-600">{c.status.toLowerCase().replace(/_/g," ")}</span><span className="text-[11px] text-amber-700">{c.open?c.open+" to review":"No open facts"}</span></div>
          </button>)}
          {!cases.length?<p className="rounded-xl bg-slate-50 p-4 text-sm text-slate-500">No cases yet. Start with a council support plan or referral.</p>:null}
        </div>
        <div className="mt-auto border-t border-slate-100 p-4"><Link href="/rota/coordinator" className="flex items-center justify-between rounded-xl bg-[#f3f8f8] px-3 py-3 text-sm font-semibold text-[#176d78]"><span className="flex items-center gap-2"><FolderOpen size={18}/> Open intake workspace</span><ArrowRight size={16}/></Link></div>
      </aside>
      <section className="flex min-h-[655px] min-w-0 flex-col overflow-hidden rounded-[22px] border border-slate-200 bg-white shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 bg-white px-5 py-4">
          <div className="flex items-center gap-3"><div className="relative rounded-xl bg-[#e9f5f4] p-2.5 text-[#176d78]"><Sparkle size={22} weight="fill"/><span className="absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full border-2 border-white bg-emerald-500"/></div><div><h2 className="text-[15px] font-semibold text-slate-900">AI CSB Coordinator</h2><p className="text-xs text-slate-500">{current?`Working with ${current.reference}`:"Connected to care operations"}</p></div></div>
          {caseUrl?<Link href={caseUrl} className="inline-flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-xs font-semibold text-[#176d78] hover:bg-slate-50">Open case <ArrowRight size={14}/></Link>:null}
        </div>
        {current?<div className="border-b border-[#e0eeee] bg-[#f5fbfa] px-5 py-3"><div className="flex flex-wrap items-center justify-between gap-2"><div><div className="text-xs font-semibold text-[#1a6c73]">CASE IN CONTEXT</div><div className="mt-0.5 text-sm font-medium text-[#17364b]">{current.title}</div></div><div className="text-xs text-[#58747f]">{current.open} open facts · {current.documents} source documents</div></div></div>:null}
        <div role="log" aria-label="AI CSB Coordinator conversation" aria-live="polite" className="min-h-[250px] flex-1 space-y-5 overflow-y-auto bg-gradient-to-b from-white to-[#fbfcfd] px-5 py-6 sm:px-7">
          {messages.map((m,i)=><div key={i} className={`flex gap-3 ${m.role==="user"?"justify-end":""}`}>
            {m.role==="assistant"?<div className="mt-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-[#e9f5f4] text-[#176d78]"><Sparkle size={17}/></div>:null}
            <div className={`max-w-[88%] whitespace-pre-wrap rounded-2xl px-4 py-3 text-[14px] leading-6 ${m.role==="assistant"?"rounded-tl-md bg-[#f2f6f7] text-[#284457]":"rounded-tr-md bg-[#176d78] text-white"}`}>{m.content}</div>
          </div>)}
          {busy?<div className="flex items-center gap-3 text-sm text-slate-500"><Sparkle className="animate-pulse text-[#176d78]" size={21}/> Reviewing the available context…</div>:null}
          {error?<div role="alert" className="flex gap-2 rounded-xl bg-rose-50 p-3 text-sm text-rose-700"><WarningCircle size={17}/>{error}</div>:null}
          <div ref={end}/>
        </div>
        {messages.length<=2?<div className="grid gap-2 px-5 pb-3 sm:grid-cols-2 sm:px-7">{prompts.map(p=><button key={p.title} type="button" onClick={()=>void send(p.text)} disabled={busy} className="group rounded-xl border border-[#dfe9ec] bg-white px-3.5 py-3 text-left transition hover:border-[#9dc9c7] hover:bg-[#f6fbfa]"><span className="flex items-center justify-between text-sm font-semibold text-[#245267]">{p.title}<ArrowRight size={15} className="text-slate-400 transition group-hover:translate-x-0.5"/></span></button>)}</div>:null}
        <div className="border-t border-slate-100 bg-white px-5 py-4 sm:px-7">
          <form onSubmit={onSubmit} className="flex items-end gap-3 rounded-2xl border border-[#dce4e8] bg-[#fafcfd] p-2 shadow-sm focus-within:border-[#8bbebc] focus-within:ring-2 focus-within:ring-[#e5f4f2]">
            <textarea rows={2} maxLength={2000} aria-label="Ask AI CSB Coordinator" value={question} onChange={e=>setQuestion(e.target.value)} onKeyDown={e=>{if(e.key==="Enter"&&!e.shiftKey){e.preventDefault();void send(question)}}}
              placeholder={current?"Ask about this case, its documents, or the next step…":"Ask AI CSB Coordinator anything about your workflow…"}
              className="min-h-[55px] max-h-36 flex-1 resize-y bg-transparent px-3 py-2 text-sm text-slate-800 outline-none placeholder:text-slate-400"/>
            <button disabled={busy||!question.trim()} aria-label="Send message" className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#176d78] text-white transition hover:bg-[#11535d] disabled:opacity-40"><ArrowUp size={21} weight="bold"/></button>
          </form>
          <div className="mt-2 flex items-center justify-between gap-2 text-[11px] text-slate-500"><span className="flex items-center gap-1.5"><LockKey size={13}/> Organisation-scoped · Human approval for changes</span><span>{aiEnabled?"AI connected when configured":"AI requires administrator enablement"}</span></div>
        </div>
      </section>
    </div>
  </div>;
}
