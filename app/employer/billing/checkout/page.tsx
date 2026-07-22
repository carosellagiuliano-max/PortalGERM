import { randomUUID } from "node:crypto";

import type { Metadata } from "next";
import Link from "next/link";

import { CheckoutSubmitForm } from "@/components/billing/checkout-submit-form";
import { CheckoutSummary } from "@/components/billing/checkout-summary";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  buildEmployerCheckoutChoices,
  type EmployerCheckoutChoiceResult,
} from "@/lib/billing/employer-checkout-choice";
import { requireEmployerBillingPage } from "@/lib/billing/employer-page-access";
import { getCheckoutPreview } from "@/lib/billing/employer-read-model";
import { getPublicPricingCatalog } from "@/lib/billing/public-catalog";
import { getDatabase } from "@/lib/db/client";
import { formatChfFromRappen } from "@/lib/utils/format";

export const metadata: Metadata = { title: "Sicherer Mock-Checkout" };
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type CheckoutSearchParams = Promise<{
  plan?: string | string[];
  product?: string | string[];
  quantity?: string | string[];
  job?: string | string[];
  approval?: string | string[];
}>;

export default async function EmployerBillingCheckoutPage({
  searchParams,
}: Readonly<{ searchParams: CheckoutSearchParams }>) {
  const query = await searchParams;
  const plan = scalar(query.plan);
  const product = scalar(query.product);
  const hasPlanInput = query.plan !== undefined;
  const ownerOnly = hasPlanInput;
  const { context } = await requireEmployerBillingPage(ownerOnly);

  if (plan === null && product === null) {
    const catalog = await getPublicPricingCatalog(new Date());
    const choices = catalog.ok &&
      (context.membershipRole === "OWNER" || context.membershipRole === "ADMIN")
      ? buildEmployerCheckoutChoices(catalog.value, context.membershipRole)
      : ({ ok: false, code: "CATALOG_UNAVAILABLE" } as const);
    return <CheckoutChoice choices={choices} />;
  }
  const quantity = parseQuantity(query.quantity);
  const preview = await getCheckoutPreview(
    getDatabase(),
    context.companyId,
    {
      ...(plan === null ? {} : { plan }),
      ...(product === null ? {} : { product }),
      quantity,
      ...(scalar(query.job) === null ? {} : { targetJobId: scalar(query.job)! }),
      ...(scalar(query.approval) === null
        ? {}
        : { importSetupApprovalId: scalar(query.approval)! }),
    },
    new Date(),
  );
  if (!preview.ok) {
    return (
      <CheckoutUnavailable
        code={preview.code}
        canManagePlan={context.membershipRole === "OWNER"}
      />
    );
  }

  return (
    <section aria-labelledby="checkout-title" className="grid gap-7">
      <header>
        <p className="eyebrow">Billing · Sicherer Checkout</p>
        <h1 id="checkout-title" className="mt-2 text-3xl font-semibold tracking-tight">
          Bestellung prüfen
        </h1>
        <p className="mt-3 max-w-3xl leading-7 text-muted-foreground">
          Auswahl und Menge sind nur eine Kaufabsicht. Preis, MWST, Firmenkontext und
          Rechnungsprofil werden beim Absenden erneut serverseitig geladen und als
          unveränderliche Bestellung gespeichert.
        </p>
      </header>
      <CheckoutSummary preview={preview.value} />
      {preview.value.profile === null ? (
        <Alert>
          <AlertTitle>Rechnungsprofil fehlt</AlertTitle>
          <AlertDescription>
            Es wurde noch keine Bestellung angelegt. <Link href="/employer/billing/profile">Rechnungsprofil vervollständigen</Link>.
          </AlertDescription>
        </Alert>
      ) : (
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <Link href="/employer/billing" className={buttonVariants({ variant: "outline" })}>Abbrechen</Link>
          <CheckoutSubmitForm
            kind={preview.value.kind}
            slug={preview.value.slug}
            quantity={preview.value.quantity}
            idempotencyKey={randomUUID()}
            retentionOptions={preview.value.retentionOptions}
            targetJobId={preview.value.targetJobId}
            importSetupApprovalId={preview.value.importSetupApprovalId}
          />
        </div>
      )}
    </section>
  );
}

