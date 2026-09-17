/**
 * TypeScript-Entsprechung der Python-Pydantic-Modelle aus dem DYD-Backend
 * (dyd-skill-api/app/models/orbit_schemas.py) für die ORBIT-Endpunkte
 * (Kurs-Matching, Leads, Dashboard-Reports).
 *
 * Diese Datei gehört in dein Bolt-/TypeScript-Frontend, NICHT in das
 * Python-Projekt. Sie enthält nur Typen + kleine fetch()-Hilfsfunktionen,
 * damit Bolt die API korrekt aufrufen und die Antworten typsicher
 * verarbeiten kann. Keine eigene Geschäftslogik — die läuft ausschließlich
 * im Python-Backend.
 *
 * Hinweis: `LeadCreateRequest`/`LeadResponse` enthalten hier zusätzlich das
 * Feld `contact_email` (optional) — das fehlte in der Version, die du mir
 * geschickt hast (die war schon veraltet). Im aktuellen Backend ist es
 * bereits drin, siehe app/models/orbit_schemas.py.
 */

import { genericRequestError, type ExperienceLevel } from "./core";

// ---------- Kurs-Matching (POST /api/v1/orbit/course-match) ----------

export interface CourseMatchRequest {
  /** Freitext-Profil des Leads. */
  text: string;
  /** Wunsch-/Zielrolle des Leads. */
  target_role_id: string;
  /** Minimaler Fuzzy-Match-Score (0-100). Backend-Default: 60.0 */
  min_score?: number;
}

export interface CourseRecommendation {
  course_id: string;
  course_name: string;
  provider: string;
  duration_weeks: number;
  covers_gap_count: number;
  covers_gap_percentage: number;
  /**
   * Fallback-Felder (siehe course_matcher.py im Backend): nur gesetzt, wenn
   * KEIN Kurs im Katalog exakt eine der erkannten Skill-Lücken trifft und
   * stattdessen nach Abdeckung der GESAMTEN Kern-Skills der Zielrolle
   * sortiert wurde. covers_gap_count/-percentage sind dann bewusst 0, um
   * keine Lücken-Abdeckung vorzutäuschen, die es nicht gibt — die
   * tatsächliche Relevanz steckt hier drin. Optional, ein älteres Backend,
   * das diese Felder nicht kennt, liefert sie einfach nicht mit.
   */
  covers_role_count?: number;
  covers_role_percentage?: number;
  is_role_fallback?: boolean;
  /**
   * Version 25 — siehe preferenceMatchScore()/rankCoursesForGap() in
   * courseMatcher.ts: 0-2, wie gut der Kurs zu Beschäftigungsart/Arbeitsort
   * aus dem "Präferenzen"-Journey-Schritt passt. Nur bei der LOKALEN
   * Kurs-Rangfolge (matchCoursesToGap) gesetzt und nur, wenn überhaupt eine
   * Präferenz angegeben wurde — beeinflusst ausschließlich die Reihenfolge,
   * nie ob ein Kurs überhaupt auftaucht.
   */
  preference_match?: number;
}

export interface CourseMatchResponse {
  tenant_id: string;
  target_role_id: string;
  target_role_name: string;
  match_percentage: number;
  gap_skill_count: number;
  recommended_courses: CourseRecommendation[];
}

// ---------- Leads (POST/GET /api/v1/orbit/leads) ----------

export interface LeadCreateRequest {
  /** Freitext-Profil des Leads (Lebenslauf, Selbstauskunft o.ä.). */
  text: string;
  /** Zielrolle, die der Lead erreichen möchte. */
  target_role_id: string;
  /** Name/Kennung des Leads, optional (z.B. "M. Becker"). */
  lead_name?: string | null;
  /** Kontakt-E-Mail des Leads, optional — für die Nachverfolgung durch den Bildungsträger. */
  contact_email?: string | null;
  /**
   * Telefonnummer des Leads (Version 27, siehe leadPhone im letzten
   * Journey-Schritt/LeadStep in JourneyPage.tsx) — optional, wie
   * contact_email, damit niemand an einem zusätzlichen Pflichtfeld
   * abspringt. Additiv wie die übrigen Zusatzfelder hier: ein Backend, das
   * dieses Feld noch nicht kennt, ignoriert es einfach.
   */
  contact_phone?: string | null;
  /**
   * Freitext-Anliegen der Person (Version 38, 17.09., Rückmeldung "es soll
   * da auch ein kleines Freitextfeld geben in dem man schon konkrete
   * Anliegen schildern kann") — z.B. bereits vorhandene Vorkenntnisse oder
   * eine konkrete Terminfrage, die der Bildungsträger vor dem ersten
   * Kontakt schon kennt. Optional/additiv wie contact_phone oben: ein
   * Backend, das dieses Feld noch nicht kennt, ignoriert es einfach.
   */
  message?: string | null;
  /**
   * Kurs, für den sich die Person im Kurs-Schritt aktiv entschieden hat
   * (Version 15) — kann von der algorithmischen Bestempfehlung abweichen.
   * Optional, damit ein Backend, das dieses Feld noch nicht kennt, die
   * Anfrage trotzdem entgegennimmt (siehe Backend-Abstimmung).
   */
  selected_course_id?: string | null;
  /** Grob gewählter Startzeitpunkt (siehe START_OPTIONS in JourneyPage.tsx), optional. */
  desired_start?: string | null;
  /**
   * Hauptmotivation, ganz am Anfang der Journey abgefragt (siehe
   * GOAL_OPTIONS in JourneyPage.tsx: "geld" | "knowhow" | "neuorientierung" |
   * "sicherheit"), optional (null, wenn übersprungen).
   */
  career_goal?: string | null;
  /**
   * "Ich möchte mich zusätzlich noch persönlich beraten lassen" — Person hat
   * im letzten Journey-Schritt die Checkbox "Zusätzlich persönlich beraten
   * lassen" angehakt (Version 20, siehe wantsConsultation in
   * JourneyPage.tsx) und mit derselben Anfrage mitgeschickt.
   * Optional/additiv wie selected_course_id oben: ein Backend, das dieses
   * Feld noch nicht kennt, ignoriert es einfach, statt die Anfrage
   * abzulehnen — der Lead wird dann ganz normal wie eine Kursanfrage
   * angelegt, nur ohne den Beratungs-Vermerk im Dashboard.
   */
  consultation_requested?: boolean;
  /**
   * Beschäftigungsart, im neuen "Präferenzen"-Schritt gleich nach dem
   * Ziel-Schritt abgefragt (siehe EMPLOYMENT_OPTIONS in JourneyPage.tsx:
   * "vollzeit" | "teilzeit"), optional (null, wenn übersprungen).
   * Optional/additiv wie career_goal oben: ein Backend, das dieses Feld noch
   * nicht kennt, ignoriert es einfach.
   */
  employment_type?: string | null;
  /**
   * Gewünschter Arbeitsort, ebenfalls im "Präferenzen"-Schritt abgefragt
   * (siehe LOCATION_OPTIONS in JourneyPage.tsx: "remote" | "vor-ort"),
   * optional (null, wenn übersprungen). Optional/additiv wie employment_type
   * oben.
   */
  work_location?: string | null;
  /**
   * Förderungs-Präferenz (Version 32, 14.09.), ebenfalls im "Präferenzen"-
   * Schritt abgefragt (siehe FUNDING_OPTIONS in JourneyPage.tsx: "gefoerdert"
   * | "egal"), optional (null, wenn übersprungen). Optional/additiv wie
   * employment_type/work_location oben — ein Backend, das dieses Feld noch
   * nicht kennt, ignoriert es einfach.
   */
  funding_preference?: string | null;
  /**
   * DSGVO-Nachweis der Einwilligung zur Speicherung der Kontakt-/Bewerberdaten
   * (Version 28). Art. 7 Abs. 1 DSGVO verlangt, dass der Verantwortliche eine
   * erteilte Einwilligung NACHWEISEN kann — bisher wurde die entsprechende
   * Checkbox im letzten Journey-Schritt (siehe "consent"-State in
   * JourneyPage.tsx) zwar geprüft (kein Absenden ohne Haken), aber nie
   * mitgeschickt: nach dem Anlegen des Leads gab es keinen Beleg mehr dafür,
   * dass und wann konkret zugestimmt wurde. consent_given ist praktisch immer
   * true (sonst würde gar nicht abgeschickt) — der eigentliche Nachweis steckt
   * in consent_given_at (Zeitstempel) und consent_text_version (WELCHER
   * Formulierung zugestimmt wurde, falls sich der Text später ändert).
   * Optional/additiv wie die übrigen neuen Felder hier: ein Backend, das diese
   * drei Felder noch nicht kennt, ignoriert sie einfach.
   */
  consent_given?: boolean | null;
  /** ISO-8601-Zeitstempel, client-seitig im Moment des Absendens erzeugt. */
  consent_given_at?: string | null;
  /** Siehe CONSENT_TEXT_VERSION in JourneyPage.tsx. */
  consent_text_version?: string | null;
  /**
   * Separater DSGVO-Nachweis für die FRÜHERE Einwilligung im CV-/Text-Analyse-
   * Schritt (eigener Consent-Text, der explizit OpenAI Ireland Ltd als
   * Auftragsverarbeiter gem. Art. 28 DSGVO nennt — inhaltlich etwas anderes
   * als consent_given oben, das nur die Speicherung der Kontaktdaten betrifft).
   * Wird gesetzt, sobald die Person diesen Schritt durchlaufen hat (siehe
   * cvProcessingConsentGivenAt in JourneyPage.tsx); bleibt null, wenn dieser
   * Schritt in der aktuellen Sitzung nie erreicht wurde. Optional/additiv wie
   * consent_given oben.
   */
  cv_processing_consent_given?: boolean | null;
  cv_processing_consent_at?: string | null;
  /**
   * Momentaufnahme der bereits client-seitig berechneten Skill-Gap-Analyse
   * (Version 37, siehe resolveLeadTargetRoleId/submitLead in JourneyPage.tsx)
   * — vor allem für den Bereichs-Kurzweg gedacht, bei dem target_role_id
   * evtl. nicht 1:1 den ursprünglich gemeinten Bereich trifft. War bislang
   * nur als Objektliteral im Aufruf vorhanden, ohne hier im Typ zu stehen
   * (TS-Excess-Property-Fehler bei "tsc --noEmit", auch wenn esbuild das
   * nicht meldet) — jetzt nachgetragen. Optional/additiv wie die übrigen
   * Zusatzfelder hier: ein Backend, das journey_snapshot noch nicht kennt,
   * ignoriert es einfach.
   */
  journey_snapshot?: {
    target_role_name: string;
    match_percentage: number;
    matched_skills: string[];
    gap_skills: string[];
    selected_course_id: string | null;
  } | null;
  // Hinweis: Match-Schwelle und Qualifizierungs-Schwelle werden bewusst nicht
  // mitgeschickt — beide setzt ausschliesslich der Server.
}

