export function jobAlertNextDueLabel(liveOnly: boolean): string {
  return liveOnly ? "Nächste geplante Zustellung" : "Nächster lokaler Mock-Lauf";
}
