/**
 * TypeScript-Entsprechung der Python-Pydantic-Modelle aus dem DYD-Backend
 * (dyd-skill-api/app/models/schemas.py) für den GEMEINSAMEN Kern, den
 * sowohl NEXUS als auch ORBIT nutzen: Skill-Matching, Gap-Analyse,
 * Zielrollen-Liste und Dokument-Textextraktion (Lebenslauf-Upload).
 *
 * Diese Datei gehört in dein Bolt-/TypeScript-Frontend, NICHT in das
 * Python-Projekt. Sie enthält nur Typen + kleine fetch()-Hilfsfunktionen,
 * damit Bolt die API korrekt aufrufen und die Antworten typsicher
 * verarbeiten kann. Keine eigene Geschäftslogik — die läuft ausschließlich
 * im Python-Backend.
 */

// ---------- Skill-Matching (POST /api/v1/skill-match) ----------

export interface SkillMatchRequest {
  /** Freitext, z.B. Lebenslauf-Abschnitt, Stellenbeschreibung oder Selbstauskunft. */
  text: string;
  /** Backend-Default: 10 (1-50) */
  max_results?: number;
  /** Minimaler Fuzzy-Match-Score (0-100). Backend-Default: 60.0 */
  min_score?: number;
  /**
   * Sprache der zurückgegebenen ESCO-Labels (preferred_label), z.B. "de".
   * Optional/additiv — ein Backend, das diesen Parameter (noch) nicht kennt,
   * ignoriert ihn einfach und liefert weiterhin seine Standardsprache
   * (meist Englisch). Damit deutsche Labels tatsächlich ankommen, muss das
   * Backend eine deutsche ESCO-Übersetzung hinterlegt haben — rein
   * frontend-seitig lässt sich das nicht erzwingen.
   */
  lang?: string;
}

export interface MatchedSkill {
  esco_uri: string;
  preferred_label: string;
  skill_type: string;
  matched_on: string;
  score: number;
}

export interface SkillMatchResponse {
  tenant_id: string;
  input_text: string;
  matches: MatchedSkill[];
}

// ---------- Erfahrungslevel (Kurs-Skill-Zuordnung, ORBIT) ----------
//
// Rein additives Frontend-/UI-Konzept: das Backend kennt Kurs-Skills bisher
// nur als flache ESCO-URI-Liste (covered_skill_uris, siehe orbit.ts). Damit
// ein Backend, das dieses Feld noch nicht kennt, weiterhin normal
// funktioniert, wird das Level NIE anstelle der URI-Liste geschickt, sondern
// zusaetzlich als covered_skills (siehe OrbitCourse/CourseUpsertRequest) -
// ein aelteres Backend ignoriert dieses Zusatzfeld einfach.
//
// Herkunft eines Levels: entweder aus der lokalen Heuristik
// (guessExperienceLevel in lib/skillLevel.ts, sofort, ohne Netzwerk-Call)
// oder - optional, praeziser - aus der KI-Verfeinerung
// (fetchSkillLevelDetect in orbit.ts). Beides liefert nur einen VORSCHLAG:
// im Dashboard bleibt jedes Level ueber die Chips frei veraenderbar, siehe
// courseSkillLevels in DashboardPage.tsx.

export type ExperienceLevel = "grundkenntnisse" | "fortgeschritten" | "experte";

export const EXPERIENCE_LEVEL_ORDER: ExperienceLevel[] = ["grundkenntnisse", "fortgeschritten", "experte"];

export const EXPERIENCE_LEVEL_LABELS: Record<ExperienceLevel, string> = {
  grundkenntnisse: "Grundkenntnisse",
  fortgeschritten: "Fortgeschritten",
  experte: "Experte",
};

/** Kurzform fuer Chips/Badges, wo wenig Platz ist. */
export const EXPERIENCE_LEVEL_SHORT_LABELS: Record<ExperienceLevel, string> = {
  grundkenntnisse: "Grund",
  fortgeschritten: "Fortg.",
  experte: "Experte",
};

// ---------- Gap-Analyse (POST /api/v1/gap-analysis) ----------

export interface GapAnalysisRequest {
  /** Freitext-Profil der Person (siehe SkillMatchRequest). Leer lassen, um
   *  ALLE benötigten Skills einer Zielrolle als gap_skills zurückzubekommen
   *  (Trick für den Fragebogen: nichts matcht bei leerem Text). */
  text: string;
  /** ID der Zielrolle, siehe GET /api/v1/target-roles. */
  target_role_id: string;
  /** Minimaler Fuzzy-Match-Score (0-100). Backend-Default: 60.0 */
  min_score?: number;
  /** Siehe lang in SkillMatchRequest oben — dieselbe additive Sprachangabe
   *  für die preferred_label-Werte in covered_skills/gap_skills. */
  lang?: string;
}

