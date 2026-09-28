/**
 * Kurs-Landkarte fuer die Journey (29.09.2026, Baustein 1 von "Nie ohne Kurs").
 *
 * Problem: Die Journey erkennt die fachliche Richtung eines Kurses nur ueber
 * die im Dashboard hinterlegten Berufe (target_role_ids) oder Skills
 * (covered_skill_uris). Viele Kurse haben beides (noch) nicht - sie waren fuer
 * Richtung, Schwerpunkte und Matching unsichtbar, und Personen landeten am
 * Ende ohne Kursvorschlag.
 *
 * Loesung: Beim Laden des Katalogs bekommt jeder Kurs OHNE Zuordnung eine aus
 * derselben Zuordnungslogik wie im Dashboard (classifyCourse in
 * courseClassifier.ts) - keine zweite, parallele Matchinglogik.
 *  - Kurstitel entspricht eindeutig einem Beruf (Konfidenz "hoch"):
 *    target_role_ids wird gesetzt -> die Journey zeigt "Fuehrt zu ...".
 *  - Sonst nur die sicher erkannten Skills (hoch/mittel) als
 *    covered_skill_uris -> rolesForCourse leitet daraus selbst passende
 *    Berufe ab und die Journey zeigt ehrlicher "Bereitet vor auf ...".
 *  - Hat der Kurs Bereiche, zaehlen nur Berufe aus diesen Bereichen.
 *
 * Grundsaetze: Im Dashboard Gepflegtes hat immer Vorrang und wird nie
 * ueberschrieben. Es wird nichts gespeichert - die Ergaenzung existiert nur im
 * Browser der Journey. Die Markierung course_map_inferred haelt fest, was
 * ergaenzt wurde (fuer Fehlersuche und kuenftige Dashboard-Hinweise).
 */
import type { OrbitCourse } from "../api/orbit";
import { ROLES_CATALOG, type CatalogRole } from "./rolesCatalog";
import { classifyCourse } from "./courseClassifier";

export type CourseMapInference = "roles" | "skills";

export type MappedCourse = OrbitCourse & {
  /** Was die Kurs-Landkarte ergaenzt hat (fehlt = alles aus dem Dashboard). */
  course_map_inferred?: CourseMapInference[];
};

function bereichKeysOf(course: OrbitCourse): string[] {
  const keys = [...(course.bereich_keys ?? []), ...(course.bereich_key ? [course.bereich_key] : [])];
  return keys.filter((k, i) => Boolean(k) && keys.indexOf(k) === i);
}

function hasRoles(course: OrbitCourse): boolean {
  return Boolean(course.target_role_id) || (course.target_role_ids?.length ?? 0) > 0;
}

function hasSkills(course: OrbitCourse): boolean {
  return (course.covered_skill_uris?.length ?? 0) > 0;
}

/** Ergaenzt einen einzelnen Kurs (unveraendert, wenn nichts zu ergaenzen ist). */
export function mapCourse(course: OrbitCourse, roles: CatalogRole[] = ROLES_CATALOG): MappedCourse {
  if (hasRoles(course) && hasSkills(course)) return course;
  if (!course.course_name?.trim()) return course;
  const bereiche = bereichKeysOf(course);
  const result = classifyCourse(
    { title: course.course_name, description: course.description ?? null, bereichKeys: bereiche },
    { catalog: roles, limit: 5 },
  );
  const roleById = new Map(roles.map((r) => [r.role_id, r]));
  const inBereich = (roleId: string) => bereiche.length === 0 || bereiche.includes(roleById.get(roleId)?.bereich_key ?? "");
  const inferred: CourseMapInference[] = [];
  const next: MappedCourse = { ...course };

  if (!hasRoles(course)) {
    const titleRoles = result.roles.filter((r) => r.confidence === "hoch" && r.title_match && inBereich(r.role_id)).slice(0, 2);
    if (titleRoles.length > 0) {
      next.target_role_ids = titleRoles.map((r) => r.role_id);
      next.target_role_names = titleRoles.map((r) => r.role_name);
      inferred.push("roles");
    }
  }
  if (!hasSkills(course)) {
    const skills = result.skills.filter((s) => s.confidence !== "niedrig").map((s) => s.skill_id);
    if (skills.length > 0) {
      next.covered_skill_uris = skills;
      inferred.push("skills");
    }
  }
  if (inferred.length === 0) return course;
  next.course_map_inferred = inferred;
  return next;
}

/** Ergaenzt den ganzen Katalog (Reihenfolge und alle Felder bleiben erhalten). */
export function mapCatalog(courses: OrbitCourse[], roles: CatalogRole[] = ROLES_CATALOG): MappedCourse[] {
  return courses.map((c) => mapCourse(c, roles));
}

// ---------------------------------------------------------------------------
// Im Hintergrund berechnen
// ---------------------------------------------------------------------------
// classifyCourse braucht je Kurs ca. 20-35 ms (Titelabgleich mit
// Tippfehler-Toleranz gegen alle Berufe). Damit die Journey bei grossen
// Katalogen nicht kurz einfriert, rechnet mapCatalogAsync in kleinen
// Portionen und gibt dem Browser dazwischen Zeit. Ergebnisse werden je Kurs
// (Name + Beschreibung + Bereiche) zwischengespeichert, ein erneutes Laden
// des Katalogs ist dann praktisch kostenlos.

const cache = new Map<string, Pick<MappedCourse, "target_role_ids" | "target_role_names" | "covered_skill_uris" | "course_map_inferred">>();

function cacheKey(course: OrbitCourse): string {
  return [
    course.course_name,
    course.description ?? "",
    bereichKeysOf(course).join(","),
    hasRoles(course) ? "R" : "",
    hasSkills(course) ? "S" : "",
  ].join("|");
}

function mapCourseCached(course: OrbitCourse, roles: CatalogRole[]): MappedCourse {
  if (hasRoles(course) && hasSkills(course)) return course;
  const key = cacheKey(course);
  const hit = cache.get(key);
  if (hit) return hit.course_map_inferred ? { ...course, ...hit } : course;
  const mapped = mapCourse(course, roles);
  cache.set(key, {
    target_role_ids: mapped.target_role_ids,
    target_role_names: mapped.target_role_names,
    covered_skill_uris: mapped.covered_skill_uris,
    course_map_inferred: mapped.course_map_inferred,
  });
  return mapped;
}

/** Wie mapCatalog, aber in Portionen (Standard 4 Kurse) mit Pausen fuer den Browser. */
export async function mapCatalogAsync(
  courses: OrbitCourse[],
  opts: { roles?: CatalogRole[]; chunkSize?: number } = {},
): Promise<MappedCourse[]> {
  const roles = opts.roles ?? ROLES_CATALOG;
  const size = Math.max(1, opts.chunkSize ?? 4);
  const out: MappedCourse[] = [];
  for (let i = 0; i < courses.length; i += size) {
    for (const c of courses.slice(i, i + size)) out.push(mapCourseCached(c, roles));
    if (i + size < courses.length) await new Promise<void>((r) => setTimeout(r, 0));
  }
  return out;
}