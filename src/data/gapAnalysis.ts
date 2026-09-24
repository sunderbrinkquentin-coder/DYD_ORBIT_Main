/**
 * Gap-Analyse ohne Python: TypeScript-Portierung von
 * backend/app/services/gap_analysis.py, aufbauend auf skillMatcher.ts und
 * dem eigenen Skill-Katalog (rolesCatalog.ts) statt ESCO.
 *
 * Antwortform ist absichtlich kompatibel zur bestehenden
 * GapAnalysisResponse aus src/api/core.ts (tenant_id, target_role_id,
 * target_role_name, match_percentage, covered_skills, gap_skills mit
 * {esco_uri, preferred_label, weight, covered, matched_score}) — alle NEUEN
 * Felder sind additiv (priority, summary), damit JourneyPage.tsx unverändert
 * weiterläuft und nichts anderswo bricht.
 *
 * WICHTIG zur Feldbenennung: Das Feld heisst weiterhin "esco_uri", enthaelt
 * aber ab jetzt die interne skill_id aus dem eigenen Katalog (z.B. "html"),
 * keine echte ESCO-URI mehr. Bewusste Kompromiss-Entscheidung, um den Umbau
 * auf den neuen Katalog NICHT mit einer Typ-Umbenennung quer durchs ganze
 * Frontend zu verkoppeln.
 *
 * NEU gegenüber der ersten Fassung (siehe Kommentare unten):
 *  1. GEWICHTETER statt binärer Match-Prozentsatz — ein Skill, der nur knapp
 *     über der Score-Schwelle erkannt wurde, zählt jetzt nicht mehr genauso
 *     viel wie ein eindeutiger Treffer.
 *  2. gap_skills nach Wichtigkeit sortiert (höchstes Gewicht zuerst) statt in
 *     Katalog-Reihenfolge — wichtig, weil die UI (Pitch, Vorschau) oft nur
 *     die ersten paar Einträge zeigt.
 *  3. priority ("kern" | "ergaenzend") pro Skill — ABC-Klassifikation nach
 *     kumuliertem Gewicht, damit UI/Pitch zwischen "das brauchst du wirklich"
 *     und "nice to have" unterscheiden können, statt einer flachen Liste.
 *  4. summary — ein kurzer, ehrlicher Einordnungssatz auf Basis des
 *     Prozentsatzes, fertig zum Anzeigen ohne dass die UI selbst Schwellwerte
 *     erfinden muss.
 */

import { ROLES_CATALOG, type CatalogRole } from "./rolesCatalog";
import { matchSkills } from "./skillMatcher";

export interface GapRoleSkillStatus {
  esco_uri: string; // = skill_id, siehe Hinweis oben
  preferred_label: string; // = skill.name
  weight: number;
  covered: boolean;
  matched_score: number | null;
  /** Nur bei gap_skills wirklich unterschieden (siehe classifyPriority) —
   *  bei covered_skills immer "kern", da dort keine Priorisierung nötig ist. */
  priority: "kern" | "ergaenzend";
}

export interface GapAnalysisResult {
  target_role_id: string;
  target_role_name: string;
  /** Gewichteter Match-Prozentsatz, siehe FIX 1 oben — nicht mehr rein
   *  binär "Skill erkannt ja/nein", sondern skaliert mit matched_score. */
  match_percentage: number;
  covered_skills: GapRoleSkillStatus[];
  /** Sortiert nach Gewicht absteigend, siehe FIX 2 oben. */
  gap_skills: GapRoleSkillStatus[];
  /** Kurzer Einordnungssatz, fertig zur Anzeige (siehe FIX 4 oben). */
  summary: string;
}

export interface AnalyzeGapOptions {
  minScore?: number;
  /** Ersetzt den Standard-Rollenkatalog, z.B. fuer Tests. */
  roles?: CatalogRole[];
}

/**
 * ABC-Klassifikation der Gap-Skills: die wichtigsten Skills (höchstes
 * Gewicht zuerst), bis ihr kumuliertes Gewicht 70% des GESAMTEN
 * Lücken-Gewichts erreicht, gelten als "kern" — der Rest als "ergaenzend".
 * 70% ist ein bewusst einfacher, erklärbarer Schwellwert (Pareto-Prinzip),
 * kein Ergebnis eines ML-Modells — im Zweifel lieber zu viele als zu wenige
 * Skills als "kern" einstufen, damit nichts Wichtiges als Nebensache
 * erscheint. Bei ≤3 Gap-Skills gilt ohnehin alles als "kern" (kein Sinn,
 * bei so wenigen Lücken schon zu unterteilen).
 */
