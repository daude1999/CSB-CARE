"use client";
import { useState } from "react";
import { EditorContent, useEditor } from "@tiptap/react";
import { Document } from "@tiptap/extension-document";
import { Paragraph } from "@tiptap/extension-paragraph";
import { Text } from "@tiptap/extension-text";
import { CharacterCount, Placeholder, UndoRedo } from "@tiptap/extensions";

/**
 * Writing surface for a policy section. Section bodies are stored as plain text
 * (diffs, citation checks and Word/PDF output all depend on that), so the editor
 * is deliberately plain: one paragraph per line, no marks. The text is posted
 * through a hidden field named `name`.
 */
export function SectionEditor({ name, initial, label }: { name: string; initial: string; label: string }) {
  const [value, setValue] = useState(initial);
  const editor = useEditor({
    immediatelyRender: false,
    extensions: [Document, Paragraph, Text, UndoRedo, CharacterCount, Placeholder.configure({ placeholder: "Write this section…" })],
    content: { type: "doc", content: initial.split("\n").map((line) => (line ? { type: "paragraph", content: [{ type: "text", text: line }] } : { type: "paragraph" })) },
    editorProps: { attributes: { "aria-label": label, role: "textbox", "aria-multiline": "true", class: "prose-policy min-h-40 whitespace-normal px-4 py-3 text-[15px] leading-7 focus:outline-hidden [&_p]:min-h-7" } },
    onUpdate: ({ editor: e }) => setValue(e.getText({ blockSeparator: "\n" })),
  });
  const words = value.trim() ? value.trim().split(/\s+/).length : 0;
  return (
    <div className="rounded-xs border border-slate-300 bg-white focus-within:border-teal-500 focus-within:ring-2 focus-within:ring-teal-100">
      <input type="hidden" name={name} value={value} />
      {editor ? <EditorContent editor={editor} /> : <textarea className="prose-policy block min-h-40 w-full border-0 px-4 py-3 text-[15px] leading-7 focus:ring-0" defaultValue={initial} readOnly aria-label={label} />}
      <div className="flex items-center justify-between border-t border-slate-200 px-4 py-1.5 font-mono text-[10.5px] uppercase tracking-[0.08em] text-slate-400">
        <span>{value === initial ? "No changes" : <span className="text-teal-700">Unsaved changes</span>}</span>
        <span>{words} words</span>
      </div>
    </div>
  );
}
