import { NotificationSettingsPage } from "@/components/notifications/notification-settings-page";
import { requireEmployerPage } from "@/lib/auth/route-guards";
import { getServerEnvironment } from "@/lib/config/env";
import { getDatabase } from "@/lib/db/client";

export default async function EmployerNotificationSettingsPage() {
  const user = await requireEmployerPage();
  return (
    <NotificationSettingsPage
      user={user}
      database={getDatabase()}
      environment={getServerEnvironment()}
    />
  );
}