export interface LeadResponse {
  lead_id: string;
  tenant_id: string;
  created_at: string;
  lead_name: string | null;
  contact_email: string | null;
  /** Siehe contact_phone in LeadCreateRequest oben — fehlt in der Antwort,
   *  wenn das Backend das Feld noch nicht kennt (dann im Dashboard einfach
   *  als "keine Telefonnummer hinterlegt" behandeln). Optional/additiv wie
   *  consultation_requested unten. */
  contact_phone?: string | null;
  /** Siehe message in LeadCreateRequest oben — fehlt in der Antwort, wenn
   *  das Backend das Feld noch nicht kennt. Optional/additiv wie
   *  contact_phone oben. */
  message?: string | null;
  target_role_id: string;
  target_role_name: string;
  matched_skills: string[];
  gap_skills: string[];
  current_match_percentage: number;
  recommended_course: CourseRecommendation | null;
  projected_match_percentage: number;
  qualified: boolean;
  /** Manuell im Dashboard gesetzt, sobald der Bildungsträger die Buchung in seinem eigenen System bestätigt hat. */
  booked: boolean;
  booked_at: string | null;
  /** Siehe consultation_requested in LeadCreateRequest oben — fehlt in der
   *  Antwort, wenn das Backend das Feld noch nicht kennt (dann im Dashboard
   *  einfach als "nicht gewünscht" behandeln, siehe DashboardPage.tsx). */
  consultation_requested?: boolean;
  /** Siehe desired_start in LeadCreateRequest oben — für die Dashboard-
   *  Übersicht (Version 21), damit der Bildungsträger sieht, wie dringlich
   *  das Anliegen ist. Optional/additiv wie consultation_requested. */
  desired_start?: string | null;
  /** Siehe employment_type in LeadCreateRequest oben — für die Dashboard-
   *  Übersicht, ob es sich um eine Vollzeit- oder Teilzeit-Anfrage handelt.
   *  Optional/additiv wie desired_start. */
  employment_type?: string | null;
  /** Siehe work_location in LeadCreateRequest oben — für die Dashboard-
   *  Übersicht, ob Remote oder Vor-Ort gewünscht ist. Optional/additiv wie
   *  desired_start. */
  work_location?: string | null;
  /** Siehe funding_preference in LeadCreateRequest oben — für die Dashboard-
   *  Übersicht, ob der Person eine Förderung wichtig war. Optional/additiv
   *  wie desired_start/employment_type/work_location. */
  funding_preference?: string | null;
  /** Manuell im Dashboard gesetzt (Version 21, siehe setLeadConsultationCompleted
   *  unten), sobald das angefragte Beratungsgespräch tatsächlich stattgefunden
   *  hat — genau dasselbe Muster wie booked/booked_at oben, nur fürs
   *  Beratungsgespräch statt für die Kursbuchung. Nur relevant, wenn
   *  consultation_requested true ist. */
  consultation_completed?: boolean;
  consultation_completed_at?: string | null;
  /** Termin-Datum (Version 22, siehe setLeadConsultationScheduled unten) —
   *  im Unterschied zu consultation_completed_at (setzt der SERVER
   *  automatisch beim Abhaken) trägt der Bildungsträger dieses Datum selbst
   *  ein, für WANN der Termin vereinbart wurde/stattfinden soll. "YYYY-MM-DD",
   *  null = noch kein Termin vereinbart. Eigenständig von consultation_completed:
   *  ein Termin kann vereinbart sein, ohne dass das Gespräch schon
   *  stattgefunden hat, und umgekehrt. */
  consultation_scheduled_for?: string | null;
  /** Bearbeiter, dem der Lead zugewiesen wurde (Version 23, siehe
   *  setLeadAssignedTo unten) — freier Name/Kürzel, kein eigenes
   *  Nutzerkonto-System. null/leer = niemandem zugewiesen. */
  assigned_to?: string | null;
  /** Vom Bildungsträger manuell verlinkte Kurse aus dem EIGENEN Katalog
   *  (Version 23, siehe setLeadLinkedCourses unten) — zusätzlich zu
   *  recommended_course, z.B. wenn ein anderer Kurs besser passt als die
   *  automatische Empfehlung. Liste von course_id. */
  linked_course_ids?: string[];
  /** Siehe consent_given/-_at/-_text_version in LeadCreateRequest oben —
   *  Nachweis der Einwilligung, im Dashboard z.B. im Lead-Detail anzeigbar.
   *  Optional/additiv wie linked_course_ids: fehlt, wenn das Backend die
   *  Felder noch nicht kennt oder der Lead vor Version 28 angelegt wurde. */
  consent_given?: boolean | null;
  consent_given_at?: string | null;
  consent_text_version?: string | null;
  /** Siehe cv_processing_consent_given/-_at in LeadCreateRequest oben. */
  cv_processing_consent_given?: boolean | null;
  cv_processing_consent_at?: string | null;
}

export interface LeadListResponse {
  tenant_id: string;
  leads: LeadResponse[];
}

// ---------- Kurskatalog (POST/GET /api/v1/orbit/courses, POST .../featured) ----------

