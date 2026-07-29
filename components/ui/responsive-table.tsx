import type { ComponentProps, ReactNode } from "react";

import { cn } from "@/lib/utils";

type ResponsiveTableProps = Omit<ComponentProps<"table">, "children"> &
  Readonly<{
    children: ReactNode;
    label: string;
    wrapperClassName?: string;
  }>;

export function ResponsiveTable({
  children,
  className,
  label,
  wrapperClassName,
  ...props
}: ResponsiveTableProps) {
  return (
    <div
      className={cn(
        "max-w-full overflow-x-auto rounded-xl border bg-card",
        wrapperClassName,
      )}
      data-responsive-table-region="true"
      role="region"
      aria-label={label}
      tabIndex={0}
    >
      <table
        {...props}
        className={cn("w-full text-left text-sm", className)}
        data-responsive-table="true"
      >
        <caption className="sr-only">{label}</caption>
        {children}
      </table>
    </div>
  );
}

type ResponsiveTableCellProps = ComponentProps<"td"> &
  Readonly<{
    actions?: boolean;
    label: string;
    primary?: boolean;
    valueClassName?: string;
  }>;

export function ResponsiveTableCell({
  actions = false,
  children,
  className,
  label,
  primary = false,
  valueClassName,
  ...props
}: ResponsiveTableCellProps) {
  return (
    <td
      {...props}
      className={className}
      data-responsive-actions={actions || undefined}
      data-responsive-cell="true"
      data-responsive-primary={primary || undefined}
    >
      <span
        className="hidden text-xs font-semibold tracking-wide text-muted-foreground uppercase"
        data-responsive-label="true"
        aria-hidden="true"
      >
        {label}
      </span>
      <div className={cn("min-w-0", valueClassName)}>{children}</div>
    </td>
  );
}
