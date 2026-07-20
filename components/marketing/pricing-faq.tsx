const questions = [
  ["Brauche ich ein Abo, um zu starten?", "Nein. Free Basic ist als kostenloser Einstieg vorgesehen. Die Registrierung erzeugt noch keine Bestellung oder bezahlte Subscription."],
  ["Was passiert beim Limit?", "Das Server-Gate verhindert weitere planpflichtige Aktionen. Es gibt keine automatische Überschreitung und keine stillschweigende Zusatzgebühr."],
  ["Wie funktioniert Talent Radar?", "Nur aktiv eingeladene Kandidat:innen erscheinen anonym. Kontakte benötigen Radar-Zugang und verfügbare Kontakt-Credits; die Identität wird erst im vorgesehenen Freigabefluss sichtbar."],
  ["Was ist Lohntransparenz?", "Eine konkrete Lohnspanne verbessert die Einordnung eines Inserats. Sie ist ein Transparenzfaktor und keine Garantie für einen individuellen Lohn."],
  ["Welche Abrechnungswährung gilt?", "Alle dargestellten Katalogwerte lauten auf Schweizer Franken (CHF) und sind Nettowerte."],
  ["Kann ich jederzeit kündigen?", "Die gezeigten Monatspläne sind Produkt- und Preishypothesen. Verbindliche Laufzeit-, Kündigungs- und Steuerbedingungen werden vor einem späteren Vertrag ausdrücklich bestätigt."],
] as const;

export function PricingFaq() {
  return (
    <div className="grid gap-3">
      {questions.map(([question, answer]) => (
        <details key={question} className="group rounded-xl border bg-background p-5">
          <summary className="cursor-pointer font-semibold marker:text-primary">{question}</summary>
          <p className="mt-3 max-w-3xl text-sm leading-6 text-muted-foreground">{answer}</p>
        </details>
      ))}
    </div>
  );
}