/**
 * Ein Kurs-Skill inkl. Erfahrungslevel (siehe ExperienceLevel in core.ts).
 * Bewusst ZUSAETZLICH zu covered_skill_uris, nicht als Ersatz: das
 * bestehende Matching (Gap-Analyse, Kursempfehlung) arbeitet weiter mit der
 * flachen URI-Liste, dieses Feld ist reine Anreicherung, die ein Backend
 * ohne diese Spalte einfach ignoriert.
 */
export interface CourseSkillEntry {
  esco_uri: string;
  /** null = (noch) kein Level gesetzt/erkannt, z.B. bei älteren Kursen ohne Beschreibung. */
  experience_level: ExperienceLevel | null;
}

export interface OrbitCourse {
  tenant_id: string;
  course_id: string;
  course_name: string;
  provider: string;
  duration_weeks: number;
  covered_skill_uris: string[];
  /** Vom Bildungsträger im Dashboard gesetzt — steuert, ob der Kurs unten im Kurs-Schritt der Journey als "Beliebte Weiterbildung" erscheint. */
  is_featured: boolean;
  /**
   * Kursbeschreibung, optional — Grundlage für die automatische Skill-Erkennung
   * (siehe fetchSkillMatch in core.ts) beim manuellen Anlegen und beim CSV-Import.
   * Wird optimistisch mitgeschickt; ob sie dauerhaft gespeichert wird, hängt vom
   * jeweiligen Backend-Stand ab (ein Backend ohne dieses Feld ignoriert es
   * einfach) — Beschreibung wie immer über "✎ Bearbeiten" wieder abrufbar, sobald
   * das Backend sie zurückliefert.
   */
  description?: string;
  /**
   * Dieselbe Skill-Liste wie covered_skill_uris, aber mit Erfahrungslevel je
   * Skill (siehe CourseSkillEntry) — optional, additiv, siehe dortigen
   * Kommentar. Fehlt dieses Feld in der Antwort (altes Backend), zeigt das
   * Dashboard die Skills ohne Level-Chip an.
   */
  covered_skills?: CourseSkillEntry[];
  /**
   * Optionale Zielrolle, der dieser Kurs zugeordnet ist (z.B. "Data Analyst")
   * — gesetzt über den Zielrollen-Picker im Kursformular. Rein informativ/für
   * spätere Matching-Verfeinerung gedacht; ein Backend ohne dieses Feld
   * ignoriert es einfach, wie bei description/covered_skills.
   * Hält weiterhin nur die ERSTE ausgewählte Rolle (Backward-Compat für ein
   * Backend, das nur ein einzelnes Feld kennt) — die vollständige Auswahl
   * steckt in target_role_ids/target_role_names unten.
   */
  target_role_id?: string | null;
  target_role_name?: string | null;
  /**
   * Mehrere Zielrollen pro Kurs — additiv zu target_role_id/target_role_name
   * oben, genau wie covered_skills additiv zu covered_skill_uris ist. Ein
   * Backend ohne dieses Feld ignoriert es einfach und sieht nur die erste
   * Rolle über target_role_id/target_role_name.
   */
  target_role_ids?: string[] | null;
  target_role_names?: string[] | null;
  /**
   * Bereich/Kategorie, dem dieser Kurs zugeordnet ist (Version 34, 15.09. —
   * Antwort auf "wir müssen am Dashboard ansetzen und das als Fixpunkt
   * hinterlegen"; Version 35 direkt danach: MEHRFACHAUSWAHL, "soll auch bei
   * mehreren Bereichen gehen, falls es eine allgemeine Weiterbildung ist").
   * Anders als target_role_id/-ids (optional) ist mindestens EIN Bereich im
   * Kursformular PFLICHTFELD — Grundlage dafür, welche Bereiche/Rollen
   * überhaupt in der Journey auswählbar sind (siehe rolesWithBereichCoverage
   * in gapAnalysis.ts) — bietet ein Bildungsträger z.B. kein Handwerk an,
   * taucht Handwerk dort gar nicht erst auf. bereich_key/-label bleiben
   * zusätzlich als ERSTER gewählter Bereich gesetzt (Backward-Compat für ein
   * Backend, das nur das Einzelfeld kennt), bereich_keys/-labels tragen die
   * vollständige Mehrfachauswahl — exakt dasselbe Muster wie target_role_id
   * vs. target_role_ids oben. Werte aus demselben bereich_key-Katalog wie bei
   * den Rollen (BEREICH_OPTIONS/listBereiche() in gapAnalysis.ts). Optional
   * im TYP (additiv), weil bestehende Kurse vor diesem Feature noch keinen
   * Wert haben — bis zur Nachpflege bleiben sie für die Bereichs-Auswahl in
   * der Journey unsichtbar.
   */
  bereich_key?: string | null;
  bereich_label?: string | null;
  bereich_keys?: string[] | null;
  bereich_labels?: string[] | null;
  /**
   * Durchführungsort — optional, additiv wie description/target_role_id.
   * is_remote=true => Kurs hat eine Online-Komponente (reines Remote-Format
   * ODER hybrid), location dann meist leer/informell bei reinem Remote;
   * is_remote=false => ausschließlich vor Ort, location ist der
   * tatsächliche Durchführungsort (Stadt/Adresse). is_remote ist die
   * einfache boolesche Sicht für Konsumenten, die kein Hybrid kennen —
   * location_mode ist die präzisere 3-Wege-Angabe (kennt "hybrid"). Ein
   * Backend ohne diese Felder ignoriert sie einfach, wie bei den übrigen
   * additiven Feldern.
   */
  location?: string | null;
  is_remote?: boolean | null;
  location_mode?: LocationMode | null;
  /**
   * Beschäftigungsart, zu der dieser Kurs passt (Version 25) — additiv wie
   * location_mode oben, gleiches 3-Wege-Muster: "vollzeit"/"teilzeit" sind
   * exklusiv gedacht (z.B. ein Kurs, der nur tagsüber unter der Woche
   * stattfindet und damit für Teilzeit-Kräfte/Berufstätige kaum machbar
   * ist), "beides" = passt für beide Beschäftigungsarten. Grundlage für das
   * Präferenz-Matching gegen employment_type/work_location aus dem
   * "Präferenzen"-Journey-Schritt (siehe EMPLOYMENT_OPTIONS in
   * JourneyPage.tsx und preferenceMatchScore in courseMatcher.ts). Ein
   * Backend ohne dieses Feld ignoriert es einfach, wie location_mode.
   */
  employment_mode?: EmploymentMode | null;
  /**
   * Konversions-Banner (additiv, optional — ein Backend ohne diese Felder
   * ignoriert sie einfach, wie description/location oben). Bewusst auf
   * ECHTEN Daten aufgebaut statt auf einem manuellen "sieht dringend aus"-
   * Schalter: starts_at ist das tatsächliche Startdatum, seats_remaining die
   * tatsächlich verbleibende Platzzahl. Ein frei erfundenes "Nur noch wenige
   * Plätze!" ohne echte Grundlage wäre irreführende Werbung (§5 UWG) — die
   * Badges in JourneyPage.tsx (siehe courseBadges()) leiten sich rein aus
   * diesen Werten ab, nichts wird zusätzlich behauptet.
   */
  starts_at?: string | null;
  seats_remaining?: number | null;
  /** Frei formulierbarer Zusatz-Hinweis, z.B. "Neu im Programm" — liegt in
   *  der Verantwortung des Bildungsträgers, wie description auch. */
  custom_banner?: string | null;
  /**
   * Preis-/Förder-/Abschluss-Angaben (Version 32, 14.09. — Antwort auf
   * "mehr Infos wie Preise, Anzahl Stunden und ob es förderfähig ist"; siehe
   * die vorangegangene IHK-Bildungszentren-/KURSNET-Recherche im Chat).
   * Durchweg additiv wie location_mode/employment_mode oben — ein Backend
   * ohne diese Felder ignoriert sie einfach, das Dashboard zeigt dann nur
   * die bisherigen Angaben.
   *
   * price_eur: reine Kursgebühr OHNE Prüfungsgebühr (siehe exam_fee_eur) —
   * bei IHK-Bildungszentren fast immer zwei getrennte Rechnungen, ein
   * einzelner "Gesamtpreis" würde das verschleiern.
   * price_vat_exempt: die meisten Bildungsträger sind nach §4 Nr. 21 UStG
   * umsatzsteuerbefreit — ohne diesen Hinweis bleibt unklar, ob price_eur
   * brutto oder netto ist.
   * teaching_units: Unterrichtseinheiten (UE) à 45 Minuten — die in der
   * Weiterbildungsbranche übliche Dauer-Angabe, siehe IHK-Bildungszentrum-
   * Beispiel ("ca. 60 UE"). Additiv NEBEN duration_weeks, ersetzt es nicht
   * (manche Bildungsträger kennen nur Wochen, manche nur UE).
   */
  price_eur?: number | null;
  price_vat_exempt?: boolean | null;
  exam_fee_eur?: number | null;
  teaching_units?: number | null;
  /**
   * Fördermöglichkeiten für diesen Kurs — ein Kurs kann mehrere gleichzeitig
   * erfüllen (z.B. AZAV-Bildungsgutschein UND in einem Bundesland als
   * Bildungsurlaub anerkannt). Bewusst NICHT ein einzelnes Förderfähig-Flag:
   * die realen Fördertöpfe (Bildungsgutschein/AZAV, Aufstiegs-BAföG,
   * Landesförderung wie der Bildungsscheck NRW, Bildungsurlaub) haben
   * unterschiedliche Voraussetzungen — ein Lead, der gezielt nach
   * Bildungsgutschein sucht, braucht eine andere Antwort als einer, der auf
   * Bildungsurlaub seines Arbeitgebers angewiesen ist.
   * funding_measure_number: die achtstellige AZAV-Maßnahmenummer aus
   * KURSNET — nur sinnvoll befüllt, wenn "bildungsgutschein" in
   * funding_types steht; der Beleg, mit dem ein:e Berater:in bei der
   * Agentur für Arbeit/dem Jobcenter die Förderfähigkeit sofort prüfen
   * kann, ohne erst nachzufragen.
   */
  funding_types?: FundingType[] | null;
  funding_measure_number?: string | null;
  /**
   * Abschlussart nach dem IHK-Schema (siehe "Abschlussarten"-Recherche):
   * seminarzertifikat (bis 49 UE, Einstieg/Auffrischung), lehrgangszertifikat
   * (ab 50 UE, bereichsübergreifend, mit Abschlusstest), ihk_pruefung (echte
   * Prüfung vor der IHK, z.B. AEVO), sonstiger_abschluss (alles andere, z.B.
   * eigenes Trägerzertifikat). dqr_level: Einstufung im Deutschen
   * Qualifikationsrahmen (1-8) — rein informativ, nur bei offiziell
   * eingestuften Abschlüssen (Fachwirt/Meister/Betriebswirt etc.) sinnvoll,
   * bei allem anderen einfach leer lassen statt zu raten.
   */
  qualification_type?: QualificationType | null;
  dqr_level?: number | null;
  /** Zielgruppe/Voraussetzungen als Freitext, z.B. "Grundlegende
   *  IT-Kenntnisse von Vorteil, keine Programmiererfahrung nötig". */
  target_group?: string | null;
  /**
   * Direktbuchungslink (Version 37, 17.09. — Rückmeldung "bei direkt starten
   * soll der Link vom Kurs hinterlegt sein, sodass man direkt aufs
   * Anmeldefeld kommt"): die tatsächliche Anmelde-/Buchungsseite des
   * Bildungsträgers für GENAU diesen Kurs — kein DYD-eigener Anmeldeprozess.
   * Journey (KursStep/LeadStep) öffnet diesen Link in einem neuen Tab, wenn
   * die Person "Kurs direkt buchen" wählt, und legt zusätzlich ganz normal
   * einen Lead an, damit der Bildungsträger die Anfrage trotzdem sieht. Im
   * Kursformular PFLICHTFELD (siehe CourseUpsertRequest unten und die
   * entsprechende Validierung in DashboardPage.tsx) — ANDERS als die übrigen
   * additiven Felder hier, weil ohne einen echten Link der "direkt buchen"-
   * Button gar nicht ehrlich angeboten werden kann (keine erfundene
   * Weiterleitung). Optional im TYP trotzdem (wie bereich_key), damit
   * bereits bestehende Kurse aus der Zeit vor diesem Feature nicht plötzlich
   * als "kaputt" gelten — sie zeigen in der Journey einfach (noch) keinen
   * "Kurs direkt buchen"-Button, bis nachgepflegt wurde.
   */
  booking_url?: string | null;
  /**
   * Grobe Einkategorisierung des Kurses (Version 37, 17.09. — Rückmeldung
   * "Einkategorisierung in Zertifikate, Weiterbildung, Studium etc."). Bewusst
   * EIN ZUSÄTZLICHES, einfaches Feld NEBEN qualification_type: qualification_type
   * bildet die IHK-spezifische Abschlussart ab (seminarzertifikat/
   * lehrgangszertifikat/ihk_pruefung/sonstiger_abschluss) und ist für einen
   * Bildungsträger ohne IHK-Bezug oft gar nicht einschlägig; course_category
   * ist die einfache, format-unabhängige Grobsortierung, nach der ein
   * Bildungsträger seinen Katalog im Dashboard filtert/organisiert (z.B. auch
   * ein Studiengang oder ein reines Online-Seminar, für die qualification_type
   * nicht passt). Additiv/optional wie die übrigen neuen Felder — ein Kurs
   * ohne gesetzten Wert erscheint im Dashboard einfach als "nicht
   * kategorisiert" statt mit einer erfundenen Zuordnung.
   */
  course_category?: CourseCategory | null;
}

