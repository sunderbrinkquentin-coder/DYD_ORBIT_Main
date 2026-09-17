/**
 * Konversions-Banner für Kurskacheln — geteilt zwischen JourneyPage.tsx
 * (zeigt sie dem Endnutzer) und DashboardPage.tsx (Bildungsträger stellt sie
 * ein, siehe die Quick-Picker-Leiste auf jeder Kurskachel in "Dein
 * Kurskatalog"). War ursprünglich nur in JourneyPage.tsx definiert; hierher
 * verschoben, damit beide Seiten exakt dieselbe Logik verwenden statt zwei
 * Kopien zu pflegen.
 *
 * Leitet die Banner rein aus echten Kursdaten ab (starts_at,
 * seats_remaining, custom_banner — siehe Kommentar an OrbitCourse in
 * orbit.ts) — bewusst NICHTS Erfundenes, sonst irreführende Werbung
 * (§5 UWG).
 */
import type { OrbitCourse } from "../api/orbit";

export interface CourseBadge {
  text: string;
  kind: "soon" | "upcoming" | "seats" | "full" | "custom" | "featured" | "bestmatch" | "recommended";
}

/** Ab wie vielen Tagen vor Kursstart "Startet in Kürze" angezeigt wird. */
export const STARTS_SOON_DAYS = 21;
/** Ab wie vielen verbleibenden Plätzen "Nur noch X Plätze" angezeigt wird. */
export const FEW_SEATS_THRESHOLD = 5;

/** Tage bis zum Kursstart (kann negativ sein, wenn der Kurs schon läuft),
 *  oder null ohne (gültiges) starts_at. Eigenständig exportiert, damit
 *  sowohl courseBadges() hier als auch preferenceMatchScore() in
 *  courseMatcher.ts (Abgleich gegen den gewünschten Startzeitpunkt aus dem
 *  Journey-"Präferenzen"-Schritt) dieselbe Berechnung nutzen statt sie
 *  zweimal zu pflegen. */
export function daysUntilCourseStart(course: { starts_at?: string | null }): number | null {
  if (!course.starts_at) return null;
  const startDate = new Date(course.starts_at);
  if (Number.isNaN(startDate.getTime())) return null;
  return Math.ceil((startDate.getTime() - Date.now()) / (1000 * 60 * 60 * 24));
}

export function courseBadges(
  course: OrbitCourse | undefined | null,
  /** Kontext aus dem Kurs-Schritt (Version 36, 15.09. — nach zwei
   *  Feedback-Runden: erst ein separates schwebendes "Top-Kurs"-Band
   *  ZUSÄTZLICH zu dieser Leiste eingeführt → Rückmeldung "doppelt", dann
   *  diese Leiste testweise wieder auf reine Echtdaten reduziert → neue
   *  Rückmeldung "es fehlen die Banner". Endgültige Lösung: NUR NOCH DIESE
   *  EINE Leiste ist das "immer sichtbare" Element, kein zweites Band mehr.
   *  alwaysShow sorgt dafür, dass hier IMMER mindestens ein Badge steht,
   *  aber weiterhin ausschließlich aus echten Datenfeldern abgeleitet:
   *  is_featured (Bildungsträger hat den Kurs im Dashboard als "Top"
   *  markiert) hat Vorrang; sonst, nur wenn isBestMatch gesetzt ist, die
   *  tatsächliche algorithmische Bestempfehlung; sonst ein neutraler, wahrer
   *  Hinweis. Ohne alwaysShow (z.B. DashboardPage.tsx) unverändert: leere
   *  Leiste = kein Badge zutreffend. */
  opts?: { alwaysShow?: boolean; isBestMatch?: boolean }
): CourseBadge[] {
  if (!course) return [];
  const badges: CourseBadge[] = [];
  const daysUntil = daysUntilCourseStart(course);
  if (daysUntil != null && daysUntil >= 0) {
    if (daysUntil <= STARTS_SOON_DAYS) {
      badges.push({
        text:
          daysUntil === 0
            ? "🚀 Startet heute"
            : daysUntil === 1
              ? "🚀 Startet morgen"
              : `🚀 Startet in ${daysUntil} Tagen`,
        kind: "soon",
      });
    } else {
      // Erweiterung (14.09., Rückmeldung "das Kursangebot am Ende muss noch
      // viel mehr visuell ansprechend sein mit den Daten vom Kurskatalog,
      // also startet in x Wochen/Tagen oder ähnliche Sachen"): ein bekanntes,
      // aber weiter als STARTS_SOON_DAYS entferntes Startdatum wurde bisher
      // GAR NICHT als Badge gezeigt — nur als unauffällige Textzeile in
      // KursStep (siehe formatCourseStartDate dort), und selbst die nur,
      // wenn die Person aktiv einen Startwunsch genannt hatte. Echte,
      // vorhandene Kataloginfo (starts_at), die dadurch unterging. Jetzt
      // immer sichtbar — in Wochen, bzw. ab ~10 Wochen in Monaten, damit die
      // Zahl lesbar bleibt statt z.B. "in 63 Tagen" (reine Rundung einer
      // echten Differenz, keine erfundene Angabe).
      if (daysUntil <= 70) {
        const weeks = Math.round(daysUntil / 7);
        badges.push({ text: `📅 Startet in ${weeks} Woche${weeks === 1 ? "" : "n"}`, kind: "upcoming" });
      } else {
        const months = Math.round(daysUntil / 30);
        badges.push({ text: `📅 Startet in ${months} Monat${months === 1 ? "" : "en"}`, kind: "upcoming" });
      }
    }
  }
  if (course.seats_remaining != null) {
    if (course.seats_remaining <= 0) {
      badges.push({ text: "🔒 Ausgebucht", kind: "full" });
    } else if (course.seats_remaining <= FEW_SEATS_THRESHOLD) {
      badges.push({
        text: `⚡ Nur noch ${course.seats_remaining} Platz${course.seats_remaining === 1 ? "" : "e"}`,
        kind: "seats",
      });
    }
  }
  if (course.custom_banner) {
    badges.push({ text: course.custom_banner, kind: "custom" });
  }
  if (opts?.alwaysShow && badges.length === 0) {
    if (course.is_featured) {
      badges.push({ text: "★ Top-Kurs", kind: "featured" });
    } else if (opts.isBestMatch) {
      badges.push({ text: "✓ Beste Passung für dich", kind: "bestmatch" });
    } else {
      badges.push({ text: "📚 Empfohlene Weiterbildung", kind: "recommended" });
    }
  }
  return badges;
}

/** Kleine Banner-Leiste über einer Kurskarte — leer/nichts, wenn keine
 *  Badges zutreffen (siehe courseBadges oben). alwaysShow/isBestMatch: siehe
 *  courseBadges() — nur im Kurs-Schritt (KursStep) gesetzt, im Dashboard
 *  unverändert. */
export function CourseBadgeRow({
  course,
  alwaysShow,
  isBestMatch,
}: {
  course: OrbitCourse | undefined | null;
  alwaysShow?: boolean;
  isBestMatch?: boolean;
}) {
  const badges = courseBadges(course, { alwaysShow, isBestMatch });
  if (badges.length === 0) return null;
  return (
    <div className="course-banner-row">
      {badges.map((b, i) => (
        <span key={i} className={`course-banner course-banner-${b.kind}`}>
          {b.text}
        </span>
      ))}
    </div>
  );
}