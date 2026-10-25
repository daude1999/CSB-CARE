import NextLink from "next/link";
import type { ComponentProps } from "react";

/**
 * App-wide link. Every page is server-rendered from live data, so automatic
 * prefetching only multiplies database work; it is off unless asked for.
 */
export default function Link({ prefetch = false, ...props }: ComponentProps<typeof NextLink>) {
  return <NextLink prefetch={prefetch} {...props} />;
}