/** "hybrid" = sowohl remote als auch vor Ort möglich. */
export type LocationMode = "remote" | "vor_ort" | "hybrid";
/** "beides" = Kurs passt sowohl für Vollzeit- als auch Teilzeit-Kräfte. */
export type EmploymentMode = "vollzeit" | "teilzeit" | "beides";
/** Siehe ausführlichen Kommentar an funding_types/OrbitCourse oben. */
export type FundingType = "bildungsgutschein" | "aufstiegs_bafoeg" | "laenderfoerderung" | "bildungsurlaub";
/** Siehe ausführlichen Kommentar an qualification_type/OrbitCourse oben. */
export type QualificationType = "seminarzertifikat" | "lehrgangszertifikat" | "ihk_pruefung" | "sonstiger_abschluss";
/** Siehe ausführlichen Kommentar an course_category/OrbitCourse oben. */
export type CourseCategory = "zertifikat" | "weiterbildung" | "studium" | "seminar" | "sonstiges";

export interface CourseListResponse {
  tenant_id: string;
  courses: OrbitCourse[];
}

export interface CourseUpsertRequest {
  course_id: string;
  course_name: string;
  provider: string;
  duration_weeks: number;
  covered_skill_uris?: string[];
  is_featured?: boolean;
  description?: string;
  /** Siehe CourseSkillEntry/OrbitCourse.covered_skills oben. */
  covered_skills?: CourseSkillEntry[];
  /** Siehe target_role_id/target_role_ids in OrbitCourse oben — target_role_id
   *  bleibt die erste ausgewählte Rolle (Backward-Compat), target_role_ids
   *  trägt die vollständige Mehrfachauswahl. */
  target_role_id?: string | null;
  target_role_name?: string | null;
  target_role_ids?: string[] | null;
  target_role_names?: string[] | null;
  /** Siehe bereich_key/-label/-keys/-labels in OrbitCourse oben — im Kursformular Pflichtfeld (mind. 1). */
  bereich_key?: string | null;
  bereich_label?: string | null;
  bereich_keys?: string[] | null;
  bereich_labels?: string[] | null;
  /** Siehe location/is_remote/location_mode in OrbitCourse oben. */
  location?: string | null;
  is_remote?: boolean | null;
  location_mode?: LocationMode | null;
  /** Siehe employment_mode in OrbitCourse oben. */
  employment_mode?: EmploymentMode | null;
  starts_at?: string | null;
  seats_remaining?: number | null;
  custom_banner?: string | null;
  /** Siehe ausführlichen Kommentar an denselben Feldern in OrbitCourse oben. */
  price_eur?: number | null;
  price_vat_exempt?: boolean | null;
  exam_fee_eur?: number | null;
  teaching_units?: number | null;
  funding_types?: FundingType[] | null;
  funding_measure_number?: string | null;
  qualification_type?: QualificationType | null;
  dqr_level?: number | null;
  target_group?: string | null;
  /** Siehe booking_url in OrbitCourse oben — im Kursformular Pflichtfeld. */
  booking_url?: string | null;
  /** Siehe course_category in OrbitCourse oben. */
  course_category?: CourseCategory | null;
}

