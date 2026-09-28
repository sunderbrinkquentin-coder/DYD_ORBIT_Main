/**
 * Angebots-Index fuer die Journey (29.09.2026, Baustein 2 von "Nie ohne Kurs").
 *
 * Eine Stelle, die beantwortet: Welche Kurse des Bildungstraegers fuehren zu
 * welchem Beruf, und welche liegen in welchem Bereich? Daraus kommen
 *  - offeredRoleIds (Angebots-Bonus in der Richtungs-Eingrenzung, vorher
 *    direkt in JourneyPage.tsx berechnet - jetzt nur noch hier),
 *  - die Kurszahl je Bereich und je Schwerpunkt im Richtungs-Schritt
 *    ("3 passende Kurse"), damit die Beratung zu Wegen mit Angebot fuehrt.
 *
 * Die Berufe eines Kurses kommen aus rolesForCourse() - derselben Funktion,
 * die auch die Karriereleiter der Ergebniskarten bestimmt. Voraussetzung ist
 * der per Kurs-Landkarte ergaenzte Katalog (courseMap.ts).
 */
import type { OrbitCourse } from "../api/orbit";
import type { CatalogRole } from "./rolesCatalog";
import { rolesForCourse } from "./journeyFlow";

export interface CourseOfferIndex {
  /** Beruf -> Kurs-IDs, die zu diesem Beruf fuehren. */
  byRole: Map<string, Set<string>>;
  /** Bereich -> Kurs-IDs in diesem Bereich. */
  byBereich: Map<string, Set<string>>;
}

function add(map: Map<string, Set<string>>, key: string, courseId: string) {
  const set = map.get(key);
  if (set) set.add(courseId);
  else map.set(key, new Set([courseId]));
}

export function buildCourseOfferIndex(courses: OrbitCourse[], roles: CatalogRole[]): CourseOfferIndex {
  const byRole = new Map<string, Set<string>>();
  const byBereich = new Map<string, Set<string>>();
  for (const c of courses) {
    if (!c.course_id) continue;
    for (const link of rolesForCourse(c, roles, { max: 2 })) add(byRole, link.role.role_id, c.course_id);
    const keys = [...(c.bereich_keys ?? []), ...(c.bereich_key ? [c.bereich_key] : [])];
    for (const k of new Set(keys)) if (k) add(byBereich, k, c.course_id);
  }
  return { byRole, byBereich };
}

/** Anzahl verschiedener Kurse, die zu mindestens einem der Berufe fuehren. */
export function courseCountForRoles(index: CourseOfferIndex, roleIds: Iterable<string>): number {
  const ids = new Set<string>();
  for (const r of roleIds) for (const c of index.byRole.get(r) ?? []) ids.add(c);
  return ids.size;
}

/** Anzahl Kurse in einem Bereich. */
export function courseCountForBereich(index: CourseOfferIndex, bereichKey: string): number {
  return index.byBereich.get(bereichKey)?.size ?? 0;
}

/** Alle Berufe, zu denen mindestens ein Kurs fuehrt. */
export function offeredRoleIdsOf(index: CourseOfferIndex): Set<string> {
  return new Set(index.byRole.keys());
}