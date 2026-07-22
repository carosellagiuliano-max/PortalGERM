import { randomUUID } from "node:crypto";

import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { ReportForm } from "@/components/public/report-form";
import { CandidateMessageComposeForm } from "@/components/candidate/message-compose-form";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { requireCandidatePage } from "@/lib/auth/route-guards";
import {
  getCandidateConversation,
  type CandidateMessageSendAvailability,
} from "@/lib/candidate/messages";
import { getDatabase } from "@/lib/db/client";
import { formatDate } from "@/lib/utils/format";
import { markCandidateConversationReadAction } from "../actions";

export const metadata: Metadata = { title: "Gespräch" };

export default async function CandidateConversationPage({ params, searchParams }: PageProps) {
  const user = await requireCandidatePage();
  const { threadId } = await params;
  const { before: rawBefore } = await searchParams;
  const beforeMessageId = Array.isArray(rawBefore) ? rawBefore[0] : rawBefore;
  const conversation = await getCandidateConversation(
    getDatabase(),
    user.id,
    threadId,
    beforeMessageId === undefined ? {} : { beforeMessageId },
  );
  if (conversation === null) notFound();

  return (
    <section aria-labelledby="conversation-title">
      <Link href="/candidate/messages" className={buttonVariants({ variant: "ghost" })}>← Zurück zu Nachrichten</Link>
      <p className="eyebrow mt-5">{conversation.kind === "APPLICATION" ? "Bewerbung" : "Talent Radar"}</p>
      <h1 id="conversation-title" className="mt-2 text-3xl font-semibold tracking-tight">{conversation.subject}</h1>
      <p className="mt-2 text-muted-foreground">Gespräch mit {conversation.company.name}</p>

      <Card className="mt-8">
        <CardHeader><CardTitle as="h2">Verlauf</CardTitle></CardHeader>
        <CardContent>
          {conversation.olderCursor !== null || beforeMessageId !== undefined ? (
            <nav
              aria-label="Navigation im Nachrichtenverlauf"
              className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-muted/40 p-3"
            >
              <p className="text-sm text-muted-foreground">
                {conversation.olderCursor !== null
                  ? "Weitere ältere Nachrichten sind verfügbar."
                  : "Du hast den Beginn dieses Gesprächs erreicht."}
              </p>
              <div className="flex flex-wrap gap-2">
                {beforeMessageId !== undefined ? (
                  <Link
                    href={`/candidate/messages/${conversation.id}`}
                    className={buttonVariants({ variant: "outline", size: "sm" })}
                  >
                    Neueste Nachrichten
                  </Link>
                ) : null}
                {conversation.olderCursor !== null ? (
                  <Link
                    href={`/candidate/messages/${conversation.id}?before=${encodeURIComponent(conversation.olderCursor)}`}
                    className={buttonVariants({ variant: "outline", size: "sm" })}
                  >
                    Ältere Nachrichten
                  </Link>
                ) : null}
              </div>
            </nav>
          ) : null}
          <ol className="grid gap-3" aria-label="Chronologischer Nachrichtenverlauf">
            {conversation.messages.map((message) => (
              <li key={message.id} className={`max-w-[88%] rounded-xl px-4 py-3 ${message.own ? "ml-auto bg-primary text-primary-foreground" : "bg-muted"}`}>
                <p className="whitespace-pre-wrap break-words">{message.body}</p>
                <p className={`mt-2 text-xs ${message.own ? "text-primary-foreground/75" : "text-muted-foreground"}`}>{message.own ? "Du" : conversation.company.name} · {formatDate(message.createdAt)}</p>
              </li>
            ))}
          </ol>
        </CardContent>
      </Card>

      <div className="mt-5 grid gap-5 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <Card>
          <CardHeader><CardTitle as="h2">Antworten</CardTitle></CardHeader>
          <CardContent>
            <CandidateMessageComposeForm
              conversationId={conversation.id}
              initialIdempotencyKey={randomUUID()}
              blockedReason={messageSendBlockedCopy(
                conversation.messageSendAvailability,
              )}
            />
            <form action={markCandidateConversationReadAction} className="mt-3">
              <input type="hidden" name="conversationId" value={conversation.id} />
              <Button type="submit" variant="ghost">Als gelesen markieren</Button>
            </form>
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle as="h2">Sicherheit</CardTitle></CardHeader>
          <CardContent className="grid gap-3">
            <p className="text-sm leading-6 text-muted-foreground">Nachrichten werden als reiner Text dargestellt. Eine Antwort gibt deine Talent-Radar-Identität niemals automatisch frei.</p>
            <ReportForm targetType="COMPANY" slug={conversation.company.slug} />
          </CardContent>
        </Card>
      </div>
    </section>
  );
}

type PageProps = Readonly<{
  params: Promise<{ threadId: string }>;
  searchParams: Promise<{ before?: string | string[] }>;
}>;

function messageSendBlockedCopy(
  availability: CandidateMessageSendAvailability,
): string | null {
  if (availability.allowed) return null;
  return availability.reason === "RADAR_COMPANY_INACTIVE"
    ? "Diese Firma ist derzeit nicht aktiv. Neue Nachrichten in diesem Talent-Radar-Gespräch sind gesperrt."
    : "Diese Firma ist derzeit nicht aktuell verifiziert. Neue Nachrichten in diesem Talent-Radar-Gespräch sind gesperrt.";
}
