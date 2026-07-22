import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";

import { InvoiceView } from "@/components/billing/invoice-view";
import { buttonVariants } from "@/components/ui/button";
import { requireEmployerBillingPage } from "@/lib/billing/employer-page-access";
import { getCompanyInvoice } from "@/lib/billing/employer-read-model";
import { getDatabase } from "@/lib/db/client";

export const metadata: Metadata = { title: "Rechnungsdetail" };
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export default async function EmployerInvoiceDetailPage({
  params,
}: Readonly<{ params: Promise<{ id: string }> }>) {
  const { context } = await requireEmployerBillingPage();
  const parsed = z.uuid().safeParse((await params).id);
  if (!parsed.success) notFound();
  const invoice = await getCompanyInvoice(
    getDatabase(),
    context.companyId,
    parsed.data,
    new Date(),
  );
  if (invoice === null) notFound();
  return <section aria-labelledby="invoice-detail-title" className="grid gap-6"><header><p className="eyebrow">Billing · Rechnung</p><h1 id="invoice-detail-title" className="mt-2 text-3xl font-semibold tracking-tight">{invoice.number}</h1></header><InvoiceView invoice={invoice} /><Link href="/employer/billing/invoices" className={buttonVariants({ variant: "outline" })}>Zurück zum Rechnungsarchiv</Link></section>;
}
