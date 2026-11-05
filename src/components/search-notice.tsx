import type { ReactNode } from "react";

/** A search problem the user must see (for example, reference numbers could not be searched). Never shown as "no results". */
export function SearchProblem({ children }: { children: ReactNode }) {
  return (
    <div role="alert" data-testid="reference-search-problem" className="mb-3 rounded-[3px] border-l-4 border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
      {children}
    </div>
  );
}

/** Council, Frameworki and NHS numbers are encrypted and only found when typed in full. */
export const EXACT_REFERENCE_HINT = "Council, Frameworki and NHS numbers are only found when the whole number is typed exactly; part numbers are not searched.";
