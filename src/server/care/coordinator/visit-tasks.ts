/**
 * Visit-specific care-worker tasks from a support plan's timetable (AI CSB Coordinator brief, 6 Nov 2026, phase 5).
 *
 * A council timetable often gives one long paragraph per visit. Carers need short tasks they can tick one by one, so
 * the text is split into tasks of at most 80 characters (the full wording stays in the visit's notes). Medication
 * tasks are never given to carers from a document: they wait for the medication record to be authorised. A visit
 * whose tasks plainly need more time than it has is flagged for the coordinator, never shortened or lengthened.
 */

export const TASK_NAME_MAX = 80;
export const MAX_TASKS_PER_VISIT = 30;

/** Splits timetable task text into short, distinct tasks, in the order written. */
export function splitTaskText(items: readonly string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const add = (raw: string) => {
    const t = raw.replace(/^\s*(?:\d{1,2}[.)]|[a-z][.)]|[-–•·*])\s*/i, "").replace(/\s+/g, " ").replace(/[.;,:\s]+$/, "").trim();
    if (t.length < 3) return;
    const name = t.length > TASK_NAME_MAX ? `${t.slice(0, TASK_NAME_MAX - 1).replace(/\s+\S*$/, "")}…` : t;
    const key = name.toLowerCase();
    if (seen.has(key) || out.length >= MAX_TASKS_PER_VISIT) return;
    seen.add(key);
    out.push(name.charAt(0).toUpperCase() + name.slice(1));
  };
  for (const item of items) {
    // Lines, semicolons, bullets and sentences each make a task.
    for (const part of item.split(/\r?\n|;|•|·|\s-\s|\.\s+(?=[A-Z])/)) {
      if (part.trim().length <= TASK_NAME_MAX) { add(part); continue; }
      // Still long: split a list written with commas ("wash, dress, make breakfast").
      for (const piece of part.split(/,\s+|\s+and then\s+|\s+then\s+/)) add(piece);
    }
  }
  return out;
}

const MEDICATION = /\b(medicat\w*|medicines?|tablets?|pills?|capsules?|insulin|dosette|blister\s?packs?|inhalers?|eye\s?drops?|prescri\w*|controlled\s+drugs?|injections?|patch(?:es)?|MAR)\b/i;

/** True for a task about medicines: it needs an authorised medication record before carers can be given it. */
export function isMedicationTask(task: string): boolean {
  return MEDICATION.test(task);
}

/** Rough minutes for a task, on the cautious side; only used to flag a visit that is plainly too short. */
const TASK_MINUTES: [RegExp, number][] = [
  [/\b(shower|bath|strip wash|full wash|bed bath|personal care|wash(?:ing)? and dress)/i, 20],
  [/\b(shopping|laundry|clean(?:ing)?|hoover|housework|ironing)/i, 15],
  [/\b(breakfast|lunch|dinner|supper|meal|cook|prepare (?:food|a hot))/i, 10],
  [/\b(hoist|transfer|reposition|turn(?:ing)?|mobilis)/i, 10],
  [/\b(dress|undress|continence|pads?|toilet|commode|catheter|stoma)/i, 10],
];
export function taskMinutes(task: string): number {
  return TASK_MINUTES.find(([re]) => re.test(task))?.[1] ?? 5;
}

/** Compares the tasks' rough time with the visit's length. Never changes either. */
export function durationCheck(tasks: readonly string[], durationMin: number) {
  const needed = tasks.reduce((n, t) => n + taskMinutes(t), 0);
  return { needed, fits: needed <= durationMin };
}

/** Sorts a visit's task text into carer tasks and medication tasks held back for authorisation. */
export function visitTasks(items: readonly string[]) {
  const all = splitTaskText(items);
  return { tasks: all.filter((t) => !isMedicationTask(t)), heldMedication: all.filter(isMedicationTask) };
}
