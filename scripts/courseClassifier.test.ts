/**
 * Tests fuer die Kurs-Zuordnung (Skills + Zielrollen).
 * Ausfuehren: npx tsx --test scripts/tests/courseClassifier.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { classifyCourse, suggestBereiche, suggestSkills, titleKey } from "../../src/data/courseClassifier";
import { matchSkills, searchTermsFor } from "../../src/data/skillMatcher";
import { SKILLS_CATALOG } from "../../src/data/rolesCatalog";

test("Matcher findet Skills auch ueber ihren Namen, nicht nur ueber Aliase", () => {
  const uf = SKILLS_CATALOG.find((s) => s.skill_id === "unternehmensfuehrung")!;
  assert.ok(searchTermsFor(uf).includes("Unternehmensführung"));
  assert.ok(matchSkills("Modul 3: Unternehmensführung", { minScore: 100 }).some((m) => m.skill_id === "unternehmensfuehrung"));
  // Verneinung wirkt weiterhin
  assert.ok(!matchSkills("keine Kenntnisse in Unternehmensführung noetig", { minScore: 100 }).some((m) => m.skill_id === "unternehmensfuehrung"));
});

test("Titel-Schluessel: Gender-Formen, IHK, Gepruefte/r werden vereinheitlicht", () => {
  assert.equal(titleKey("Geprüfte/r Industriefachwirt/in (IHK)"), "industriefachwirt");
  assert.equal(titleKey("Industriefachwirtin IHK"), "industriefachwirt");
  assert.equal(titleKey("Personalfachkaufmann/-frau (IHK)"), "personalfachkaufmann");
  assert.equal(titleKey("Personalfachkauffrau IHK"), "personalfachkaufmann");
});

test("Zielrolle ueber den Kurstitel (typische Weiterbildung), mit Begruendung", () => {
  const r = classifyCourse({ title: "Personalfachkauffrau IHK", description: "Personalbeschaffung, Arbeitsrecht, Personalentwicklung und Lohnabrechnung." });
  assert.equal(r.roles[0].role_name, "Personalreferent/in");
  assert.equal(r.roles[0].confidence, "hoch");
  assert.match(r.roles[0].reason, /Personalfachkaufmann\/-frau \(IHK\)/);
  assert.equal(r.roles[0].title_match, true);
});

test("Zielrolle ueber Skill-Abdeckung, wenn der Titel keine Rolle nennt", () => {
  const r = classifyCourse({
    title: "Data Analytics mit Power BI und SQL",
    description: "Datenanalyse mit SQL und Power BI.",
    learningGoals: ["SQL-Abfragen schreiben", "Dashboards mit Power BI erstellen", "Datenvisualisierung", "Statistik-Grundlagen"],
  });
  assert.equal(r.roles[0].role_id, r.roles.find((x) => /Datenanalyst/.test(x.role_name))?.role_id);
  assert.equal(r.roles[0].title_match, false);
  assert.match(r.roles[0].reason, /Kern-Skills/);
  assert.ok(!/%/.test(r.roles[0].reason), "keine Prozentangaben in der Begruendung");
});

test("Voraussetzungen sind keine Kurs-Skills", () => {
  const { skills, excluded } = suggestSkills({
    title: "Power BI Grundlagen",
    description: "Sie erstellen Berichte in Power BI. Voraussetzung: Excel-Grundkenntnisse.",
    prerequisites: "Excel-Grundkenntnisse",
  });
  assert.ok(skills.some((s) => s.name === "Power BI"));
  assert.ok(!skills.some((s) => s.name === "Excel"));
  assert.ok(excluded.some((s) => s.name === "Excel"));
});

test("Allgemeine Begriffe bleiben unsichere Vorschlaege; jede Empfehlung hat einen Beleg", () => {
  const { skills } = suggestSkills({ title: "Staplerschein", description: "Ausbildung zum Gabelstaplerfahrer nach DGUV Grundsatz 308-001." });
  const generic = skills.find((s) => s.skill_id === "ausbildung");
  if (generic) assert.equal(generic.confidence, "niedrig");
  for (const s of skills) assert.ok(s.evidence.length > 0);
});

test("Kein Rollenvorschlag ohne ausreichenden Beleg", () => {
  const r = classifyCourse({ title: "Excel für Einsteiger", description: "Formeln, Pivot-Tabellen, Diagramme." });
  assert.equal(r.roles.length, 0);
});

test("Dieselbe Fundstelle erzeugt keine doppelten Skills", () => {
  const { skills } = suggestSkills({ title: "Führungskräfte-Training", description: "Grundlagen der Personalführung für neue Teamleitungen." });
  const pf = skills.filter((s) => s.name.startsWith("Personalführung"));
  assert.ok(pf.length <= 1, pf.map((s) => s.name).join(", "));
});

// ---------------------------------------------------------------------------
// Realistische Kursbeispiele aus typischen Bereichen (Titel + kurze Inhalte,
// wie sie der URL-Import liefert). Erwartet wird die passende Zielrolle an
// erster Stelle - mit Begruendung, ohne Prozentangaben.
// ---------------------------------------------------------------------------
const REAL_CASES: { title: string; description: string; learningGoals?: string[]; prerequisites?: string; expectedRole: string; titleMatch: boolean }[] = [
  { title: "Geprüfte/r Bilanzbuchhalter/in (IHK)", description: "Jahresabschluss nach HGB und IFRS, Steuerbilanz, Konsolidierung.", expectedRole: "Bilanzbuchhalter/in", titleMatch: true },
  { title: "Umschulung Fachinformatiker/in für Systemintegration", description: "Netzwerke, Linux, Windows Server, IT-Sicherheit.", expectedRole: "IT-Supporter/in (1st-/2nd-Level-Support)", titleMatch: true },
  { title: "Social-Media-Manager/in (IHK)", description: "Content-Planung, Community Management, Kampagnen.", expectedRole: "Social-Media-Manager/in", titleMatch: true },
  { title: "Sachkundeprüfung nach § 34a GewO", description: "Rechtsgrundlagen, Umgang mit Menschen, Unfallverhütung.", expectedRole: "Sicherheitsmitarbeiter/in", titleMatch: true },
  { title: "Qualifizierung zusätzliche Betreuungskraft nach § 53b SGB XI", description: "Betreuung von Menschen mit Demenz.", expectedRole: "Alltagsbegleiter/in (Betreuungskraft)", titleMatch: true },
  { title: "Wirtschaftsfachwirt IHK", description: "Volks- und Betriebswirtschaft, Unternehmensführung, Controlling.", expectedRole: "Kaufmännische/r Teamleiter/in", titleMatch: true },
  { title: "Staplerschein", description: "Ausbildung zum Gabelstaplerfahrer nach DGUV Grundsatz 308-001 inkl. Prüfung.", expectedRole: "Gabelstaplerfahrer/in", titleMatch: true },
  { title: "Schweißkurs MAG nach DIN EN ISO 9606", description: "Praktische Schweißausbildung MAG.", expectedRole: "Schweißer/in", titleMatch: false },
  { title: "Agiles Projektmanagement mit Scrum", description: "Scrum, Kanban, Projektplanung, Stakeholdermanagement, Risikomanagement.", expectedRole: "Projektmanager/in", titleMatch: false },
  {
    title: "Geprüfte/r Industriefachwirt/in (IHK) – berufsbegleitend",
    description: "Vorbereitung auf die IHK-Prüfung.",
    learningGoals: ["Volks- und Betriebswirtschaft", "Rechnungswesen", "Unternehmensführung", "Produktionsplanung", "Materialwirtschaft"],
    prerequisites: "Abgeschlossene kaufmännische Ausbildung",
    expectedRole: "Produktionsplaner/in",
    titleMatch: true,
  },
];

for (const c of REAL_CASES) {
  test(`Realer Fall: ${c.title}`, () => {
    const r = classifyCourse({ title: c.title, description: c.description, learningGoals: c.learningGoals, prerequisites: c.prerequisites });
    assert.ok(r.roles.length > 0, "mindestens ein Rollenvorschlag");
    assert.equal(r.roles[0].role_name, c.expectedRole, r.roles.map((x) => x.role_name).join(", "));
    assert.equal(r.roles[0].title_match, c.titleMatch);
    assert.ok(r.roles[0].reason.length > 10 && !/%/.test(r.roles[0].reason));
    for (const s of r.skills) assert.ok(s.evidence.length > 0, `Beleg fehlt bei ${s.name}`);
  });
}

test("Gleichnamige Katalog-Skills erscheinen nur einmal", () => {
  const { skills } = suggestSkills({ title: "Kaufmann/-frau für Büromanagement – Teilqualifizierung", description: "Büroorganisation, Terminplanung, Korrespondenz." });
  const names = skills.map((s) => s.name);
  assert.equal(names.length, new Set(names).size, names.join(", "));
});

test("Geschwindigkeit: Einordnung eines typischen Kurses dauert unter 500 ms", () => {
  const long = Array.from({ length: 30 }, (_, i) => `Modul ${i + 1}: Rechnungswesen, Controlling, Personalführung und Projektmanagement in der Praxis.`).join("\n");
  const t = performance.now();
  classifyCourse({ title: "Geprüfte/r Industriefachwirt/in (IHK)", description: long, learningGoals: long.split("\n") });
  assert.ok(performance.now() - t < 500, `${Math.round(performance.now() - t)} ms`);
});

// Echter Fall vom 25.09.2026: https://www.ihk-akademie-mittelfranken.de/weiterbildungen/details/ki-manager-ihk-1809
// Vorher: falsche Zielrollen/Bereiche, u. a. "Pflegerische Versorgung von Kindern"
// (Alias "Wickeln" steckte in "entwickeln"), und der Katalog kannte keine KI-Skills.
test("Realer Fall: KI-Manager/-in (IHK), IHK Akademie Mittelfranken", () => {
  const r = classifyCourse({
    title: "KI-Manager/-in (IHK)",
    description:
      "Der Lehrgang vermittelt Fach- und Führungskräften die strategische Bedeutung der KI für die zukünftige Entwicklung des Unternehmens. Absolventen identifizieren Anwendungsfelder, entwickeln KI-Roadmaps und wirken als Multiplikatoren.",
    learningGoals: [
      "KI als transformative Technologie",
      "Wie funktioniert KI? Maschinelles Lernen und neuronale Netze",
      "Innovationspotenzial im Unternehmen – Einsätze in Marketing, Logistik, Finanzen, Produktion",
      "Generative KI im Unternehmen – Praktische Anwendung von KI-Tools",
      "Einführungsplanung – Voraussetzungen für nachhaltige KI-Integration",
      "Anwendungsfälle finden und bewerten",
      "Implementierung und Betrieb – Projektmanagement und Prozessmodelle",
    ],
    prerequisites: "Keine KI-Vorkenntnisse erforderlich",
  });
  assert.equal(r.roles[0].role_id, "it-tech-ki-manager-ihk");
  assert.equal(r.roles[0].confidence, "hoch");
  const names = r.skills.map((s) => s.name);
  for (const expected of ["KI-Strategie und Roadmap", "Generative KI anwenden", "KI-Anwendungsfälle identifizieren und bewerten", "KI-Einführung und -Implementierung", "Machine Learning"]) {
    assert.ok(names.includes(expected), `${expected} fehlt: ${names.join(", ")}`);
  }
  assert.ok(!names.includes("Pflegerische Versorgung von Kindern"), "Wickeln in entwickeln");
  assert.equal(suggestBereiche(r)[0], "it-tech");
});

// ---------------------------------------------------------------------------
// Breite Abdeckung (25.09.2026): 82 typische Weiterbildungstitel aus allen
// Bereichen, nur der Titel (schwierigster Fall). Vorher bekamen 50 davon
// keine Zielrolle; Ziel: hoechstens 8 ohne Rolle (Sprachkurse u. ae. haben
// bewusst keine Berufsrolle).
// ---------------------------------------------------------------------------
const BROAD_TITLES = `Geprüfte/r Betriebswirt/in (IHK)
Technische/r Fachwirt/in (IHK)
Fachwirt/in im Gesundheits- und Sozialwesen (IHK)
Immobilienfachwirt/in (IHK)
Versicherungsfachmann/-frau (IHK) §34d
Immobilienmakler Sachkunde §34c
Finanzanlagenfachmann/-frau (IHK) §34f
Geprüfte/r Personalfachkaufmann/-frau (IHK)
Datenschutzbeauftragte/r (TÜV)
Fachkraft für Arbeitssicherheit
Sicherheitsbeauftragte/r
Qualitätsmanagementbeauftragte/r ISO 9001
Interne/r Auditor/in ISO 9001
Energieberater/in (HWK)
Solarteur/in Photovoltaik
Elektrofachkraft für festgelegte Tätigkeiten
Wärmepumpen-Installation für SHK-Fachkräfte
Lean Management / Six Sigma Green Belt
SAP S/4HANA Finanzbuchhaltung (FI)
SAP Materialwirtschaft MM
Microsoft Office 365 Grundlagen (Word, Excel, Outlook)
AWS Certified Cloud Practitioner
Microsoft Azure Fundamentals AZ-900
Cyber Security Analyst
Linux Administrator (LPIC-1)
Java Programmierung Grundlagen
Python für Einsteiger
Webentwicklung mit HTML, CSS und JavaScript
UX/UI Design Weiterbildung
Online Marketing Manager (IHK)
Content Marketing und Copywriting
Vertriebsmanager/in B2B
Kundenservice und Beschwerdemanagement
Führungskräftetraining für neue Teamleiter
Systemischer Coach (zertifiziert)
Trainer/in in der Erwachsenenbildung
Praxisanleiter/in in der Pflege (300 Std.)
Pflegedienstleitung (PDL) 460 Std.
Wundexperte ICW
Hygienebeauftragte/r in der Pflege
Betreuungskraft nach §43b und §53b SGB XI
Erzieher/in Weiterbildung Kita-Leitung
Deutsch B2 Berufssprachkurs
Business English B2
Buchhaltung mit DATEV
Lohn- und Gehaltsabrechnung mit DATEV
Steuerfachwirt/in Vorbereitung
Einkauf und Beschaffung Grundlagen
Logistikmeister/in (IHK)
Berufskraftfahrer Weiterbildung Module 95
Staplerfahrer Ausbildung
Kranführer Schulung
CNC-Fachkraft Drehen und Fräsen
SPS-Programmierung Siemens TIA Portal
Schweißen WIG
Industriemeister/in Metall (IHK)
Maschinen- und Anlagenführer Teilqualifizierung
Fachkraft für Lagerlogistik Umschulung
Kaufmann/-frau im E-Commerce Umschulung
Industriekaufmann/-frau Umschulung
Bürokaufmann Umschulung
Verkäufer/in Teilqualifizierung
Gastronomie Service Grundlagen
Koch/Köchin Umschulung
Hotelfachmann Umschulung
Barista Kurs
Erste-Hilfe-Ausbilder
Rettungssanitäter/in
Medizinische/r Fachangestellte/r Umschulung
Zahnmedizinische Verwaltungsassistentin (ZMV)
Pharmareferent/in
Sozialpädagogische Fachkraft Integration
Schulbegleitung Qualifizierung
Projektmanagement IPMA Level D
Scrum Master (PSM I)
Business Analyst (IREB CPRE)
Data Scientist mit Python
Controlling und Kennzahlen
Gebäudereiniger Meister (HWK)
Hausmeister Weiterbildung
Maler und Lackierer Umschulung
Tischler Meister`.split("\n");

test("Breite Abdeckung: mindestens 74 von 82 typischen Weiterbildungen bekommen eine Zielrolle", () => {
  const without = BROAD_TITLES.filter((t) => classifyCourse({ title: t }).roles.length === 0);
  assert.ok(without.length <= 8, `ohne Rolle (${without.length}): ${without.join(" | ")}`);
});

const SPOT_CHECKS: [string, string][] = [
  ["Geprüfte/r Betriebswirt/in (IHK)", "Kaufmännische/r Leiter/in"],
  ["Sicherheitsbeauftragte/r", "Fachkraft für Arbeitssicherheit"],
  ["Kaufmann/-frau im E-Commerce Umschulung", "Kaufmann/-frau im E-Commerce"],
  ["Medizinische/r Fachangestellte/r Umschulung", "Medizinische/r Fachangestellte/r"],
  ["Fachkraft für Lagerlogistik Umschulung", "Fachkraft für Lagerlogistik"],
  ["Erzieher/in Weiterbildung Kita-Leitung", "Kita-Leiter/in"],
  ["Praxisanleiter/in in der Pflege (300 Std.)", "Praxisanleiter/in (Pflege)"],
  ["Gebäudereiniger Meister (HWK)", "Objektleiter/in Gebäudereinigung"],
  ["Staplerfahrer Ausbildung", "Gabelstaplerfahrer/in"],
  ["Datenschutzbeauftragte/r (TÜV)", "Datenschutzbeauftragte/r"],
  ["Immobilienmakler Sachkunde §34c", "Immobilienmakler/in"],
  ["Versicherungsfachmann/-frau (IHK) §34d", "Versicherungsvermittler/in"],
  ["Scrum Master (PSM I)", "Scrum Master / Agile Coach"],
  ["Cyber Security Analyst", "IT-Sicherheitsspezialist/in"],
  ["Bürokaufmann Umschulung", "Kaufmann/-frau für Büromanagement"],
];
for (const [title, role] of SPOT_CHECKS) {
  test(`Stichprobe: ${title} -> ${role}`, () => {
    const r = classifyCourse({ title });
    assert.equal(r.roles[0]?.role_name, role, r.roles.map((x) => x.role_name).join(", "));
  });
}

test("Kurs-Woerter im Titel erzeugen keine Zufallsskills (Schulung/Schalung, Siemens/SIEM)", () => {
  for (const title of ["Kranführer Schulung", "Koch/Köchin Umschulung", "SPS-Programmierung Siemens TIA Portal"]) {
    const names = suggestSkills({ title }).skills.map((s) => s.name);
    assert.ok(!names.includes("Beton- und Schalungsbau"), `${title}: ${names.join(", ")}`);
    assert.ok(!names.includes("SIEM und Log-Analyse"), `${title}: ${names.join(", ")}`);
  }
});