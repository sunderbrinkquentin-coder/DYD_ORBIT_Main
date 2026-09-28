/**
 * Angebots-Check fuers Dashboard (29.09.2026, Folge von "Nie ohne Kurs").
 *
 * Zwei Fragen, beantwortet aus Daten, die schon da sind (keine neue
 * Schnittstelle):
 *  1. Nachfrage ohne Angebot: Zu welchen Schwerpunkten/Berufen fragen
 *     Interessenten an, fuer die der Traeger keinen Kurs hat?
 *     Quelle: target_role_id der Leads. Journey v2 speichert dort die
 *     eingegrenzte Richtung als "bereich:<keys>…:n=<beruf>+<beruf>", der Weg
 *     "Ich weiss schon, was ich werden will" direkt die Berufs-ID.
 *  2. Kurse ohne Zuordnung: Welche Kurse haben weder Beruf noch Skills
 *     hinterlegt - und was erkennt die Journey dafuer automatisch
 *     (Kurs-Landkarte, courseMap.ts)? Der Traeger kann das per Klick
 *     uebernehmen; gespeichert wird nur nach dieser Bestaetigung.
 *
 * "Angebot" heisst hier dasselbe wie in der Journey: ein Kurs fuehrt laut
 * rolesForCourse() zu dem Beruf (Angebots-Index, courseOffer.ts).
 */
import type { LeadResponse, OrbitCourse } from "../api/orbit";
import { ROLES_CATALOG, type CatalogRole } from "./rolesCatalog";
import { SCHWERPUNKTE } from "./schwerpunkte";
import { mapCourseCached, type MappedCourse } from "./courseMap";
import { buildCourseOfferIndex, courseCountForRoles } from "./courseOffer";
import { rolesForCourse } from "./journeyFlow";

/** Wunschberufe eines Leads (leer, wenn nur ein Bereich ohne Eingrenzung gespeichert ist). */
export function demandedRoleIds(targetRoleId: string | null | undefined): string[] {
  const id = (targetRoleId ?? "").trim();
  if (!id) return [];
  const n = id.indexOf(":n=");
  if (n >= 0) return id.slice(n + 3).split("+").filter(Boolean);
  if (id.startsWith("bereich:")) return [];
  return [id];
}

export interface DemandGapRow {
  /** Schwerpunkt-Key oder Berufs-ID (wenn kein Schwerpunkt passt). */
  key: string;
  label: string;
  bereichLabel: string;
  bereichKey: string;
  /** Anfragen mit diesem Wunsch im Zeitraum. */
  leads: number;
  /** Kurse, die zu einem Beruf dieses Schwerpunkts fuehren. */
  courseCount: number;
  /** Beispielhafte Wunschberufe (fuer die Anzeige). */
  roleNames: string[];
  /** Berufe des Schwerpunkts (z. B. fuer "Kurs dafuer anlegen"). */
  roleIds: string[];
}

export function analyzeDemandGaps(
  leads: Pick<LeadResponse, "target_role_id" | "created_at">[],
  courses: OrbitCourse[],
  opts: { roles?: CatalogRole[]; sinceDays?: number; now?: Date } = {},
): DemandGapRow[] {
  const roles = opts.roles ?? ROLES_CATALOG;
  const roleById = new Map(roles.map((r) => [r.role_id, r]));
  const since = opts.sinceDays != null ? (opts.now ?? new Date()).getTime() - opts.sinceDays * 86400000 : null;
  const index = buildCourseOfferIndex(courses.map((c) => mapCourseCached(c, roles)), roles);
  const spOfRole = new Map<string, (typeof SCHWERPUNKTE)[number]>();
  for (const sp of SCHWERPUNKTE) for (const r of sp.role_ids) if (!spOfRole.has(r)) spOfRole.set(r, sp);

  const rows = new Map<string, DemandGapRow & { roleSet: Set<string> }>();
  for (const lead of leads) {
    if (since != null && lead.created_at && new Date(lead.created_at).getTime() < since) continue;
    const wanted = demandedRoleIds(lead.target_role_id).filter((id) => roleById.has(id));
    // Je Lead jeden Schwerpunkt nur einmal zaehlen.
    const counted = new Set<string>();
    for (const roleId of wanted) {
      const role = roleById.get(roleId)!;
      const sp = spOfRole.get(roleId);
      const key = sp?.key ?? roleId;
      if (counted.has(key)) continue;
      counted.add(key);
      let row = rows.get(key);
      if (!row) {
        const spRoles = sp ? sp.role_ids.filter((id) => roleById.has(id)) : [roleId];
        row = {
          key,
          label: sp?.label ?? role.role_name,
          bereichKey: role.bereich_key,
          bereichLabel: role.bereich_label,
          leads: 0,
          courseCount: courseCountForRoles(index, spRoles),
          roleNames: [],
          roleIds: spRoles,
          roleSet: new Set(),
        };
        rows.set(key, row);
      }
      row.leads += 1;
      if (!row.roleSet.has(roleId)) {
        row.roleSet.add(roleId);
        row.roleNames.push(role.role_name);
      }
    }
  }
  return [...rows.values()]
    .map(({ roleSet: _roleSet, ...rest }) => rest)
    .sort((a, b) => Number(a.courseCount > 0) - Number(b.courseCount > 0) || b.leads - a.leads || a.label.localeCompare(b.label, "de"));
}

export interface UnmappedCourseRow {
  course: OrbitCourse;
  /** Was die Journey automatisch ergaenzt (Kurs-Landkarte). */
  suggestion: {
    /** Fester Beruf aus eindeutigem Titel ("Fuehrt zu"). */
    roleIds: string[];
    roleNames: string[];
    /** Erkannte Skills (IDs) - nur gesetzt, wenn der Kurs keine hat. */
    skillIds: string[];
    /** Berufe, die die Journey aus den Skills ableitet ("Bereitet vor auf"). */
    derivedRoleNames: string[];
  } | null;
}

/** Kurse ohne Beruf UND ohne Skills, mit dem, was die Journey dafuer erkennt. */
export function findUnmappedCourses(courses: OrbitCourse[], roles: CatalogRole[] = ROLES_CATALOG): UnmappedCourseRow[] {
  const out: UnmappedCourseRow[] = [];
  for (const course of courses) {
    const hasRoles = Boolean(course.target_role_id) || (course.target_role_ids?.length ?? 0) > 0;
    const hasSkills = (course.covered_skill_uris?.length ?? 0) > 0;
    if (hasRoles || hasSkills) continue;
    const mapped: MappedCourse = mapCourseCached(course, roles);
    const inferred = mapped.course_map_inferred ?? [];
    if (inferred.length === 0) {
      out.push({ course, suggestion: null });
      continue;
    }
    const roleIds = inferred.includes("roles") ? mapped.target_role_ids ?? [] : [];
    const skillIds = inferred.includes("skills") ? mapped.covered_skill_uris ?? [] : [];
    const derived = roleIds.length === 0 ? rolesForCourse(mapped, roles, { max: 2 }).map((l) => l.role.role_name) : [];
    out.push({
      course,
      suggestion: {
        roleIds,
        roleNames: roleIds.map((id) => roles.find((r) => r.role_id === id)?.role_name ?? id),
        skillIds,
        derivedRoleNames: derived,
      },
    });
  }
  return out;
}