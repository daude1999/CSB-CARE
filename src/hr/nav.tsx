"use client";
/**
 * The HR Hub was built as its own app at the site root ("/people", "/compliance"). In the platform it lives
 * under "/hr". These wrappers add and remove that prefix so the HR Hub's screens keep their original links.
 */
import NextLink from "next/link";
import { usePathname as useNextPathname, useRouter as useNextRouter, useSearchParams } from "next/navigation";
import { forwardRef, useMemo, type ComponentProps } from "react";

export const HR_BASE = "/hr";

export function withBase(href: string): string {
  if (!href.startsWith("/") || href.startsWith("//") || href.startsWith(HR_BASE + "/") || href === HR_BASE) return href;
  if (href.startsWith("/api/") || href.startsWith("/brand/") || href.startsWith("/pdfjs/") || href.startsWith("/sample-")) return href;
  return HR_BASE + href;
}

type LinkProps = ComponentProps<typeof NextLink>;

const Link = forwardRef<HTMLAnchorElement, LinkProps>(function HrLink({ href, ...rest }, ref) {
  return <NextLink ref={ref} href={typeof href === "string" ? withBase(href) : href} {...rest} />;
});
export default Link;

/** The path inside the HR Hub, without the "/hr" prefix, as the HR Hub's screens expect. */
export function usePathname(): string {
  const path = useNextPathname();
  if (path === HR_BASE) return "/";
  return path.startsWith(HR_BASE + "/") ? path.slice(HR_BASE.length) : path;
}

export function useRouter() {
  const router = useNextRouter();
  return useMemo(
    () => ({
      ...router,
      push: (href: string, options?: Parameters<typeof router.push>[1]) => router.push(withBase(href), options),
      replace: (href: string, options?: Parameters<typeof router.replace>[1]) => router.replace(withBase(href), options),
      prefetch: (href: string) => router.prefetch(withBase(href)),
    }),
    [router],
  );
}

export { useSearchParams };
