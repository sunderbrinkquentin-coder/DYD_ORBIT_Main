/**
 * Tests fuer die Kurs-Zuordnung (Skills + Zielrollen).
 * Ausfuehren: npx tsx --test scripts/tests/courseClassifier.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { classifyCourse, suggestSkills, titleKey } from "../../src/data/courseClassifier";
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