export interface RoleSkillStatus {
  esco_uri: string;
  preferred_label: string;
  weight: number;
  covered: boolean;
  matched_score: number | null;
}

export interface GapAnalysisResponse {
  tenant_id: string;
  target_role_id: string;
  target_role_name: string;
  match_percentage: number;
  covered_skills: RoleSkillStatus[];
  gap_skills: RoleSkillStatus[];
}

// ---------- Zielrollen (GET /api/v1/target-roles) ----------

export interface TargetRole {
  role_id: string;
  role_name: string;
  required_skill_count: number;
}

// ---------- Zielrollen-Verwaltung (Version 24) ----------
//
// Bisher liess sich eine neue Zielrolle nur per SQL im Supabase SQL Editor
// anlegen. Damit man sie direkt im Kurs-Formular anlegen kann ("+ Neue
// Zielrolle"), braucht es zwei zusätzliche, bereits serverseitig
// existierende Endpunkte: eine Skill-Suche (um esco_uris nachzuschlagen,
// ohne sie auswendig zu kennen) und das Anlegen/Ersetzen einer Zielrolle
// selbst. WICHTIG: POST /api/v1/target-roles erfordert einen API-Key mit
// Produkt "admin" oder "all" (siehe requireProduct() im Backend) — ein
// normaler Bildungsträger-Key mit nur "orbit" kann Zielrollen weiterhin
// nur LESEN. Schlägt der Aufruf mit "Zugriff verweigert" fehl, liegt es
// höchstwahrscheinlich daran, nicht an einem Frontend-Bug.

export interface SkillSearchResult {
  esco_uri: string;
  preferred_label: string;
  skill_type: string;
  /** Welches Label (preferred_label oder ein alt_label) den Treffer ausgelöst hat. */
  matched_on: string;
}

export interface SkillSearchResponse {
  query: string;
  results: SkillSearchResult[];
}

export interface TargetRoleSkillInput {
  esco_uri: string;
  /** Gewicht > 0 — wie stark dieser Skill für die Rolle zählt (Standard: 1). */
  weight: number;
}

export interface TargetRoleUpsertRequest {
  role_id: string;
  role_name: string;
  skills: TargetRoleSkillInput[];
}

export interface TargetRoleUpsertResponse {
  role_id: string;
  role_name: string;
  required_skill_count: number;
}

// ---------- Dokument-Textextraktion (POST /api/v1/documents/extract-text) ----------

export interface DocumentExtractResponse {
  filename: string;
  char_count: number;
  text: string;
}

// ---------- Default-Werte ----------

export const DEFAULT_MAX_RESULTS = 10;
export const DEFAULT_MIN_SCORE = 60.0;
/** Sprachcode für ESCO-Labels, siehe lang in SkillMatchRequest/
 *  GapAnalysisRequest — an jeder Aufrufstelle mitgeschickt, damit ESCO-Skills
 *  im Dashboard und in der Journey durchgängig auf Deutsch angezeigt werden
 *  (sofern das Backend eine deutsche Übersetzung hinterlegt hat). */
export const ESCO_LANG = "de";

// ---------- Fetch-Hilfsfunktionen ----------
//
// apiBase: z.B. "http://127.0.0.1:8000" (lokal) oder deine spätere
//          deployte API-Adresse.
// apiKey:  dein X-API-Key (z.B. "demo-key-all" für lokale Tests,
//          später ein echter, pro Kunde ausgegebener Key).

/**
 * Einheitliche, bewusst allgemein gehaltene Fehlermeldung fuer die Oberflaeche.
 * Rohe Serverantworten werden NICHT angezeigt - sie verraten interne Details.
 */
export function genericRequestError(status: number): string {
  if (status === 401 || status === 403) {
    return "Zugriff verweigert. Bitte den API-Key pruefen.";
  }
  if (status === 404) {
    return "Die angeforderten Daten wurden nicht gefunden.";
  }
  if (status === 413) {
    return "Die Datei ist zu gross.";
  }
  if (status === 422 || status === 400) {
    return "Die Eingabe konnte nicht verarbeitet werden. Bitte Angaben pruefen.";
  }
  if (status === 429) {
    return "Zu viele Anfragen. Bitte kurz warten und erneut versuchen.";
  }
  return "Die Anfrage ist fehlgeschlagen. Bitte spaeter erneut versuchen.";
}

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
    // Serverantwort nur in die Entwicklerkonsole, nicht in die Fehlermeldung:
    // sie kann interne Details (Feldnamen, Stacktrace-Fragmente) enthalten.
    const body = await res.text().catch(() => "");
    console.error(`Anfrage an ${path} fehlgeschlagen (HTTP ${res.status})`, body);
    throw new Error(genericRequestError(res.status));
  }

  return res.json() as Promise<TResponse>;
}