// ---------- Test-Tracking (POST /api/v1/orbit/tests, .../recommendation) ----------
//
// Erfasst JEDEN abgeschlossenen Skill-Check aus der Journey, auch wenn der
// Nutzer danach abspringt und nie einen Lead abschickt — Grundlage für die
// "Anzahl der Tests"-Kennzahl im Dashboard (siehe Version 14).

export interface TestCreateRequest {
  target_role_id: string;
  target_role_name: string;
  match_percentage: number;
  gap_skill_count: number;
  gap_skill_labels: string[];
}

export interface TestResponse {
  test_id: number;
  tenant_id: string;
  created_at: string;
  target_role_id: string;
  target_role_name: string;
  match_percentage: number;
  gap_skill_count: number;
  gap_skill_labels: string[];
  recommended_course_id: string | null;
  recommended_course_name: string | null;
}

// ---------- Dashboard-Reports (GET /api/v1/orbit/reports) ----------

export interface TopCourse {
  course_id: string;
  course_name: string;
  lead_count: number;
}

export interface SkillGapStat {
  skill_name: string;
  /** Anzahl Tests (bzw. vor Version 14: Leads), denen dieser Skill fehlt. */
  lead_count: number;
  /** Anteil aller Tests/Leads dieses Tenants, denen dieser Skill fehlt (0-100). */
  percentage: number;
}

export interface OrbitReportResponse {
  tenant_id: string;
  total_leads: number;
  qualified_leads: number;
  /** Anzahl Leads, die der Bildungsträger im Dashboard als "gebucht" markiert hat. */
  booked_leads: number;
  average_match_percentage: number;
  /**
   * Anteil der Leads (in %), die nach Abschluss des empfohlenen Kurses den
   * Qualifizierungs-Schwellenwert erreichen würden (qualified_leads / total_leads).
   */
  conversion_rate: number;
  /** Anzahl abgeschlossener Skill-Checks aus der Journey, inkl. Abbrechern ohne Lead. */
  total_tests: number;
  /** Wie viele dieser Tests tatsächlich bis zu einer Kursempfehlung kamen. */
  tests_with_recommendation: number;
  /** Anzahl unterschiedlicher Skills, die irgendeinem Nutzer als Gap aufgefallen sind. */
  distinct_skill_gap_count: number;
  top_courses: TopCourse[];
  /** Die am häufigsten fehlenden Skills über alle Tests dieses Tenants, absteigend sortiert (max. 10). */
  top_skill_gaps: SkillGapStat[];
}

// ---------- CV-Tiefenanalyse (POST auf die EIGENSTAENDIGE Function
// "cv-depth-analysis", NICHT Teil von "api" - eigene URL, siehe
// depthAnalysisBaseUrl() unten) ----------
//
// Ergaenzt die schnelle ESCO-Fuzzy-Gap-Analyse (fetchGapAnalysis in core.ts)
// um eine LLM-Einschaetzung pro Skill mit woertlichem Beleg-Zitat aus dem
// Lebenslauf-Text. Bewusst NICHT der primaere Gap-Ergebnis-Pfad, sondern eine
// zusaetzliche Anreicherung - schlaegt sie fehl, bleibt die schnelle
// Fuzzy-Analyse trotzdem nutzbar (siehe runDepthAnalysis() in JourneyPage.tsx).

export interface DepthAnalysisRequest {
  /** Derselbe Lebenslauf-/Freitext, der auch an fetchGapAnalysis ging. */
  text: string;
  /** Echte Rolle oder synthetische bereich:* Rolle. */
  target_role_id: string;
  /** Bei bereich:* wird die serverseitige Rollen-Skill-Liste durch diese
   * verifizierbaren ESCO-URIs ersetzt. Für normale Rollen nicht nötig. */
  skill_uris?: string[];
  /** Gewichte der Bereichs-Skills; nur für den synthetischen Bereichspfad. */
  skill_weights?: Record<string, number>;
  target_role_name?: string;
}

export interface DepthSkillAssessment {
  esco_uri: string;
  preferred_label: string;
  weight: number;
  evidence_found: boolean;
  confidence: "hoch" | "mittel" | "niedrig" | null;
  evidence_quote: string | null;
  explanation: string;
  /**
   * "Version 2" der cv-depth-analysis Edge Function (12.09.2026): unterscheidet,
   * ob ein Skill wörtlich im Text vorkommt ("direkt") oder nur aus einer
   * anders beschriebenen Tätigkeit/Erfahrung nachvollziehbar abgeleitet wurde
   * ("transferierbar") — macht die "Zusammenhänge erkennen"-Fähigkeit der
   * KI-Tiefenanalyse erstmals sichtbar statt nur implizit im Freitext von
   * `explanation` versteckt. Optional/additiv wie überall sonst in diesem
   * Projekt — ein älteres Backend, das dieses Feld noch nicht kennt, liefert
   * es einfach nicht mit (undefined), die UI fällt dann auf die reine
   * evidence_found/confidence-Unterscheidung zurück.
   */
  evidence_type?: "direkt" | "transferierbar" | "keine" | null;
  /**
   * "Version 3" der cv-depth-analysis Edge Function (12.09.2026): grobe,
   * ehrliche Einordnung der Tiefe der gefundenen Erfahrung — nur gesetzt,
   * wenn evidence_type "direkt" oder "transferierbar" ist (sonst null).
   * Optional/additiv wie evidence_type.
   */
  proficiency_level?: "grundkenntnisse" | "fortgeschritten" | "experte" | null;
}

export interface DepthAnalysisResponse {
  tenant_id: string;
  target_role_id: string;
  target_role_name: string;
  model: string;
  skills: DepthSkillAssessment[];
  /**
   * "Version 3" (12.09.2026): kurze, ganzheitliche Experten-Einschätzung
   * (2-4 Sätze) über alle Skills hinweg — auf Wunsch "aus Sicht einer
   * Weiterbildungsberatung und einem der besten HR-Manager der Welt".
   * Ausdrücklich nur eine Zusammenfassung der bereits pro Skill getroffenen
   * Einschätzungen, keine neuen Behauptungen über den Lebenslauf. Optional,
   * damit ein älteres Backend ohne dieses Feld die Journey nicht bricht.
   */
  overall_assessment?: string | null;
}

/** Leitet die URL der separaten "cv-depth-analysis"-Function aus der
 * "api"-Basis-URL ab (z.B. ".../functions/v1/api" ->
 * ".../functions/v1/cv-depth-analysis"). Beide Functions liegen in
 * derselben Supabase-Projekt-URL, sind aber zwei getrennte Deployments mit
 * je eigenem Pfad - siehe Kopfkommentar von cv-depth-analysis/index.ts. */
export function depthAnalysisBaseUrl(apiBase: string): string {
  return apiBase.replace(/\/functions\/v1\/api\/?$/, "/functions/v1/cv-depth-analysis");
}

/** Ruft die "cv-depth-analysis"-Function auf (eigene URL, siehe
 * depthAnalysisBaseUrl). apiBase hier ist bereits die volle Function-URL,
 * kein weiterer Pfad noetig - die Function hat nur einen einzigen Endpunkt. */
