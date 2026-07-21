export const ADMIN_IMPORT_DEMO_FIXTURES = Object.freeze({
  validJson: JSON.stringify([
    {
      id: "demo-feed-001",
      company: "Zugeordnete Demo-Firma",
      title: "Pflegefachperson Importvorschau",
      workplace_country: "CH",
      zip: "8001",
      city: "Zürich",
      canton: "ZH",
      description:
        "Dieser lizenzierte lokale Demodatensatz bleibt bis zur expliziten Einzelentscheidung eine reine Vorschau.",
      requirements: ["Anerkannter Berufsabschluss", "Deutsch B2"],
      offer: "Planbare Einsätze und dokumentierte Einarbeitung.",
      contact: "jobs@example.invalid",
      application_url: "",
      type: "PERMANENT",
      workload_min: 80,
      workload_max: 100,
      keywords: ["Pflege", "Akut"],
    },
  ]),
  duplicateJson: JSON.stringify([
    {
      id: "duplicate-001",
      company: "Demo-Firma",
      title: "Erster doppelter Datensatz",
      workplace_country: "CH",
      zip: "8001",
      city: "Zürich",
      canton: "ZH",
      description: "Dieser Datensatz besitzt bewusst dieselbe Quell-ID wie der nächste Datensatz.",
    },
    {
      id: "duplicate-001",
      company: "Demo-Firma",
      title: "Zweiter doppelter Datensatz",
      workplace_country: "CH",
      zip: "8001",
      city: "Zürich",
      canton: "ZH",
      description: "Dieser Datensatz muss als doppelte Quell-ID in der Vorschau abgelehnt werden.",
    },
  ]),
  maliciousXml:
    '<!DOCTYPE jobs [<!ENTITY xxe SYSTEM "file:///etc/passwd">]><jobs><job><id>&xxe;</id></job></jobs>',
} as const);
