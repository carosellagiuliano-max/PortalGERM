import NextLink from "next/link";
import type { ComponentProps } from "react";

export type AppLinkProps = ComponentProps<typeof NextLink>;

/**
 * Internal navigation without speculative viewport prefetching by default.
 *
 * SwissTalentHub has many dynamic, private routes. Avoiding unsolicited RSC
 * requests reduces needless tenant-bound reads and keeps navigation reliable
 * in released WebKit engines. A reviewed low-risk route may still opt in with
 * an explicit `prefetch` prop.
 */
export default function AppLink({
  prefetch,
  ...props
}: Readonly<AppLinkProps>) {
  return <NextLink {...props} prefetch={prefetch ?? false} />;
}
