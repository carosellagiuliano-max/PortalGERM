import { NotificationSettingsPage } from "@/components/notifications/notification-settings-page";
import { requireCandidatePage } from "@/lib/auth/route-guards";
import { getServerEnvironment } from "@/lib/config/env";
import { getDatabase } from "@/lib/db/client";

export default async function CandidateNotificationSettingsPage() {
  const user = await requireCandidatePage();
  return (
    <NotificationSettingsPage
      user={user}
      database={getDatabase()}
      environment={getServerEnvironment()}
    />
  );
}
