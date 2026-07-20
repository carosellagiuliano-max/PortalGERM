import type { Metadata } from "next";
import Link from "next/link";
import { MessageCircleIcon } from "lucide-react";

import { MessagePagination } from "@/components/candidate/message-pagination";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { requireCandidatePage } from "@/lib/auth/route-guards";
import {
  listCandidateConversations,
  normalizeCandidateConversationPage,
} from "@/lib/candidate/messages";
import { getDatabase } from "@/lib/db/client";
import { formatDate } from "@/lib/utils/format";

export const metadata: Metadata = { title: "Nachrichten" };

type CandidateMessagesPageProps = Readonly<{
  searchParams: Promise<{ page?: string | string[] }>;
}>;

export default async function CandidateMessagesPage({
  searchParams,
}: CandidateMessagesPageProps) {
  const [user, rawSearchParams] = await Promise.all([
    requireCandidatePage(),
    searchParams,
  ]);
  const conversationPage = await listCandidateConversations(
    getDatabase(),
    user.id,
    { page: normalizeCandidateConversationPage(rawSearchParams.page) },
  );
  const conversations = conversationPage.items;
  return (
    <section aria-labelledby="candidate-messages-title">
      <p className="eyebrow">Nachrichten</p>
      <h1 id="candidate-messages-title" className="mt-2 text-3xl font-semibold tracking-tight">
        Deine Gespräche
      </h1>
      <p className="mt-3 max-w-3xl leading-7 text-muted-foreground">
        Hier erscheinen nur echte Bewerbungs-Gespräche und bereits akzeptierte
        Talent-Radar-Kontakte. Offene oder abgelehnte Anfragen erzeugen keinen Chat.
      </p>
      {conversations.length === 0 ? (
        <Card className="mt-8">
          <CardContent className="grid place-items-center gap-4 py-10 text-center">
            <MessageCircleIcon className="size-9 text-primary" aria-hidden="true" />
            <div><p className="font-medium">Noch keine Nachrichten</p><p className="mt-1 text-muted-foreground">Sobald ein echtes Gespräch besteht, erscheint es hier.</p></div>
            <Link href="/candidate/applications" className={buttonVariants({ variant: "outline" })}>Bewerbungen ansehen</Link>
          </CardContent>
        </Card>
      ) : (
        <div className="mt-8 grid gap-4">
          {conversations.map((conversation) => (
            <Card key={conversation.id}>
              <CardHeader>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <CardTitle as="h2">{conversation.subject}</CardTitle>
                    <p className="mt-1 text-sm text-muted-foreground">{conversation.company.name} · {conversation.kind === "APPLICATION" ? "Bewerbung" : "Akzeptierter Talent-Radar-Kontakt"}</p>
                  </div>
                  {conversation.unreadCount > 0 ? <Badge>{conversation.unreadCount} ungelesen</Badge> : <Badge variant="outline">Gelesen</Badge>}
                </div>
              </CardHeader>
              <CardContent className="grid gap-4 sm:grid-cols-[1fr_auto] sm:items-end">
                <div>
                  <p className="line-clamp-2 text-muted-foreground">{conversation.lastMessage?.body ?? "Noch keine Nachricht"}</p>
                  <p className="mt-2 text-xs text-muted-foreground">Aktualisiert {formatDate(conversation.updatedAt)}</p>
                </div>
                <Link href={`/candidate/messages/${conversation.id}`} className={buttonVariants({ variant: "outline" })}>Gespräch öffnen</Link>
              </CardContent>
            </Card>
          ))}
          <MessagePagination pagination={conversationPage} />
        </div>
      )}
    </section>
  );
}
