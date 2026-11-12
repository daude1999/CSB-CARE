import { DAY_OPTIONS, formDefaults, formSpec, PREFIX } from "@/lib/care-coordinator-forms";

/**
 * Plain labelled inputs for one fact destination (no JSON). The names carry a prefix so they never clash with the
 * form's own fields; the server turns them back into a value and validates it.
 */
export function ValueFields({ destination, value, callTypes = [], idPrefix }: { destination: string; value: unknown; callTypes?: { id: string; name: string }[]; idPrefix: string }) {
  const spec = formSpec(destination);
  const d = formDefaults(destination, value);
  if (!spec.length) return <p className="text-meta text-slate-600">This value cannot be edited here.</p>;
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      {spec.map((f) => {
        const id = `${idPrefix}-${f.name}`;
        const name = PREFIX + f.name;
        const wide = f.kind === "textarea" || f.kind === "lines" || f.kind === "days" || spec.length === 1;
        const help = f.help ? <span id={`${id}-help`} className="mt-1 block text-meta text-slate-600">{f.help}</span> : null;
        const described = f.help ? `${id}-help` : undefined;
        if (f.kind === "checkbox") {
          return (
            <div key={f.name} className={wide ? "sm:col-span-2" : ""}>
              <label htmlFor={id} className="flex items-start gap-2 text-body"><input id={id} type="checkbox" name={name} defaultChecked={d[f.name] === true} className="mt-1" aria-describedby={described} /><span>{f.label}</span></label>
              {help}
            </div>
          );
        }
        if (f.kind === "days") {
          const chosen = new Set(d[f.name] as string[]);
          return (
            <fieldset key={f.name} className="sm:col-span-2">
              <legend className="label">{f.label}</legend>
              <div className="flex flex-wrap gap-2">
                {DAY_OPTIONS.map(([v, l]) => (
                  <label key={v} className="flex items-center gap-1.5 rounded border border-slate-300 bg-white px-2 py-1 text-body"><input type="checkbox" name={name} value={v} defaultChecked={chosen.has(v)} />{l}</label>
                ))}
              </div>
            </fieldset>
          );
        }
        const options = f.name === "callTypeId" ? [...(f.options ?? []), ...callTypes.map((c) => [c.id, c.name] as [string, string])] : f.options;
        const common = { id, name, required: f.required, "aria-describedby": described, className: "input" };
        return (
          <div key={f.name} className={wide ? "sm:col-span-2" : ""}>
            <label htmlFor={id} className="label">{f.label}{f.required ? <span className="text-slate-500"> (required)</span> : null}</label>
            {f.kind === "textarea" ? <textarea {...common} rows={3} defaultValue={d[f.name] as string} />
              : f.kind === "lines" ? <textarea {...common} rows={4} defaultValue={(d[f.name] as string[]).join("\n")} />
              : f.kind === "select" ? <select {...common} defaultValue={d[f.name] as string}>{options?.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
              : <input {...common} type={f.kind === "number" ? "number" : f.kind === "date" ? "date" : f.kind === "time" ? "time" : "text"} defaultValue={d[f.name] as string} />}
            {help}
          </div>
        );
      })}
    </div>
  );
}
