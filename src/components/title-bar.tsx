import { ModuleHeader } from "@/components/module-header-band";

/**
 * The page title, in the current module's colour. Since the owner's colour redesign (10 Nov 2026) this is the shared
 * `ModuleHeader` band: left-aligned, with the breadcrumb in place of the old Back link. `children` is a second row in
 * the band. `back` is kept for call sites that pass it and is not shown.
 */
export function TitleBar({ title, children }: { title: React.ReactNode; back?: string; children?: React.ReactNode }) {
  return <ModuleHeader title={title}>{children}</ModuleHeader>;
}