function CheckoutChoice({
  choices,
}: Readonly<{ choices: EmployerCheckoutChoiceResult }>) {
  if (!choices.ok) {
    return (
      <section aria-labelledby="checkout-choice-title" className="grid gap-7">
        <header>
          <p className="eyebrow">Billing · Checkout</p>
          <h1 id="checkout-choice-title" className="mt-2 text-3xl font-semibold tracking-tight">
            Plan oder Produkt wählen
          </h1>
        </header>
        <Alert>
          <AlertTitle>Checkout-Auswahl momentan nicht verfügbar</AlertTitle>
          <AlertDescription className="grid gap-3">
            <p>
              Die aktuell wirksamen Katalogversionen konnten nicht eindeutig bestätigt werden.
              Deshalb zeigen wir keine Ersatzpreise oder Ersatzlimiten an.
            </p>
            <Link href="/employer/billing" className={buttonVariants({ variant: "outline" })}>
              Zur Billing-Übersicht
            </Link>
          </AlertDescription>
        </Alert>
      </section>
    );
  }

  return (
    <section aria-labelledby="checkout-choice-title" className="grid gap-7">
      <header><p className="eyebrow">Billing · Checkout</p><h1 id="checkout-choice-title" className="mt-2 text-3xl font-semibold tracking-tight">Plan oder Produkt wählen</h1><p className="mt-3 text-muted-foreground">Die Auswahl übernimmt nur aktuell wirksame Katalogwerte. Der Link übermittelt eine Kaufabsicht; Verfügbarkeit, Rechte und Betrag werden vor der Bestellung erneut serverseitig geprüft.</p></header>
      <div className="grid gap-4 md:grid-cols-2">
        {choices.value.map((choice) => <Card key={choice.href}><CardHeader><CardTitle as="h2">{choice.name}</CardTitle><CardDescription>{choice.detail}</CardDescription></CardHeader><CardContent className="flex items-center justify-between gap-3"><p className="text-lg font-semibold">{formatChfFromRappen(choice.netPriceRappen)} netto</p><Link href={choice.href} className={buttonVariants()}>Prüfen</Link></CardContent></Card>)}
      </div>
    </section>
  );
}

function CheckoutUnavailable({
  code,
  canManagePlan,
}: Readonly<{ code: string; canManagePlan: boolean }>) {
  const copy: Record<string, { title: string; description: string; href?: string; cta?: string }> = {
    INVALID_SELECTION: { title: "Ungültige Auswahl", description: "Wähle genau einen freigegebenen Plan oder ein Contact Pack." },
    CATALOG_UNAVAILABLE: { title: "Aktuell nicht verfügbar", description: "Für diese Auswahl existiert aktuell keine eindeutig freigegebene Version." },
    TAX_UNAVAILABLE: { title: "Checkout vorsorglich gesperrt", description: "Die freigegebene Schweizer MWST-Version ist nicht eindeutig verfügbar." },
    SAME_PLAN: { title: "Plan bereits aktiv", description: "Ein Checkout für denselben aktiven Plan ist nicht zulässig." },
    PLAN_NOT_SELF_SERVICE: { title: "Beratung erforderlich", description: "Dieser Planwechsel ist im Self-Service-MVP nicht freigegeben.", href: "/employers/demo", cta: "Beratung anfragen" },
    TALENT_RADAR_REQUIRED: {
      title: "Talent Radar erforderlich",
      description: "Contact Packs erweitern nur vorhandenes Guthaben und schalten Talent Radar nicht frei.",
      href: canManagePlan
        ? "/employer/billing/checkout?plan=pro"
        : "/pricing",
      cta: canManagePlan ? "Pro prüfen" : "Planoptionen ansehen",
    },
    PRODUCT_RELEASE_REQUIRED: { title: "P1-Release nicht freigegeben", description: "Dieses Produkt bleibt ohne aktiven Katalog-Release-Entscheid serverseitig gesperrt." },
    PRODUCT_CONTEXT_INVALID: { title: "Zielkontext nicht verfügbar", description: "Die ausgewählte Stelle oder Import-Freigabe erfüllt die Voraussetzungen aktuell nicht." },
  };
  const message = copy[code] ?? copy.INVALID_SELECTION!;
  return <Alert><AlertTitle>{message.title}</AlertTitle><AlertDescription className="grid gap-3"><p>{message.description}</p><div className="flex flex-wrap gap-2">{message.href === undefined ? null : <Link href={message.href} className={buttonVariants()}>{message.cta}</Link>}<Link href="/employer/billing" className={buttonVariants({ variant: "outline" })}>Zur Billing-Übersicht</Link></div></AlertDescription></Alert>;
}

function scalar(value: string | string[] | undefined) {
  return typeof value === "string" && value.length > 0 ? value : null;
}
function parseQuantity(value: string | string[] | undefined) {
  if (value === undefined) return 1;
  if (typeof value !== "string" || !/^\d{1,2}$/u.test(value)) return Number.NaN;
  return Number(value);
}
