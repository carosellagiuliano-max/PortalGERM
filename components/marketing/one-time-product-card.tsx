import Link from "next/link";
import { ArrowRightIcon } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { PublicPricingProduct } from "@/lib/billing/public-catalog-core";
import { formatChfFromRappen } from "@/lib/utils/format";

export function OneTimeProductCard({ product }: Readonly<{ product: PublicPricingProduct }>) {
  const boost = product.kind === "JOB_BOOST";
  return (
    <Card className="h-full">
      <CardHeader>
        <Badge variant="outline" className="mb-2 w-fit">Noch nicht direkt kaufbar</Badge>
        <CardTitle as="h3" className="text-xl">{product.name}</CardTitle>
        <p className="mt-2 text-2xl font-semibold">{formatChfFromRappen(product.netPriceRappen)} netto</p>
      </CardHeader>
      <CardContent className="mt-auto">
        <p className="text-sm leading-6 text-muted-foreground">
          {boost
            ? `Geplante Laufzeit: ${product.durationDays} Tage. Ein Boost wird erst in Phase 13 von einer geeigneten eigenen Stelle aus aktiviert und bleibt klar als bezahlt gekennzeichnet.`
            : `${product.creditAmount} zusätzliche Kontakte. Das Pack setzt einen bestehenden Talent-Radar-Zugang voraus und schaltet den Radar niemals selbst frei.`}
        </p>
        <Link
          href={boost ? "/employers/post-job" : "/employers/talent-radar"}
          className={buttonVariants({ variant: "outline", className: "mt-5 w-full" })}
        >
          {boost ? "Inserat-Ablauf ansehen" : "Talent Radar verstehen"}
          <ArrowRightIcon data-icon="inline-end" aria-hidden="true" />
        </Link>
      </CardContent>
    </Card>
  );
}