function classifyPriority(sorted: { weight: number }[]): ("kern" | "ergaenzend")[] {
  if (sorted.length <= 3) return sorted.map(() => "kern" as const);
  const totalWeight = sorted.reduce((sum, s) => sum + s.weight, 0);
  const cutoff = totalWeight * 0.7;
  let running = 0;
  return sorted.map((s) => {
    const wasBelowCutoff = running < cutoff;
    running += s.weight;
    return wasBelowCutoff ? ("kern" as const) : ("ergaenzend" as const);
  });
}

function buildSummary(roleName: string, matchPercentage: number, kernGapCount: number): string {
  if (matchPercentage >= 80) {
    return kernGapCount === 0
      ? `Du bringst bereits alle Kernskills für ${roleName} mit.`
      : `Du bringst schon fast alles für ${roleName} mit — nur noch ${kernGapCount} Kernskill${kernGapCount === 1 ? "" : "s"} fehlen zur vollen Passung.`;
  }
  if (matchPercentage >= 50) {
    return `Du bringst eine solide Basis für ${roleName} mit — mit gezielter Weiterbildung schließt du die wichtigsten Lücken schnell.`;
  }
  return `Für ${roleName} fehlen dir aktuell noch mehrere Kernskills — eine strukturierte Weiterbildung würde hier spürbar helfen.`;
}

/** TS-Entsprechung von analyze_gap() aus gap_analysis.py, erweitert um
 *  gewichteten Score, Priorisierung und Zusammenfassung (siehe FIX 1-4 oben). */
export function analyzeGap(
  text: string,
  targetRoleId: string,
  opts: AnalyzeGapOptions = {}
): GapAnalysisResult | null {
  const minScore = opts.minScore ?? 60.0;
  const roles = opts.roles ?? ROLES_CATALOG;

  const role = roles.find((r) => r.role_id === targetRoleId);
  if (!role) return null;

  // Alle Skills matchen, die im Profiltext erkennbar sind (grosszuegiges
  // Limit, damit auch entferntere Rollen-Skills erfasst werden) — wie im
  // Python-Original.
  const profileMatches = new Map<string, number>();
  for (const m of matchSkills(text, { maxResults: 100, minScore })) {
    profileMatches.set(m.skill_id, m.score);
  }

  const coveredBase: Omit<GapRoleSkillStatus, "priority">[] = [];
  const gapBase: Omit<GapRoleSkillStatus, "priority">[] = [];
  let totalWeight = 0;
  let coveredWeightedShare = 0;

  for (const required of role.skills) {
    totalWeight += required.weight;

    const base = {
      esco_uri: required.skill_id,
      preferred_label: required.name,
      weight: required.weight,
    };

    const score = profileMatches.get(required.skill_id);
    if (score !== undefined) {
      // FIX 1 — gewichteter statt binärer Anteil: ein Skill, der nur mit
      // Score 61 erkannt wurde, zählt fast nichts; einer mit Score 100 voll.
      coveredWeightedShare += required.weight * (score / 100);
      coveredBase.push({ ...base, covered: true, matched_score: score });
    } else {
      gapBase.push({ ...base, covered: false, matched_score: null });
    }
  }

  // FIX 2 — Gap-Skills nach Gewicht absteigend sortieren, wichtigste Lücken
  // zuerst (Katalog-Reihenfolge war bisher Zufall aus Sicht der Wichtigkeit).
  gapBase.sort((a, b) => b.weight - a.weight);
  coveredBase.sort((a, b) => b.weight - a.weight);

  // FIX 3 — Priorisierung der Lücken.
  const gapPriorities = classifyPriority(gapBase);
  const gapSkills: GapRoleSkillStatus[] = gapBase.map((s, i) => ({ ...s, priority: gapPriorities[i] }));
  const coveredSkills: GapRoleSkillStatus[] = coveredBase.map((s) => ({ ...s, priority: "kern" as const }));

  const matchPercentage = totalWeight > 0 ? Math.round((coveredWeightedShare / totalWeight) * 1000) / 10 : 0;
  const kernGapCount = gapSkills.filter((s) => s.priority === "kern").length;

  return {
    target_role_id: role.role_id,
    target_role_name: role.role_name,
    match_percentage: matchPercentage,
    covered_skills: coveredSkills,
    gap_skills: gapSkills,
    summary: buildSummary(role.role_name, matchPercentage, kernGapCount),
  };
}

