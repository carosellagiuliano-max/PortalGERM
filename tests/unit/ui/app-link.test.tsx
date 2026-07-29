import { render, screen } from "@testing-library/react";
import type { ComponentProps } from "react";
import { describe, expect, it, vi } from "vitest";

const nextLink = vi.hoisted(() =>
  vi.fn(
    ({
      children,
      prefetch,
      ...props
    }: ComponentProps<"a"> & { prefetch?: boolean | null }) => (
      <a {...props} data-prefetch={String(prefetch)}>
        {children}
      </a>
    ),
  ),
);

vi.mock("next/link", () => ({ default: nextLink }));

import AppLink from "@/components/shared/app-link";

describe("AppLink", () => {
  it("disables speculative route prefetching by default", () => {
    render(<AppLink href="/candidate/jobpass">SwissJobPass</AppLink>);

    expect(screen.getByRole("link", { name: "SwissJobPass" })).toHaveAttribute(
      "data-prefetch",
      "false",
    );
  });

  it("requires an explicit opt-in to enable prefetching", () => {
    render(
      <AppLink href="/guide" prefetch>
        Ratgeber
      </AppLink>,
    );

    expect(screen.getByRole("link", { name: "Ratgeber" })).toHaveAttribute(
      "data-prefetch",
      "true",
    );
  });
});
