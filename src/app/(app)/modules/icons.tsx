import { CalendarDots, ChalkboardTeacher, ClipboardText, Handshake, ListMagnifyingGlass, Signature } from "@phosphor-icons/react/dist/ssr";

const ICONS = { learning: ChalkboardTeacher, "hr-advice": Handshake, "care-plans": ClipboardText, "read-tracking": Signature, rotas: CalendarDots, "mock-inspections": ListMagnifyingGlass } as const;

export function ModuleIcon({ slug, size = 24 }: { slug: string; size?: number }) {
  const Icon = ICONS[slug as keyof typeof ICONS] ?? ClipboardText;
  return <Icon size={size} weight="fill" aria-hidden="true" />;
}