/** Eine per suggestRolesForSkillIds() vorgeschlagene Rolle mit echtem,
 *  berechnetem Match-Prozentsatz (siehe dort). */
export interface RoleSuggestion {
  role_id: string;
  role_name: string;
  match_percentage: number;
  covered_skill_count: number;
  required_skill_count: number;
}

/** Kehrt analyzeGap() um: statt fuer EINE feststehende Rolle den Match-
 *  Prozentsatz zu berechnen, berechnet diese Funktion ihn fuer ALLE Rollen
 *  im Katalog und liefert die besten Treffer sortiert zurueck. Grundlage
 *  fuer "wir schlagen dir passende Rollen vor" im "ich kenne meine
 *  Zielrolle noch nicht"-Pfad der Journey (siehe RoleSuggestStep in
 *  JourneyPage.tsx).
 *
 *  Nimmt bewusst eine MENGE EXAKTER Skill-IDs entgegen (aus Klicks auf
 *  Skill-Checkboxen, siehe topSkillsForRoles()) statt eines Freitexts
 *  (erste Fassung dieser Funktion, 14.09., per Nutzer-Feedback "sollte
 *  durchklickbar sein" verworfen) — kein Fuzzy-Matching noetig, da eine
 *  angeklickte Auswahl bereits eindeutig ist. Die gewichtete Score-Formel
 *  selbst ist dieselbe wie in analyzeGap() (siehe dort FIX 1: Anteil am
 *  Gesamtgewicht der Rolle), nur dass ein exakt getroffener Skill immer mit
 *  vollem Gewicht zaehlt statt mit einem Fuzzy-Score skaliert zu werden —
 *  damit ein hier gezeigter Prozentwert weiterhin genau dem entspricht, was
 *  bei denselben Skills im spaeteren Fragebogen-Pfad (submitQuizMethod)
 *  herauskaeme. minMatchPercentage filtert offensichtlich irrelevante
 *  Rollen (z.B. 0%) aus den Vorschlaegen heraus. */
export function suggestRolesForSkillIds(
  skillIds: ReadonlySet<string>,
  opts: AnalyzeGapOptions & { limit?: number; minMatchPercentage?: number } = {}
): RoleSuggestion[] {
  if (skillIds.size === 0) return [];
  const roles = opts.roles ?? ROLES_CATALOG;
  const limit = opts.limit ?? 5;
  const minMatchPercentage = opts.minMatchPercentage ?? 5;

  const scored: RoleSuggestion[] = [];
  for (const role of roles) {
    let totalWeight = 0;
    let coveredWeightedShare = 0;
    let coveredCount = 0;
    for (const required of role.skills) {
      totalWeight += required.weight;
      if (skillIds.has(required.skill_id)) {
        coveredWeightedShare += required.weight;
        coveredCount++;
      }
    }
    const matchPercentage = totalWeight > 0 ? Math.round((coveredWeightedShare / totalWeight) * 1000) / 10 : 0;
    if (matchPercentage >= minMatchPercentage) {
      scored.push({
        role_id: role.role_id,
        role_name: role.role_name,
        match_percentage: matchPercentage,
        covered_skill_count: coveredCount,
        required_skill_count: role.skills.length,
      });
    }
  }
  scored.sort((a, b) => b.match_percentage - a.match_percentage);
  return scored.slice(0, limit);
}

/** Eine anklickbare Skill-Option fuer RoleSuggestStep (JourneyPage.tsx). */
export interface SkillChip {
  skill_id: string;
  name: string;
}

/** Liefert die im gegebenen Rollen-Ausschnitt insgesamt wichtigsten Skills
 *  (Summe der Gewichte ueber alle diese Rollen, absteigend) — rein aus den
 *  echten Rollendaten abgeleitet, keine Hand-Kuratierung, damit die
 *  Chip-Liste automatisch konsistent bleibt, wenn sich der Katalog
 *  aendert. Grundlage fuer die anklickbaren Skill-Checkboxen in
 *  RoleSuggestStep — bewusst OHNE Bezug zu einer einzelnen Rolle (anders
 *  als roleSkills im spaeteren Fragebogen-Schritt), da hier ja noch gar
 *  keine Rolle feststeht. */
