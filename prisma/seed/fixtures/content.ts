export type DemoGuideFixture = Readonly<{
  canonicalPath: string;
  excerpt: string;
  locale: "de-CH";
  slug: string;
  title: string;
  type: "GUIDE";
  body: string;
}>;

export const DEMO_GUIDE_FIXTURES: readonly DemoGuideFixture[] = Object.freeze([
  guide(
    "faire-stelleninserate-erkennen",
    "So erkennst du faire Stelleninserate",
    "Ein praktischer Prüfrahmen für klare Aufgaben, transparente Bedingungen und respektvolle Bewerbungsprozesse.",
    `Ein faires Stelleninserat hilft dir, eine informierte Entscheidung zu treffen, bevor du Zeit in eine Bewerbung investierst. Beginne mit den Aufgaben: Gute Inserate beschreiben nicht nur Schlagwörter, sondern erklären, welche Verantwortung du übernimmst, mit wem du zusammenarbeitest und woran Erfolg gemessen wird. Achte darauf, ob Anforderungen als notwendig oder als wünschenswert bezeichnet sind. Eine endlose Wunschliste ohne Prioritäten ist kein automatischer Ausschlussgrund, aber ein Anlass für Rückfragen.

Prüfe danach die Rahmenbedingungen. Pensum, Arbeitsort, Vertragsart und ein möglicher Starttermin sollten klar sein. Bei hybrider Arbeit ist entscheidend, wie viele Präsenztage erwartet werden und ob sich diese Regel je nach Team verändert. Ein Lohnband ist ein gutes Signal, wenn erklärt wird, ob es sich auf ein Vollzeitpensum, einen Jahres- oder Monatslohn und welche Anzahl Monatslöhne bezieht. Fehlt der Lohn, kannst du früh nach dem vorgesehenen Budget fragen.

Auch der Bewerbungsweg sagt viel über Fairness aus. Seriöse Arbeitgeber nennen die benötigten Unterlagen, die ungefähren Schritte und eine Kontaktmöglichkeit. Sie verlangen keine sensiblen Informationen, die für die erste Auswahl nicht nötig sind. Dazu gehören beispielsweise Familienplanung, religiöse Überzeugungen oder vollständige Ausweiskopien. Für ein erstes Gespräch reicht normalerweise ein nachvollziehbarer Lebenslauf; zusätzliche Nachweise können später gezielt folgen.

Lies die Sprache des Inserats aufmerksam. Respektvolle Formulierungen sprechen verschiedene Lebensläufe an und vermeiden unnötige Alters- oder Geschlechterbilder. Versprechen wie „garantierte Karriere“ oder permanenter Zeitdruck sind dagegen schwer überprüfbar. Suche nach konkreten Beispielen für Entwicklung: Budget, Lernzeit, Begleitung oder interne Wechselmöglichkeiten sind aussagekräftiger als ein allgemeines Versprechen.

Zum Schluss vergleiche das Inserat mit der Unternehmensseite und notiere offene Punkte. Drei gute Fragen reichen oft: Was sind die wichtigsten Ziele der ersten drei Monate? Wie wird Leistung besprochen? Welche Rahmenbedingungen sind verhandelbar? Ein faires Inserat muss nicht perfekt sein. Es sollte dir aber genügend verlässliche Informationen geben, damit Bewerbung und Gespräch auf Augenhöhe beginnen können. Transparenz schafft eine gemeinsame Grundlage.`,
  ),
  guide(
    "lohn-verhandeln-schweiz",
    "Lohn verhandeln in der Schweiz",
    "So bereitest du eine sachliche Lohnverhandlung mit Bandbreite, Gesamtpaket und klarer Begründung vor.",
    `Eine gute Lohnverhandlung beginnt nicht mit einer einzelnen Zahl, sondern mit einer belastbaren Einordnung. Sammle zuerst Informationen zur Funktion, Branche, Region, Erfahrung und Verantwortung. Öffentliche Lohnangaben, Berufsverbände und mehrere Vergleichsgespräche können Hinweise geben, ersetzen aber keine individuelle Bewertung. Notiere deshalb eine realistische Bandbreite und markiere, welche Annahmen dahinterstehen. Rechne alle Werte auf dasselbe Pensum und dieselbe Periodik um.

Betrachte das gesamte Angebot. In der Schweiz können Anzahl Monatslöhne, Bonusregeln, Pensionskassenleistungen, Ferien, Arbeitszeit, Weiterbildung und flexible Arbeit einen spürbaren Unterschied machen. Ein höherer Jahreslohn ist nicht automatisch besser, wenn variable Bestandteile unsicher oder Arbeitswege deutlich länger sind. Bitte um eine schriftliche Übersicht, damit du feste und variable Komponenten sauber trennen kannst. Kläre zudem, ob genannte Beträge brutto sind und welches Vollzeitpensum zugrunde liegt.

Formuliere deinen Wunsch als begründete Spanne. Verknüpfe ihn mit dem erwarteten Beitrag: relevante Erfahrung, seltene Fähigkeiten, Verantwortung oder nachweisbare Resultate. Eine mögliche Formulierung lautet sinngemäss: Auf Basis der Aufgaben und meiner Erfahrung sehe ich die Funktion in einer Bandbreite von X bis Y Franken brutto pro Jahr bei hundert Prozent. Danach kannst du fragen, wie der Arbeitgeber die Einstufung vornimmt. So bleibt das Gespräch offen und konkret.

Wenn das Budget tiefer liegt, musst du nicht sofort zu- oder absagen. Frage nach dem verfügbaren Spielraum und nach Alternativen. Denkbar sind zusätzliche Ferien, ein verbindliches Weiterbildungsbudget, ein früher Lohnreview oder eine klar definierte Entwicklung zur nächsten Stufe. Solche Zusagen sollten messbar und schriftlich festgehalten sein. Ein unverbindliches „später schauen wir weiter“ ist weniger wert als ein Termin mit Kriterien.

Nimm dir nach dem Gespräch Zeit. Prüfe, ob Aufgaben, Einstufung und Paket zusammenpassen und ob du dich respektvoll behandelt fühlst. Eine sachliche Verhandlung ist kein Loyalitätstest. Sie hilft beiden Seiten, Erwartungen früh zu klären. Wenn ein Unternehmen auf höfliche Fragen ausweichend oder mit unangemessenem Druck reagiert, ist auch das eine wichtige Information für deine Entscheidung.`,
  ),
  guide(
    "bewerbung-kmu-vs-konzern",
    "Bewerbung bei KMU vs Konzern",
    "Was sich bei kleinen Unternehmen und grossen Organisationen unterscheidet und wie du dich passend vorbereitest.",
    `Bewerbungen bei einem KMU und bei einem Konzern verfolgen dasselbe Ziel, laufen aber oft unterschiedlich ab. In einem kleineren Unternehmen sprechen Bewerbende häufig früher mit einer Person, die später direkt mit ihnen arbeitet. Entscheidungen können schnell fallen, Zuständigkeiten sind dafür manchmal weniger formal dokumentiert. In einem Konzern begegnen dir eher standardisierte Portale, mehrere Gesprächsrunden und klar getrennte Rollen zwischen Recruiting, Fachbereich und Führung.

Für ein KMU lohnt sich eine konkrete Vorbereitung auf den Betrieb. Informiere dich über Produkte, Kundschaft, Region und die praktische Bedeutung der offenen Stelle. Zeige, dass du Verantwortung übernehmen und bei Bedarf über enge Funktionsgrenzen hinaus mitdenken kannst. Beispiele aus deinem Alltag sind besonders hilfreich: Wie hast du ein Problem selbständig gelöst, Prioritäten gesetzt oder mit knappen Ressourcen gearbeitet? Vermeide jedoch die Annahme, in kleinen Firmen gebe es keine spezialisierten Prozesse.

Bei einem Konzern solltest du die Stellenanforderungen strukturiert spiegeln. Automatisierte Vorauswahl und mehrere Beteiligte machen klare Begriffe, nachvollziehbare Stationen und messbare Resultate wichtig. Bereite kurze Beispiele nach Situation, Aufgabe, Vorgehen und Ergebnis vor. Rechne mit Fragen zu Zusammenarbeit über Teams, Standards, Sicherheit oder Veränderungsprozessen. Gleichzeitig darfst du nachfragen, wie viel Entscheidungsfreiheit die konkrete Einheit tatsächlich hat.

In beiden Welten zählt Passung mehr als ein perfekter Lebenslauf. Beim KMU kann die persönliche Zusammenarbeit stärker gewichtet werden; im Konzern kann eine präzise Rollenpassung wichtiger sein. Das bedeutet nicht, dass eine Seite informell und die andere unpersönlich sein muss. Gute Arbeitgeber erklären ihre Schritte, geben angemessene Fristen und beantworten Fragen transparent. Bitte immer um Klarheit, wenn Titel, Verantwortung und Entscheidungswege nicht zusammenpassen.

Passe schliesslich deine eigenen Fragen an. Beim KMU kannst du nach Tagesablauf, Stellvertretung und Wachstum fragen. Beim Konzern sind Schnittstellen, Freigaben und interne Mobilität relevant. Prüfe unabhängig von der Grösse Lohn, Pensum, Führung, Entwicklung und Unternehmenskultur. Entscheidend ist nicht das Etikett KMU oder Konzern, sondern ob die konkrete Arbeitsumgebung zu deinen Zielen und deiner bevorzugten Art der Zusammenarbeit passt.`,
  ),
  guide(
    "pensum-80-bis-100-prozent",
    "Was bedeutet Pensum 80–100 %?",
    "Wie du Bandbreiten beim Arbeitspensum verstehst und Arbeitszeit, Lohn sowie Erwartungen konkret klärst.",
    `Ein Inserat mit einem Pensum von 80 bis 100 Prozent signalisiert zunächst Verhandlungsspielraum. Es sagt aber noch nicht, wie Aufgaben, Arbeitstage und Lohn bei den einzelnen Varianten aussehen. Frage deshalb früh, ob die Stelle tatsächlich in jedem Pensum funktioniert oder ob der Arbeitgeber eine bevorzugte Lösung hat. Manchmal ist die Bandbreite offen, manchmal werden bei achtzig Prozent bestimmte Aufgaben anders verteilt.

Kläre die Berechnungsgrundlage. Die Wochenstunden bei hundert Prozent unterscheiden sich je nach Betrieb oder Gesamtarbeitsvertrag. Achtzig Prozent von vierzig Stunden ergeben eine andere Arbeitszeit als achtzig Prozent von zweiundvierzig Stunden. Auch Pausen, Zeiterfassung, Überstunden und Jahresarbeitszeit beeinflussen den Alltag. Bitte um konkrete Angaben statt nur um den Prozentwert. So kannst du Angebote vergleichen und deine Betreuungspflichten oder Weiterbildungen planen.

Besprich die Verteilung der Zeit. Ein reduziertes Pensum kann auf vier volle Tage, fünf kürzere Tage oder ein wechselndes Modell verteilt werden. Prüfe, welche Sitzungen oder Kundentermine zwingend sind und ob dein freier Tag respektiert wird. Bei hybrider Arbeit sollte zusätzlich klar sein, ob Präsenztage proportional reduziert werden. Vereinbarungen funktionieren besser, wenn Team und Führung dieselbe Erwartung kennen.

Der Lohn wird normalerweise proportional zum Vollzeitlohn berechnet. Lass dir deshalb sowohl das Vollzeitäquivalent als auch deinen effektiven Bruttolohn nennen. Dasselbe gilt für variable Vergütung, Ferienanspruch und bestimmte Benefits. Pensionskasse und Koordinationsabzug können bei Teilzeit besondere Auswirkungen haben; für eine persönliche Einschätzung können die Unterlagen der Vorsorgeeinrichtung oder eine unabhängige Fachberatung hilfreich sein.

Frage auch nach dem Arbeitsvolumen. Achtzig Prozent sollten nicht bedeuten, dass dieselben Ziele einfach in weniger Zeit erreicht werden müssen. Gute Vereinbarungen benennen Prioritäten, Erreichbarkeit und Vertretung. Wenn du später erhöhen oder reduzieren möchtest, ist ein regelmässiger Review sinnvoll, aber kein automatischer Anspruch. Halte Pensum, Verteilung und Startregel schriftlich fest. Eine klare Lösung schützt nicht nur deine Freizeit, sondern erleichtert dem gesamten Team die verlässliche Planung im Alltag dauerhaft.`,
  ),
  guide(
    "stellenmeldepflicht-einfach-erklaert",
    "Stellenmeldepflicht einfach erklärt",
    "Eine verständliche Orientierung zur Schweizer Stellenmeldepflicht und zur notwendigen offiziellen Prüfung.",
    `Die Schweizer Stellenmeldepflicht betrifft bestimmte Berufsarten mit erhöhter Arbeitslosigkeit. Arbeitgeber müssen betroffene offene Stellen grundsätzlich der öffentlichen Arbeitsvermittlung melden. Während einer begrenzten Frist erhalten registrierte Stellensuchende einen Informationsvorsprung, bevor die Stelle allgemein veröffentlicht werden darf. Ob eine konkrete Position betroffen ist, hängt nicht allein vom Stellentitel ab, sondern von der offiziellen Zuordnung der Tätigkeit.

Für Arbeitgeber beginnt die Prüfung mit einer möglichst genauen Beschreibung der Aufgaben. Allgemeine Titel wie Projektmitarbeit oder Assistenz können verschiedene Berufsarten abdecken. Deshalb sollte die zuständige Person die tatsächlichen Haupttätigkeiten, Anforderungen und den Arbeitsort zusammentragen und anschliessend das offizielle Prüfangebot verwenden. Ein internes Tool oder eine Plattform kann Hinweise liefern, ersetzt aber keine verbindliche Abklärung bei der zuständigen Behörde.

Es gibt Ausnahmen und besondere Konstellationen. Dazu können sehr kurze Beschäftigungen, interne Besetzungen oder die Anstellung bestimmter bereits im Betrieb tätiger Personen gehören. Die Voraussetzungen müssen im Einzelfall geprüft und dokumentiert werden. Verlasse dich nicht auf eine frühere Einschätzung, denn Listen, Schwellen und Auslegung können sich ändern. Bewahre das Ergebnis, die verwendete Version und den Zeitpunkt der Prüfung nachvollziehbar auf.

Auch Bewerbende können einer gemeldeten Stelle begegnen. Die Meldepflicht ist kein Qualitätsurteil über die Arbeit und keine Aussage über einzelne Kandidatinnen oder Kandidaten. Sie soll die Vermittlung von Stellensuchenden unterstützen. Für den normalen Bewerbungsprozess gelten weiterhin die veröffentlichten Anforderungen, Datenschutzregeln und fairen Auswahlkriterien des Arbeitgebers.

SwissTalentHub verwendet in der Demo ausschliesslich fiktive Klassifikationen, um mögliche Abläufe und unklare Ergebnisse zu zeigen. Diese Daten sind keine amtliche Liste und keine Rechtsberatung. Bei einem Ergebnis wie „unklar“ oder bei widersprüchlichen Tätigkeiten ist die richtige nächste Handlung immer eine offizielle Prüfung. Gute Prozesse machen diese Unsicherheit sichtbar, blockieren eine voreilige Veröffentlichung und speichern nur die nötige, datierte Entscheidungsgrundlage. Verantwortliche sollten die amtliche Bestätigung ausserdem mit dem Inserat verknüpfen und bei einer wesentlichen Aufgabenänderung erneut offiziell mit gebotener Sorgfalt beurteilen lassen.`,
  ),
  guide(
    "ghosting-im-bewerbungsprozess-reduzieren",
    "Wie du Ghosting im Bewerbungsprozess reduzierst",
    "Praktische Vereinbarungen und respektvolle Nachfasspunkte für Bewerbende und Arbeitgeber.",
    `Ghosting entsteht, wenn eine Seite ohne klare Rückmeldung aus dem Bewerbungsprozess verschwindet. Vollständig verhindern lässt es sich nicht, doch verbindliche Erwartungen reduzieren Unsicherheit deutlich. Bereits beim ersten Kontakt sollten Arbeitgeber die nächsten Schritte, zuständige Kontaktperson und einen realistischen Zeitrahmen nennen. Bewerbende können ihrerseits bestätigen, bis wann sie Unterlagen senden oder eine Entscheidung mitteilen.

Nach einem Gespräch ist eine kurze Zusammenfassung hilfreich. Sie muss nicht formell sein: Ein Dank, das bestätigte Interesse und der vereinbarte Rückmeldetermin genügen. Wenn kein Termin genannt wurde, darfst du freundlich danach fragen. Notiere dir das Datum und warte eine angemessene Frist. Eine einzelne, klare Nachricht wirkt professioneller als mehrere Nachfragen in kurzen Abständen.

Arbeitgeber sollten auch dann informieren, wenn sich intern etwas verzögert. Eine Zwischenmeldung ohne endgültige Entscheidung ist besser als Schweigen, sofern sie ehrlich bleibt. Automatische Eingangsbestätigungen können Orientierung geben, ersetzen aber keine individuelle Rückmeldung nach einem Gespräch. Absagen sollten respektvoll, zeitnah und frei von unnötigen persönlichen Bewertungen sein. Wo möglich, hilft ein kurzer sachlicher Hinweis zum Auswahlentscheid.

Als bewerbende Person kannst du einen Prozess beenden, wenn du dich anders entscheidest. Teile dies knapp mit, statt Termine verstreichen zu lassen. Du musst keine ausführliche Rechtfertigung liefern. Wenn ein Unternehmen trotz vereinbartem Termin nicht antwortet, sende eine letzte Nachricht mit einer klaren Bitte um Status. Danach kannst du den Prozess für dich abschliessen und deine Energie auf andere Möglichkeiten richten.

Technische Werkzeuge unterstützen Verbindlichkeit, wenn sie richtig eingesetzt werden. Statusanzeigen, Erinnerungen und dokumentierte Zeitziele helfen Teams, offene Antworten nicht zu vergessen. Sie dürfen jedoch keine garantierte Reaktionszeit vortäuschen, wenn dafür keine ausreichenden Daten vorliegen. Entscheidend bleibt eine Kultur, in der Rückmeldungen als Teil guter Zusammenarbeit gelten. Ein sauberer Abschluss schützt die Zeit aller Beteiligten und hinterlässt selbst bei einer Absage einen professionellen Eindruck. Klare Zuständigkeiten machen diese Haltung im täglichen Prozess zuverlässig, dauerhaft und für alle sichtbar.`,
  ),
  guide(
    "lohntransparenz-bessere-bewerbungen",
    "Wie Arbeitgeber mit Lohntransparenz bessere Bewerbungen erhalten",
    "Warum nachvollziehbare Lohnbänder die Passung verbessern und wie Unternehmen sie glaubwürdig formulieren.",
    `Ein transparentes Lohnband hilft Bewerbenden zu beurteilen, ob eine Stelle zu ihren Erwartungen passt. Für Arbeitgeber sinkt dadurch das Risiko, erst spät im Prozess eine grundlegende Differenz zu entdecken. Gute Transparenz besteht jedoch nicht nur aus zwei Zahlen. Sie erklärt, worauf sich das Band bezieht, wie die Einstufung erfolgt und welche weiteren Bestandteile zum Gesamtpaket gehören.

Beginnen Sie intern mit einer klaren Rollenbewertung. Aufgaben, Verantwortung, Erfahrung und Einfluss sollten wichtiger sein als der bisherige Lohn einer Person. Prüfen Sie bestehende Mitarbeitende in vergleichbaren Funktionen, damit ein neues Band keine unbeabsichtigten Ungleichheiten verstärkt. Wenn die Datenlage klein oder unsicher ist, kennzeichnen Sie Annahmen und vermeiden Sie den Eindruck wissenschaftlicher Genauigkeit.

Im Inserat sollten Währung, Bruttozeitraum, Vollzeitbezug und Anzahl Monatslöhne erkennbar sein. Bei einem Pensum von achtzig bis hundert Prozent nennen Sie idealerweise das Vollzeitband und erklären die proportionale Berechnung. Variable Vergütung gehört separat ausgewiesen, inklusive realistischer Bedingungen. Ein sehr breites Band ohne Einstufungslogik wirkt weniger transparent als eine begründete, engere Spanne.

Bereiten Sie Führungskräfte auf Rückfragen vor. Sie sollten erklären können, welche Kompetenzen zum unteren, mittleren oder oberen Bereich führen. Aussagen wie „je nach Erfahrung“ werden erst glaubwürdig, wenn Beispiele folgen. Dokumentieren Sie die Entscheidung nach denselben Kriterien für alle Kandidaturen. Transparenz bedeutet nicht, dass jede Person am oberen Ende startet; sie verlangt eine konsistente und nachvollziehbare Begründung.

Beobachten Sie anschliessend die Wirkung. Relevant sind nicht nur mehr Bewerbungen, sondern passendere Bewerbungen, weniger späte Absagen und eine faire interne Entwicklung. Kleine Fallzahlen dürfen nicht überinterpretiert werden. Kombinieren Sie quantitative Hinweise mit Rückmeldungen aus Gesprächen und überprüfen Sie das Band regelmässig. Lohntransparenz ist kein einmaliges Kommunikationsprojekt, sondern Teil einer verlässlichen Vergütungspraxis. Richtig umgesetzt stärkt sie Vertrauen, spart Zeit und eröffnet früh ein sachliches Gespräch über gegenseitige Erwartungen. Auch bestehende Mitarbeitende sollten Änderungen nachvollziehen und Fragen in einem geschützten Rahmen offen stellen können.`,
  ),
]);

function guide(
  slug: string,
  title: string,
  excerpt: string,
  body: string,
): DemoGuideFixture {
  return Object.freeze({
    canonicalPath: `/ratgeber/${slug}`,
    excerpt,
    locale: "de-CH" as const,
    slug,
    title,
    type: "GUIDE" as const,
    body,
  });
}

export function countGuideWords(body: string): number {
  return body.trim().split(/\s+/u).filter(Boolean).length;
}