/** Ruft POST /api/v1/skill-match auf. */
export function fetchSkillMatch(
  apiBase: string,
  apiKey: string,
  payload: SkillMatchRequest
): Promise<SkillMatchResponse> {
  return requestJson<SkillMatchResponse>(apiBase, apiKey, "/api/v1/skill-match", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

/** Ruft GET /api/v1/target-roles auf. */
export function fetchTargetRoles(apiBase: string, apiKey: string): Promise<TargetRole[]> {
  return requestJson<TargetRole[]>(apiBase, apiKey, "/api/v1/target-roles", {
    method: "GET",
  });
}

/** Ruft GET /api/v1/skills/search?q=... auf — sucht ESCO-Skills nach Namen,
 *  z.B. beim Zusammenstellen des Skill-Profils einer neuen Zielrolle. Leere
 *  Anfrage liefert bewusst kein Ergebnis (kein sinnvoller "alle Skills"-Call). */
export function searchEscoSkills(
  apiBase: string,
  apiKey: string,
  query: string,
  maxResults = 20
): Promise<SkillSearchResponse> {
  const q = query.trim();
  if (!q) return Promise.resolve({ query: "", results: [] });
  const params = new URLSearchParams({ q, max_results: String(maxResults) });
  return requestJson<SkillSearchResponse>(apiBase, apiKey, `/api/v1/skills/search?${params.toString()}`, {
    method: "GET",
  });
}

/** Ruft POST /api/v1/target-roles auf — legt eine Zielrolle an oder ersetzt
 *  ihr komplettes Skill-Profil (Upsert nach role_id). Braucht Produkt
 *  "admin" oder "all", siehe Kommentar bei TargetRoleUpsertRequest oben. */
export function upsertTargetRole(
  apiBase: string,
  apiKey: string,
  payload: TargetRoleUpsertRequest
): Promise<TargetRoleUpsertResponse> {
  return requestJson<TargetRoleUpsertResponse>(apiBase, apiKey, "/api/v1/target-roles", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

/** Ruft POST /api/v1/gap-analysis auf. */
export function fetchGapAnalysis(
  apiBase: string,
  apiKey: string,
  payload: GapAnalysisRequest
): Promise<GapAnalysisResponse> {
  return requestJson<GapAnalysisResponse>(apiBase, apiKey, "/api/v1/gap-analysis", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

/**
 * Ruft POST /api/v1/documents/extract-text auf (Lebenslauf-Upload,
 * PDF/DOCX/TXT). Nutzt bewusst KEIN JSON, sondern multipart/form-data,
 * deshalb hier eine eigene Fetch-Variante ohne den "Content-Type:
 * application/json"-Header — der Browser setzt die passende
 * multipart-boundary automatisch, wenn man sie selbst setzt, schlägt
 * der Upload fehl.
 */
export async function extractDocumentText(
  apiBase: string,
  apiKey: string,
  file: File
): Promise<DocumentExtractResponse> {
  const formData = new FormData();
  formData.append("file", file);

  const res = await fetch(`${apiBase.replace(/\/$/, "")}/api/v1/documents/extract-text`, {
    method: "POST",
    headers: {
      "X-API-Key": apiKey,
    },
    body: formData,
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    console.error(`Datei-Upload fehlgeschlagen (HTTP ${res.status})`, body);
    // Anders als requestJson() oben: die "detail"-Meldungen dieses einen
    // Endpunkts (extractPdfText/extractDocText im Backend) sind bewusst als
    // freundlicher, auf Endnutzer zugeschnittener Text geschrieben (z.B.
    // "ist es evtl. ein eingescanntes Bild ohne Text-Ebene?", "Datei ist zu
    // gross", "Dateityp wird nicht unterstuetzt") - die duerfen und sollen
    // deshalb hier tatsaechlich angezeigt werden, statt wie sonst nur in die
    // Konsole zu gehen (sonst landet die Person nur bei einer nichtssagenden
    // "das hat nicht geklappt"-Meldung und weiss nicht, was sie tun soll).
    // Nur bei 401/403/429/5xx (Auth-/Infrastruktur-Fehler, keine inhaltliche
    // Nutzer-Meldung) bleibt es bei der generischen Meldung.
    const showDetail = res.status === 400 || res.status === 404 || res.status === 413 || res.status === 422;
    if (showDetail) {
      let detail: string | undefined;
      try {
        detail = (JSON.parse(body) as { detail?: string } | null)?.detail;
      } catch {
        detail = undefined;
      }
      if (detail) {
        throw new Error(detail);
      }
    }
    throw new Error(genericRequestError(res.status));
  }

  return res.json() as Promise<DocumentExtractResponse>;
}