export function topSkillsForRoles(roles: CatalogRole[], limit = 24): SkillChip[] {
  const totals = new Map<string, { name: string; weight: number }>();
  for (const role of roles) {
    for (const s of role.skills) {
      const entry = totals.get(s.skill_id);
      if (entry) entry.weight += s.weight;
      else totals.set(s.skill_id, { name: s.name, weight: s.weight });
    }
  }
  return [...totals.entries()]
    .sort((a, b) => b[1].weight - a[1].weight)
    .slice(0, limit)
    .map(([skill_id, v]) => ({ skill_id, name: v.name }));
}

/** Ein anklickbarer, grober Berufsbereich fuer RoleSuggestStep — Werte
 *  kommen direkt aus den echten bereich_key/bereich_label-Feldern der
 *  Rollen (siehe CatalogRole), nicht aus einer separat gepflegten Liste
 *  (die fruehere AREAS-Konstante in JourneyPage.tsx konnte dadurch
 *  ersatzlos entfallen — Drift zwischen beiden Listen war so gar nicht erst
 *  moeglich). */
export interface BereichOption {
  key: string;
  label: string;
  roleCount: number;
}

/** Nur Rollen, deren Bereich im Kursportfolio des Tenants tatsaechlich
 *  belegt ist (coveredBereiche, siehe getCoveredBereiche() in
 *  courseMatcher.ts) — verhindert, dass in ZielrolleStep/RoleSuggestStep
 *  Bereiche/Rollen zur Auswahl stehen, fuer die der Bildungstraeger gar
 *  keine Kurse im Katalog hat ("leere Bereiche", Feedback 15.09.).
 *
 *  FINALE Fassung (ersetzt zwei vorherige, verworfene Versuche ueber
 *  Skill-Ueberschneidung bzw. optionales target_role_id — beide filterten
 *  bei Quentins echten Testkursen alles auf null, weil dort keinem Kurs
 *  eine Skill-/Zielrollen-Zuordnung hinterlegt war): Bereich ist seit
 *  diesem Feature PFLICHTFELD im Kursformular (siehe bereich_key in
 *  orbit.ts + Validierung in DashboardPage.tsx handleAddCourse), also die
 *  einzige zuverlaessige, immer vorhandene Zuordnung — kein Ableiten mehr
 *  aus optionalen Feldern noetig.
 *
 *  Ist coveredBereiche leer (Kurskatalog laedt noch, oder noch kein Kurs
 *  hat einen Bereich — z.B. direkt nach diesem Feature-Rollout, bevor
 *  Altkurse nachgepflegt sind), wird NICHT alles ausgeblendet, sondern der
 *  volle Katalog gezeigt — sonst waere die Auswahl waehrend dieses
 *  Uebergangs faelschlich komplett leer. Sobald mindestens ein Kurs einen
 *  Bereich hat, wird ab dann strikt gefiltert. */
export function rolesWithBereichCoverage(
  coveredBereiche: ReadonlySet<string>,
  roles: CatalogRole[] = ROLES_CATALOG
): CatalogRole[] {
  if (coveredBereiche.size === 0) return roles;
  return roles.filter((r) => coveredBereiche.has(r.bereich_key));
}

/** Alle im Katalog tatsaechlich vorkommenden Bereiche, dedupliziert. */
export function listBereiche(roles: CatalogRole[] = ROLES_CATALOG): BereichOption[] {
  const map = new Map<string, { label: string; count: number }>();
  for (const r of roles) {
    const entry = map.get(r.bereich_key);
    if (entry) entry.count++;
    else map.set(r.bereich_key, { label: r.bereich_label, count: 1 });
  }
  return [...map.entries()].map(([key, v]) => ({ key, label: v.label, roleCount: v.count }));
}

/** Liefert alle Rollen eines Bereichs — ersetzt die bisherige
 * Keyword-Heuristik roleMatchesArea() in JourneyPage.tsx, sobald die
 * Rollenliste aus diesem Katalog (bzw. spaeter der DB) statt aus dem
 * bisherigen 4-Rollen-Datensatz kommt. Echte bereich_key-Zuordnung statt
 * Raten am Rollennamen. */
