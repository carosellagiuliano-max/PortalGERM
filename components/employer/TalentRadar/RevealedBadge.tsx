import { EyeIcon, EyeOffIcon } from "lucide-react";

import { Badge } from "@/components/ui/badge";

export function RevealedBadge({
  status,
}: Readonly<{
  status: "NONE" | "ACTIVE" | "REVOKED" | "TRUST_BLOCKED";
}>) {
  if (status === "ACTIVE") {
    return (
      <Badge className="bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-100">
        <EyeIcon aria-hidden="true" /> Freigegebene Identität
      </Badge>
    );
  }

  const label = status === "REVOKED"
    ? "Freigabe widerrufen"
    : status === "TRUST_BLOCKED"
      ? "Identität derzeit geschützt"
      : "Identität nicht freigegeben";
  return (
    <Badge variant="outline">
      <EyeOffIcon aria-hidden="true" /> {label}
    </Badge>
  );
}
