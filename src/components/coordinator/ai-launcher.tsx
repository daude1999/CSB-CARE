"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { usePathname } from "next/navigation";
import Link from "@/components/link";
import { ArrowUp, ChatCircleDots, FileText, Minus, Sparkle, X } from "@phosphor-icons/react";
import { askCsbCoordinator } from "@/app/csb-coordinator-chat-actions";

type Message={role:"user"|"assistant";content:string};
const initial:Message={role:"assistant",content:"Hello! I'm AI CSB Coordinator. I can help you review support plans, prepare care records and understand rota readiness. What would you like help with?"};
const choices=[
  ["Support plan", "How do I upload a support plan and set up a service user?"],
  ["Review case", "What needs checking before this care intake can be approved?"],
  ["Rota", "What is the safe process to prepare a rota from an approved care plan?"],
];
/** Lightweight launcher: available from the existing CRM, without its own module. */
export function AiCsbCoordinatorLauncher(){
  const pathname=usePathname();
  const match=pathname?.match(/^\/rota\/coordinator\/([a-zA-Z0-9]{10,40})(?:\/|$)/);
  const intakeId=match?.[1]??null;
  const [open,setOpen]=useState(false);
  const [messages,setMessages]=useState<Message[]>([initial]);
  const [query,setQuery]=useState("");
  const [sending,setSending]=useState(false);
  const [error,setError]=useState<string|null>(null);
  const scrollBottom=useRef<HTMLDivElement>(null);
  const input=useRef<HTMLTextAreaElement>(null);
  useEffect(()=>{if(open)input.current?.focus()},[open]);
  useEffect(()=>{if(open)scrollBottom.current?.scrollIntoView({behavior:"smooth",block:"nearest"})},[messages,open]);
  async function ask(q:string){
    const text=q.trim();if(!text||sending)return;
    const history=messages.slice(1).slice(-8);
    setMessages(m=>[...m,{role:"user",content:text}]);setQuery("");setSending(true);setError(null);
    try{
      const response=await askCsbCoordinator({question:text,intakeId,history});
      setMessages(m=>[...m,{role:"assistant",content:response.answer}]);
    }catch{setError("The assistant couldn't answer just now. Nothing was changed in the CRM.");}
    finally{setSending(false);}
  }
  function submit(e:FormEvent){e.preventDefault();void ask(query);}
  return <div className="pointer-events-none fixed bottom-5 right-4 z-[80] sm:bottom-6 sm:right-6">
    {open?<section role="dialog" aria-label="AI CSB Coordinator" className="pointer-events-auto mb-3 flex h-[min(670px,calc(100dvh-104px))] w-[min(440px,calc(100vw-32px))] flex-col overflow-hidden rounded-[22px] border border-[#d9e5e6] bg-white shadow-[0_18px_70px_rgba(14,44,56,.24)]">
      <header className="flex items-center gap-3 bg-[#0b626d] px-4 py-4 text-white">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white/15"><Sparkle size={23} weight="fill"/></span>
        <span className="min-w-0 flex-1"><strong className="block text-[15px]">AI CSB Coordinator</strong><span className="block text-xs text-white/80">{intakeId?"Current intake connected":"Your care coordination assistant"}</span></span>
        <button type="button" onClick={()=>setOpen(false)} aria-label="Minimise AI CSB Coordinator" className="rounded-lg p-2 hover:bg-white/15"><Minus size={20}/></button>
        <button type="button" onClick={()=>setOpen(false)} aria-label="Close AI CSB Coordinator" className="rounded-lg p-2 hover:bg-white/15"><X size={18}/></button>
      </header>
      {intakeId?<div className="border-b border-teal-100 bg-[#f2fbf9] px-4 py-2.5 text-xs text-[#195f68]">Using your current care intake for context. <Link href={`/rota/coordinator/${intakeId}`} className="font-semibold underline">Open intake</Link></div>:null}
      <div role="log" aria-label="Coordinator conversation" aria-live="polite" className="flex-1 space-y-4 overflow-y-auto bg-[#fcfdfd] px-4 py-5">
        {messages.map((m,i)=><div key={i} className={`flex ${m.role==="user"?"justify-end":"justify-start"}`}>
          <div className={`max-w-[90%] whitespace-pre-wrap rounded-2xl px-3.5 py-3 text-[13.5px] leading-6 ${m.role==="user"?"rounded-tr-sm bg-[#146d78] text-white":"rounded-tl-sm bg-[#edf3f4] text-[#294758]"}`}>{m.content}</div>
        </div>)}
        {sending?<div className="flex items-center gap-2 text-sm text-[#60727a]"><Sparkle size={16} className="animate-pulse"/> Thinking with the available case details…</div>:null}
        {error?<div role="alert" className="rounded-lg bg-rose-50 p-3 text-xs text-rose-700">{error}</div>:null}
        <div ref={scrollBottom}/>
      </div>
      {messages.length===1?<div className="flex flex-wrap gap-2 border-t border-slate-100 px-4 py-3">
        {choices.map(([label,prompt])=><button type="button" key={label} onClick={()=>void ask(prompt)} disabled={sending} className="rounded-full border border-[#cfe0e1] bg-white px-3 py-1.5 text-xs font-medium text-[#126773] hover:bg-[#f0f9f8]">{label}</button>)}
      </div>:null}
      <div className="border-t border-slate-100 bg-white p-3">
        <form onSubmit={submit} className="flex items-end gap-2 rounded-xl border border-slate-200 bg-[#fafcfc] p-2 focus-within:border-[#75b7b7]">
          <textarea ref={input} aria-label="Message AI CSB Coordinator" rows={2} maxLength={2000} value={query} onChange={e=>setQuery(e.target.value)}
            onKeyDown={e=>{if(e.key==="Enter"&&!e.shiftKey){e.preventDefault();void ask(query)}}}
            placeholder="Ask AI CSB Coordinator…" className="min-h-[42px] max-h-32 flex-1 resize-none bg-transparent px-2 py-1.5 text-sm outline-none placeholder:text-slate-400"/>
          <button aria-label="Send message" disabled={sending||!query.trim()} className="flex h-9 w-9 items-center justify-center rounded-lg bg-[#0b626d] text-white disabled:opacity-40"><ArrowUp size={19}/></button>
        </form>
        <div className="mt-2 flex items-center justify-between gap-3 px-1 text-[11px] text-slate-500"><span>Human approval required for changes</span><Link href="/rota/coordinator" className="inline-flex items-center gap-1 font-semibold text-[#176773] hover:underline"><FileText size={13}/> Support plans</Link></div>
      </div>
    </section>:null}
    {!open?<button type="button" onClick={()=>setOpen(true)} className="pointer-events-auto flex items-center gap-2.5 rounded-full border border-white/20 bg-[#096672] px-4 py-3.5 text-sm font-semibold text-white shadow-[0_8px_32px_rgba(10,76,86,.3)] transition hover:-translate-y-0.5 hover:bg-[#075763] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#096672]">
      <Sparkle size={21} weight="fill"/><span>AI CSB Coordinator</span><ChatCircleDots size={18}/>
    </button>:null}
  </div>;
}