export function rolesByArea(areaKey: string, roles: CatalogRole[] = ROLES_CATALOG): CatalogRole[] {
  return roles.filter((r) => r.bereich_key === areaKey);
}

/** Kurzfassung einer Rolle im gleichen Format wie die bisherige
 * TargetRole aus src/api/core.ts. */
export function toTargetRoleSummary(role: CatalogRole): { role_id: string; role_name: string; required_skill_count: number } {
  return { role_id: role.role_id, role_name: role.role_name, required_skill_count: role.skills.length };
}

/** Bildet das im Ziel-Schritt gewählte careerGoal (siehe GOAL_OPTIONS in
 *  JourneyPage.tsx) auf ein echtes CatalogRole["level"] ab — nur fuer die
 *  zwei Ziele, fuer die es ein ehrliches, im Katalog tatsaechlich
 *  vorhandenes Gegenstück gibt ("fuehrung" -> Rollen mit level "Führung",
 *  "knowhow"/fachliche Tiefe -> Rollen mit level "Senior"). Die anderen
 *  Ziele (geld, neuorientierung, sicherheit) haben keine ehrliche
 *  Level-Entsprechung und bleiben hier bewusst aussen vor. */
const BEREICH_ROLE_GOAL_LEVEL: Partial<Record<string, CatalogRole["level"]>> = {
  fuehrung: "Führung",
  knowhow: "Senior",
};

/**
 * Synthetische "Bereichs-Rolle" (15.09., Antwort auf "der Prozess muss
 * danach weiterlaufen ohne die Verknüpfung zu einer spezifischen
 * Zielposition"): vereinigt die Skills der Rollen der gewählten Bereiche zu
 * EINER Pseudo-Rolle, statt sich auf eine einzelne, konkrete Zielrolle
 * festzulegen — Gewicht je Skill ist der Durchschnitt über alle
 * einbezogenen Rollen, renormiert auf Summe 100 (gleiche Form wie eine echte
 * CatalogRole, damit analyzeGap()/matchCoursesToGap() sie unverändert über
 * ihren roles-Override nutzen können, siehe AnalyzeGapOptions.roles).
 *
 * NEU (15.09., "ich will, dass man sein Ziel mit den Bereichen/Branchen
 * verbindet und auf dieser Basis dann die Vorschläge der Weiterbildungen
 * bekommt" — UND "der User soll nicht die Rollen selber auswählen müssen"):
 * `goal` (careerGoal aus dem allerersten Ziel-Schritt) wird jetzt nicht mehr
 * nur als Gewichtungs-Bonus eingerechnet, sondern FILTERT die Rollen, aus
 * denen sich die Bereichs-Rolle zusammensetzt — echte Verbindung statt
 * Verwässerung. Nur fuer die zwei Ziele mit einem ehrlichen, im Katalog
 * tatsaechlich vorhandenen Gegenstück (BEREICH_ROLE_GOAL_LEVEL: "fuehrung"
 * -> Rollen mit level "Führung", "knowhow"/fachliche Tiefe -> Rollen mit
 * level "Senior"): gibt es im gewählten Bereich mindestens eine Rolle auf
 * diesem Level, fliessen NUR deren Skills ein — "Führung" + "Wirtschaft"
 * liefert dann wirklich nur die Skills der Führungsrollen in Wirtschaft,
 * nicht mehr ein verwässerter Durchschnitt über alle Level. Ehrlicher
 * Fallback (keine Sackgasse): hat der Bereich gar keine Rolle auf dem
 * passenden Level, zaehlen alle Rollen des Bereichs wie zuvor. Die anderen
 * drei Ziele (geld, neuorientierung, sicherheit) haben kein ehrliches
 * Level-Gegenstück im Katalog — fuer die bleibt es beim ganzen Bereich als
 * Basis, das Ziel wirkt dort weiterhin nur beim Kurs-Tiebreak/der
 * Begründung (siehe goalFitReason/personalizeCourseOrder in
 * JourneyPage.tsx). Der Nutzer sieht von alldem nichts — keine Rollenkarte,
 * keine Rollen-Auswahl, nur Ziel + Bereich (siehe RoleSuggestStep).
 *
 * role_id trägt bewusst das Präfix "bereich:" (mit sortierten Bereichs-Keys
 * plus, falls vorhanden, dem goal-Suffix, für stabile Gleichheit egal in
 * welcher Klick-Reihenfolge gewählt wurde, aber unterscheidbar bei
 * unterschiedlichem Ziel) — kann nie mit einer echten role_id aus
 * ROLES_CATALOG kollidieren. Diese Pseudo-Rolle landet NIE in ROLES_CATALOG
 * selbst und wird nirgends als "deine Zielrolle X" angezeigt — sie ist reine
 * interne Rechengrundlage (Gap-Skills/Kursempfehlung), siehe selectBereich()
 * in JourneyPage.tsx.
 */