export function fetchDepthAnalysis(
  depthApiBase: string,
  apiKey: string,
  payload: DepthAnalysisRequest
): Promise<DepthAnalysisResponse> {
  return requestJson<DepthAnalysisResponse>(depthApiBase, apiKey, "", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

// ---------- Kurs-Skill-Erfahrungslevel per KI (POST auf die EIGENSTAENDIGE
// Function "skill-level-detect", NICHT Teil von "api" - eigene URL, analog
// depthAnalysisBaseUrl oben) ----------
//
// Ergaenzt die sofortige, lokale Heuristik (guessExperienceLevel in
// lib/skillLevel.ts) um eine LLM-Einschaetzung je Skill mit Beleg-Zitat aus
// der Kursbeschreibung — fuer den Moment, in dem die einfache Heuristik zu
// unsicher ist (z.B. kein Jahres-/Signalwort im Text). Bewusst NICHT der
// primaere Pfad: schlaegt der Aufruf fehl (Function noch nicht deployt,
// Netzwerkfehler o.ae.), bleibt die lokale Heuristik trotzdem nutzbar, siehe
// handleRefineSkillLevels() in DashboardPage.tsx. Diese Function existiert
// im Backend noch NICHT von Haus aus — Code + Deploy-Anleitung dafuer siehe
// SUPABASE_FUNCTION_skill-level-detect.md im Projekt-Root.

export interface SkillLevelDetectRequest {
  /** Derselbe Text, der auch an fetchSkillMatch ging (Kursbeschreibung). */
  text: string;
  /** Die bereits per ESCO-Fuzzy-Matching erkannten Skills, für die ein Level ermittelt werden soll. */
  skills: { esco_uri: string; preferred_label: string }[];
}

export interface SkillLevelDetectResult {
  esco_uri: string;
  experience_level: ExperienceLevel;
  confidence: "hoch" | "mittel" | "niedrig";
  /** Wörtliches Zitat aus dem Text, das die Einschätzung stützt — leer, wenn kein klarer Beleg gefunden wurde. */
  evidence_quote: string | null;
}

export interface SkillLevelDetectResponse {
  tenant_id: string;
  model: string;
  results: SkillLevelDetectResult[];
}

/** Leitet die URL der separaten "skill-level-detect"-Function aus der
 * "api"-Basis-URL ab — analog depthAnalysisBaseUrl(). */
export function skillLevelDetectBaseUrl(apiBase: string): string {
  return apiBase.replace(/\/functions\/v1\/api\/?$/, "/functions/v1/skill-level-detect");
}

/** Ruft die "skill-level-detect"-Function auf (eigene URL, siehe
 * skillLevelDetectBaseUrl). apiBase hier ist bereits die volle Function-URL. */
export function fetchSkillLevelDetect(
  levelApiBase: string,
  apiKey: string,
  payload: SkillLevelDetectRequest
): Promise<SkillLevelDetectResponse> {
  return requestJson<SkillLevelDetectResponse>(levelApiBase, apiKey, "", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

// ---------- Kurstext-Assistent (POST auf die EIGENSTAENDIGE Function
// "course-copy-assist", NICHT Teil von "api" - eigene URL, analog
// skillLevelDetectBaseUrl/depthAnalysisBaseUrl oben) ----------
//
// Liefert ZWEI Dinge in einem Aufruf: einen fertigen, conversion-optimierten
// Beschreibungsvorschlag sowie einen kompakten "Skill-Fokus-Text" fuer den
// NACHGELAGERTEN echten ESCO-Fuzzy-Matcher (fetchSkillMatch) — diese
// Function selbst ordnet keine ESCO-URIs zu, siehe Kommentar in
// SUPABASE_FUNCTION_course-copy-assist.md. Existiert im Backend noch NICHT
// von Haus aus — Code + Deploy-Anleitung siehe genau diese Datei im
// Projekt-Root. Ohne diese Function bleiben die betroffenen Buttons im
// Dashboard nutzbar, zeigen aber nur einen Hinweis statt eines Vorschlags
// (siehe handleSuggestDescription/handleAnalyzeHandbook in DashboardPage.tsx).

export interface CourseCopyAssistRequest {
  course_name: string;
  /**
   * Rohtext, aus dem generiert wird — entweder der bisherige
   * Beschreibungs-Entwurf oder ein bewusst kompakter Digest (Dokument-Anfang
   * + bereits per ESCO-Fuzzy-Match erkannte Skill-Namen, siehe
   * runHandbookAnalysis in DashboardPage.tsx) bei einem hochgeladenen
   * Modulhandbuch.
   */
  raw_text: string;
}

export interface CourseCopyAssistResponse {
  tenant_id: string;
  model: string;
  /** Fertiger Vorschlag fürs Beschreibungsfeld — bleibt frei editierbar. */
  suggested_description: string;
  /** Dichte Stichwortliste, gedacht als Eingabe für fetchSkillMatch — kein Ersatz für echtes ESCO-Matching. */
  skill_focus_text: string;
}

/** Leitet die URL der separaten "course-copy-assist"-Function aus der
 * "api"-Basis-URL ab — analog skillLevelDetectBaseUrl(). */
export function courseCopyAssistBaseUrl(apiBase: string): string {
  return apiBase.replace(/\/functions\/v1\/api\/?$/, "/functions/v1/course-copy-assist");
}

/** Ruft die "course-copy-assist"-Function auf (eigene URL, siehe
 * courseCopyAssistBaseUrl). apiBase hier ist bereits die volle Function-URL. */
export function fetchCourseCopyAssist(
  copyAssistApiBase: string,
  apiKey: string,
  payload: CourseCopyAssistRequest
): Promise<CourseCopyAssistResponse> {
  return requestJson<CourseCopyAssistResponse>(copyAssistApiBase, apiKey, "", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

// ---------- Kurs-Import per URL/Domain (POST auf die EIGENSTAENDIGE
// Function "course-url-import", NICHT Teil von "api" - eigene URL, analog
// courseCopyAssistBaseUrl oben) ----------
//
// Dritter Weg, Kurse anzulegen (14.09.2026, "automatisch Kurse inkl. aller
// Daten von der Domain eines Bildungstraegers einfliessen lassen als
// zusaetzliche Moeglichkeit"), neben manuellem Formular und CSV-Import. Zwei
// Modi derselben Function: "discover" (Domain -> sitemap.xml -> gefilterte
// Kurs-URL-Kandidaten, KEIN LLM-Aufruf) und "extract" (eine Kurs-URL -> Seite
// laden -> LLM-Extraktion als Entwurf, mit serverseitig verifizierten
// Belegzitaten fuer die sechs vertrauenskritischen Felder, siehe
// verified_fields unten). Existiert im Backend noch NICHT von Haus aus - Code
// + Deploy-Anleitung siehe course-url-import-index.ts /
// SUPABASE_FUNCTION_course-url-import.md im Projekt-Root. Ohne diese Function
// bleibt der Rest des Dashboards nutzbar, die neue Import-Sektion zeigt dann
// nur einen Hinweis statt Ergebnissen (siehe handleDiscoverCourseUrls/
// handleExtractCourseUrl in DashboardPage.tsx).

export interface CourseUrlDiscoverRequest {
  /** Domain des Bildungstraegers, z.B. "https://www.ihk-biz.de" oder auch
   *  ohne Schema ("www.ihk-biz.de") - die Function ergaenzt "https://". */
  domain: string;
}

export interface CourseUrlDiscoverResponse {
  tenant_id: string;
  mode: "discover";
  sitemap_url: string;
  /** Nach Kurs-typischen URL-Mustern gefilterte Kandidaten (max. 80) - noch
   *  KEINE Kursdaten, nur URLs zur Auswahl vor der eigentlichen (teuren)
   *  Extraktion. */
  candidate_urls: string[];
  scanned_total: number;
  /** true, wenn die Sitemap mehr Eintraege/Kandidaten enthielt als
   *  zurueckgegeben wurden - Hinweis fuers UI, dass ggf. nicht ALLE Kurse der
   *  Website gefunden wurden. */
  truncated: boolean;
}

export interface CourseUrlExtractRequest {
  url: string;
}

/** Entwurfsfelder, die "course-url-import" (mode "extract") aus einer
 *  Kurs-Seite herausliest - dieselben Namen wie in CourseUpsertRequest,
 *  damit sich das Ergebnis 1:1 als Vorbefuellung fuer das bestehende
 *  Kursformular nutzen laesst. Jedes Feld ist null, wenn auf der Seite nicht
 *  gefunden bzw. (bei den beleg-pflichtigen Feldern, inkl. starts_at seit
 *  Version 2) das Belegzitat nicht verifizierbar war - siehe verified_fields
 *  unten. Absichtlich OHNE course_id/covered_skill_uris/target_role_id usw. -
 *  das bleibt wie beim manuellen Anlegen Sache des Bildungstraegers im
 *  Formular (Skills werden stattdessen automatisch aus der uebernommenen
 *  description erkannt, siehe applyCourseUrlDraftToForm in DashboardPage.tsx). */
export interface CourseUrlExtractDraft {
  course_name: string | null;
  provider: string | null;
  description: string | null;
  duration_weeks: number | null;
  teaching_units: number | null;
  price_eur: number | null;
  price_vat_exempt: boolean | null;
  exam_fee_eur: number | null;
  funding_types: FundingType[];
  funding_measure_number: string | null;
  qualification_type: QualificationType | null;
  dqr_level: number | null;
  target_group: string | null;
  location_mode: LocationMode | null;
  employment_mode: EmploymentMode | null;
  starts_at: string | null;
  /** Woertliche Dauer-Rohangabe (z.B. "89 Stunden ..."), NUR gefuellt wenn
   *  teaching_units null blieb, weil die Seite keine explizite UE-Angabe
   *  macht - siehe ausfuehrlichen Kommentar im Backend (course-url-import-
   *  index.ts). Rein informativ, wird nirgends automatisch verrechnet. */
  duration_hint: string | null;
}

export interface CourseUrlExtractResponse {
  tenant_id: string;
  mode: "extract";
  model: string;
  /** Die tatsaechlich geladene URL (nach evtl. Redirects) - kann von der
   *  angefragten url abweichen. */
  source_url: string;
  course: CourseUrlExtractDraft;
  /**
   * Welche Feldnamen aus course ein woertlich auf der Seite gefundenes
   * Belegzitat hatten (price_eur, price_vat_exempt, exam_fee_eur,
   * funding_types, funding_measure_number, qualification_type, dqr_level -
   * siehe sanitizeEvidence() in der Function). Fuers UI: diese Felder als
   * "von der Seite bestaetigt" markieren; alle anderen (auch Felder ohne
   * Beleg-Pflicht wie course_name/description/target_group) als
   * unverifiziert kennzeichnen - vor dem Speichern bewusst genauso pruefbar
   * wie eine manuelle Eingabe, nie blind uebernommen.
   */
  verified_fields: string[];
}

/** Leitet die URL der separaten "course-url-import"-Function aus der
 * "api"-Basis-URL ab - analog courseCopyAssistBaseUrl(). */
export function courseUrlImportBaseUrl(apiBase: string): string {
  return apiBase.replace(/\/functions\/v1\/api\/?$/, "/functions/v1/course-url-import");
}

/** Ruft "course-url-import" im mode "discover" auf (eigene URL, siehe
 * courseUrlImportBaseUrl). urlImportApiBase ist bereits die volle
 * Function-URL. */
export function fetchCourseUrlDiscover(
  urlImportApiBase: string,
  apiKey: string,
  payload: CourseUrlDiscoverRequest
): Promise<CourseUrlDiscoverResponse> {
  return requestJson<CourseUrlDiscoverResponse>(urlImportApiBase, apiKey, "", {
    method: "POST",
    body: JSON.stringify({ mode: "discover", ...payload }),
  });
}

/** Ruft "course-url-import" im mode "extract" auf (eigene URL, siehe
 * courseUrlImportBaseUrl). urlImportApiBase ist bereits die volle
 * Function-URL. */
export function fetchCourseUrlExtract(
  urlImportApiBase: string,
  apiKey: string,
  payload: CourseUrlExtractRequest
): Promise<CourseUrlExtractResponse> {
  return requestJson<CourseUrlExtractResponse>(urlImportApiBase, apiKey, "", {
    method: "POST",
    body: JSON.stringify({ mode: "extract", ...payload }),
  });
}

// ---------- Default-Werte ----------

export const DEFAULT_MIN_SCORE = 60.0;
export const DEFAULT_QUALIFICATION_THRESHOLD = 80.0;

// ---------- Fetch-Hilfsfunktionen ----------
//
// apiBase: z.B. "http://127.0.0.1:8000" (lokal) oder deine spätere
//          deployte API-Adresse.
// apiKey:  dein X-API-Key (z.B. "demo-key-orbit" für lokale Tests,
//          später ein echter, pro Bildungsträger ausgegebener Key).

async function requestJson<TResponse>(
  apiBase: string,
  apiKey: string,
  path: string,
  init?: RequestInit
): Promise<TResponse> {
  const res = await fetch(`${apiBase.replace(/\/$/, "")}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      "X-API-Key": apiKey,
      ...(init?.headers ?? {}),
    },
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    console.error(`Anfrage an ${path} fehlgeschlagen (HTTP ${res.status})`, body);
    throw new Error(genericRequestError(res.status));
  }

  return res.json() as Promise<TResponse>;
}

/** Ruft POST /api/v1/orbit/course-match auf. */
export function fetchCourseMatch(
  apiBase: string,
  apiKey: string,
  payload: CourseMatchRequest
): Promise<CourseMatchResponse> {
  return requestJson<CourseMatchResponse>(apiBase, apiKey, "/api/v1/orbit/course-match", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

/** Ruft POST /api/v1/orbit/leads auf — legt einen neuen Lead an. */
export function createLead(
  apiBase: string,
  apiKey: string,
  payload: LeadCreateRequest
): Promise<LeadResponse> {
  return requestJson<LeadResponse>(apiBase, apiKey, "/api/v1/orbit/leads", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

/** Ruft GET /api/v1/orbit/leads auf — listet alle Leads des Tenants. */
export function fetchLeads(apiBase: string, apiKey: string): Promise<LeadListResponse> {
  return requestJson<LeadListResponse>(apiBase, apiKey, "/api/v1/orbit/leads", {
    method: "GET",
  });
}

/** Ruft GET /api/v1/orbit/reports auf — Dashboard-Kennzahlen des Tenants. */
export function fetchOrbitReport(apiBase: string, apiKey: string): Promise<OrbitReportResponse> {
  return requestJson<OrbitReportResponse>(apiBase, apiKey, "/api/v1/orbit/reports", {
    method: "GET",
  });
}

/**
 * Ruft DELETE /api/v1/orbit/leads/:id auf — löscht einen Lead unwiderruflich
 * (Version 28, Recht auf Löschung / Art. 17 DSGVO — siehe "Lead endgültig
 * löschen" im Lead-Detail-Modal in DashboardPage.tsx).
 *
 * Eigene, schlanke Implementierung statt requestJson() oben: eine DELETE-
 * Antwort hat meist KEINEN JSON-Body (häufig HTTP 204 No Content) —
 * requestJson() würde bei leerem Body an res.json() scheitern. Wichtiger
 * Hinweis (additiv wie die übrigen neuen Endpunkte in diesem Projekt): dieser
 * Endpunkt existiert hiermit im Frontend-Vertrag, muss aber im Backend
 * (Supabase Edge Function "api") noch angelegt werden, falls er dort noch
 * nicht existiert — ohne serverseitige Implementierung liefert der Aufruf
 * einen 404/405-Fehler.
 */
export async function deleteLead(apiBase: string, apiKey: string, leadId: string): Promise<void> {
  const res = await fetch(`${apiBase.replace(/\/$/, "")}/api/v1/orbit/leads/${encodeURIComponent(leadId)}`, {
    method: "DELETE",
    headers: {
      "X-API-Key": apiKey,
    },
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    console.error(`Anfrage an /api/v1/orbit/leads/${leadId} (DELETE) fehlgeschlagen (HTTP ${res.status})`, body);
    throw new Error(genericRequestError(res.status));
  }
}

/** Ruft POST /api/v1/orbit/leads/:id/booking auf — setzt/entfernt den Buchungsstatus eines Leads. */
export function setLeadBooked(
  apiBase: string,
  apiKey: string,
  leadId: string,
  booked: boolean
): Promise<LeadResponse> {
  return requestJson<LeadResponse>(apiBase, apiKey, `/api/v1/orbit/leads/${encodeURIComponent(leadId)}/booking`, {
    method: "POST",
    body: JSON.stringify({ booked }),
  });
}

/** Ruft POST /api/v1/orbit/leads/:id/consultation auf — markiert/entfernt
 * "Beratungsgespräch durchgeführt" (Version 21). Genau dasselbe Muster wie
 * setLeadBooked oben, nur fürs Beratungsgespräch statt für die Kursbuchung —
 * das Datum (consultation_completed_at) setzt ausschliesslich der Server. */
export function setLeadConsultationCompleted(
  apiBase: string,
  apiKey: string,
  leadId: string,
  consultationCompleted: boolean
): Promise<LeadResponse> {
  return requestJson<LeadResponse>(
    apiBase,
    apiKey,
    `/api/v1/orbit/leads/${encodeURIComponent(leadId)}/consultation`,
    {
      method: "POST",
      body: JSON.stringify({ consultation_completed: consultationCompleted }),
    }
  );
}

/** Ruft POST /api/v1/orbit/leads/:id/consultation-schedule auf — trägt das
 * Termin-Datum ein oder löscht es (Version 22, siehe consultation_scheduled_for
 * oben). Getrennt von setLeadConsultationCompleted: dieses Datum ist WANN der
 * Termin vereinbart wurde/stattfinden soll, nicht ob er schon durchgeführt
 * wurde. scheduledFor: "YYYY-MM-DD" oder null, um den Termin zu entfernen. */
export function setLeadConsultationScheduled(
  apiBase: string,
  apiKey: string,
  leadId: string,
  scheduledFor: string | null
): Promise<LeadResponse> {
  return requestJson<LeadResponse>(
    apiBase,
    apiKey,
    `/api/v1/orbit/leads/${encodeURIComponent(leadId)}/consultation-schedule`,
    {
      method: "POST",
      body: JSON.stringify({ consultation_scheduled_for: scheduledFor }),
    }
  );
}

/** Ruft POST /api/v1/orbit/leads/:id/consultation-request auf — aktiviert
 * (oder deaktiviert) das Beratungsgespräch-Feld manuell für einen Lead
 * (Version 23), auch wenn die Person selbst in der Journey keins angefragt
 * hat. Genau dasselbe Feld wie consultation_requested aus der Journey, nur
 * hier vom Bildungsträger nachträglich gesetzt statt beim Absenden. */
export function setLeadConsultationRequested(
  apiBase: string,
  apiKey: string,
  leadId: string,
  requested: boolean
): Promise<LeadResponse> {
  return requestJson<LeadResponse>(
    apiBase,
    apiKey,
    `/api/v1/orbit/leads/${encodeURIComponent(leadId)}/consultation-request`,
    {
      method: "POST",
      body: JSON.stringify({ consultation_requested: requested }),
    }
  );
}

/** Ruft POST /api/v1/orbit/leads/:id/assign auf — weist einen Lead einem
 * Bearbeiter zu oder entfernt die Zuweisung (Version 23, siehe assigned_to
 * oben). assignedTo: freier Name/Kürzel oder null zum Entfernen. */
export function setLeadAssignedTo(
  apiBase: string,
  apiKey: string,
  leadId: string,
  assignedTo: string | null
): Promise<LeadResponse> {
  return requestJson<LeadResponse>(apiBase, apiKey, `/api/v1/orbit/leads/${encodeURIComponent(leadId)}/assign`, {
    method: "POST",
    body: JSON.stringify({ assigned_to: assignedTo }),
  });
}

/** Ruft POST /api/v1/orbit/leads/:id/linked-courses auf — setzt die Liste
 * der manuell verlinkten Kurse eines Leads (Version 23, siehe
 * linked_course_ids oben) — ersetzt jeweils die komplette Liste, nicht
 * additiv (einfacher: Dashboard schickt immer den vollständigen Soll-Zustand). */
export function setLeadLinkedCourses(
  apiBase: string,
  apiKey: string,
  leadId: string,
  courseIds: string[]
): Promise<LeadResponse> {
  return requestJson<LeadResponse>(
    apiBase,
    apiKey,
    `/api/v1/orbit/leads/${encodeURIComponent(leadId)}/linked-courses`,
    {
      method: "POST",
      body: JSON.stringify({ course_ids: courseIds }),
    }
  );
}

/**
 * Antwort von GET /api/v1/tenant/me (Version 42, 17.09.) — der in Supabase
 * (Tabelle api_keys) hinterlegte Mandanten-Name/-ID zum verwendeten API-Key.
 * NEU, additiv: ein Backend, das diesen Endpunkt noch nicht kennt, liefert
 * einfach 404 — fetchTenantInfo() schlägt dann fehl und DashboardPage.tsx
 * fällt auf den per Prop mitgegebenen tenantName-Default zurück (siehe
 * effectiveTenantName dort), kein Blocker fürs restliche Dashboard.
 */
export interface TenantInfoResponse {
  tenant_id: string;
  tenant_name: string;
}

/** Ruft GET /api/v1/tenant/me auf — Name/ID des Mandanten zum aktuellen API-Key. */
export function fetchTenantInfo(apiBase: string, apiKey: string): Promise<TenantInfoResponse> {
  return requestJson<TenantInfoResponse>(apiBase, apiKey, "/api/v1/tenant/me", {
    method: "GET",
  });
}

/** Ruft GET /api/v1/orbit/courses auf — listet den Kurskatalog des Tenants (inkl. is_featured). */
export function fetchCourses(apiBase: string, apiKey: string): Promise<CourseListResponse> {
  return requestJson<CourseListResponse>(apiBase, apiKey, "/api/v1/orbit/courses", {
    method: "GET",
  });
}

/** Ruft POST /api/v1/orbit/courses auf — legt einen Kurs an oder aktualisiert ihn (Upsert nach course_id). */
export function upsertCourse(
  apiBase: string,
  apiKey: string,
  payload: CourseUpsertRequest
): Promise<OrbitCourse> {
  return requestJson<OrbitCourse>(apiBase, apiKey, "/api/v1/orbit/courses", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

/** Ruft POST /api/v1/orbit/courses/:id/featured auf — markiert/entfernt einen Kurs als "Top"-Weiterbildung. */
export function setCourseFeatured(
  apiBase: string,
  apiKey: string,
  courseId: string,
  featured: boolean
): Promise<OrbitCourse> {
  return requestJson<OrbitCourse>(apiBase, apiKey, `/api/v1/orbit/courses/${encodeURIComponent(courseId)}/featured`, {
    method: "POST",
    body: JSON.stringify({ featured }),
  });
}

/**
 * Ruft POST /api/v1/orbit/tests auf — loggt einen abgeschlossenen Skill-Check
 * (direkt nach der Gap-Analyse in der Journey, bevor der Nutzer weiterklickt).
 * Bewusst fire-and-forget-tauglich im Aufrufer: schlägt dieser Call fehl,
 * soll das die Journey für den Endnutzer NICHT unterbrechen.
 */
export function createTest(apiBase: string, apiKey: string, payload: TestCreateRequest): Promise<TestResponse> {
  return requestJson<TestResponse>(apiBase, apiKey, "/api/v1/orbit/tests", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

/** Ruft POST /api/v1/orbit/tests/:id/recommendation auf — trägt die Kursempfehlung an einem bereits geloggten Test nach. */
export function attachTestRecommendation(
  apiBase: string,
  apiKey: string,
  testId: number,
  courseId: string,
  courseName: string
): Promise<TestResponse> {
  return requestJson<TestResponse>(apiBase, apiKey, `/api/v1/orbit/tests/${testId}/recommendation`, {
    method: "POST",
    body: JSON.stringify({ course_id: courseId, course_name: courseName }),
  });
}