export function buildBereichRole(
  bereichKeys: string[],
  roles: CatalogRole[] = ROLES_CATALOG,
  goal: string | null = null
): CatalogRole {
  const sortedKeys = [...bereichKeys].sort();
  const allRolesInBereich = roles.filter((r) => sortedKeys.includes(r.bereich_key));
  // Rollen-Erweiterung 24.09.2026: Helferberufe (anforderungsniveau 1, z. B.
  // Lagerhelfer/in, Küchenhilfe) sind typische AUSGANGS-, nicht Ziel-Rollen
  // einer Weiterbildung. Im Bereichs-Durchschnitt wuerden ihre einfachen
  // Skills (Kommissionierung, Regalpflege …) die Fragen und Kursempfehlungen
  // wieder "zu allgemein" machen — genau der Effekt, der am 22.09. gemeldet
  // wurde. Deshalb zaehlen sie hier nicht mit. Ehrlicher Fallback: besteht
  // ein Bereich (theoretisch) nur aus Helferrollen, zaehlen sie doch.
  // Rollen ohne anforderungsniveau (Alt-/Tenant-Rollen) zaehlen immer.
  const nonHelperRoles = allRolesInBereich.filter((r) => r.anforderungsniveau !== 1);
  const baseRoles = nonHelperRoles.length > 0 ? nonHelperRoles : allRolesInBereich;
  const goalLevel = goal ? BEREICH_ROLE_GOAL_LEVEL[goal] : undefined;
  const goalLevelRoles = goalLevel ? baseRoles.filter((r) => r.level === goalLevel) : [];
  // Ehrlicher Fallback: nur filtern, wenn es im Bereich tatsaechlich
  // mindestens eine Rolle auf dem zum Ziel passenden Level gibt — sonst
  // liefe die Kombination sonst ins Leere (z.B. ein Bereich ganz ohne
  // Fuehrungsrolle im Katalog).
  const matchingRoles = goalLevelRoles.length > 0 ? goalLevelRoles : baseRoles;
  const isGoalFiltered = goalLevelRoles.length > 0;
  const bySkill = new Map<string, { name: string; totalWeight: number; count: number }>();
  for (const role of matchingRoles) {
    for (const s of role.skills) {
      const entry = bySkill.get(s.skill_id) ?? { name: s.name, totalWeight: 0, count: 0 };
      entry.totalWeight += s.weight;
      entry.count += 1;
      bySkill.set(s.skill_id, entry);
    }
  }
  const avg = [...bySkill.entries()].map(([skill_id, e]) => ({ skill_id, name: e.name, weight: e.totalWeight / e.count }));
  const totalWeight = avg.reduce((sum, s) => sum + s.weight, 0) || 1;
  const skills = avg
    .map((s) => ({ skill_id: s.skill_id, name: s.name, weight: Math.round((s.weight / totalWeight) * 1000) / 10 }))
    .sort((a, b) => b.weight - a.weight);
  // Label kommt bewusst immer aus allRolesInBereich (nicht aus der evtl.
  // eingeschränkten matchingRoles-Menge) — bleibt die echte Bereichs-
  // Bezeichnung, unabhängig davon, ob gefiltert wurde.
  const label = sortedKeys.map((k) => allRolesInBereich.find((r) => r.bereich_key === k)?.bereich_label ?? k).join(" & ");
  return {
    role_id: `bereich:${sortedKeys.join(",")}${isGoalFiltered ? `:${goal}` : ""}`,
    role_name: label,
    bereich_key: sortedKeys[0] ?? "",
    bereich_label: label,
    level: isGoalFiltered && goalLevel ? goalLevel : "Fachkraft",
    skills,
  };
}