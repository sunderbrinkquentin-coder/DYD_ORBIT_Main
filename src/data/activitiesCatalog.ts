/**
 * Taetigkeits-Katalog fuer DYD ORBIT (24.09.2026) — Schritt 1 von 3 des
 * Arbeitspakets "Taetigkeits-Ebene" (siehe Projekt-Doc
 * taetigkeits-ebene-2026-09-24.md).
 *
 * WARUM: Viele Menschen aus Transfergesellschaften, von der Arbeitsagentur
 * oder ohne aktuellen Lebenslauf denken nicht in Skill-Begriffen
 * ("Warenwirtschaftssysteme") und auch nicht in Zielrollen-Titeln
 * ("Handelsfachwirt (IHK)"), sondern in dem, was sie im Alltag getan haben
 * ("Warenbewegungen im System gebucht"). Dieser Katalog uebersetzt solche
 * Taetigkeiten in Alltagssprache deterministisch auf Skills, die es im
 * bestehenden Rollen-Katalog (rolesCatalog.ts) bereits gibt.
 *
 * AUFBAU: Sortiert nach HERKUNFTS-Feld (wo hast du gearbeitet?), NICHT nach
 * den sechs Ziel-Bereichen des Rollen-Katalogs — bewusst, weil z. B. Lager,
 * Gastronomie oder Produktion als Herkunft haeufig sind, als Zielbereich im
 * Rollen-Katalog aber (noch) nicht vorkommen. Ihre uebertragbaren Skills
 * (Kundenberatung, Kassensysteme, Warenwirtschaft, Dienstplanung ...) gibt es
 * dort sehr wohl.
 *
 * GRUNDSAETZE (analog zu den bestehenden Projekt-Prinzipien):
 *  - Keine KI im Kernpfad: das Mapping ist handkuratiert und deterministisch.
 *    Gleiche Klicks => immer gleiches Ergebnis (wichtig fuer die
 *    Nachvollziehbarkeit gegenueber Arbeitsagentur/Traegern).
 *  - Keine erfundenen Fakten: eine Taetigkeit erzeugt nur einen VORSCHLAG.
 *    Die Person bestaetigt jeden abgeleiteten Skill selbst (Schritt 2:
 *    Vorbelegung der 3x3-Matrix, nie stilles Setzen als "vorhanden").
 *  - Nur existierende skill_ids: jede hier verwendete skill_id kommt in
 *    mindestens einer Rolle von ROLES_CATALOG vor. Geprueft per Skript bei
 *    der Erstellung; zur Laufzeit ignoriert deriveSkillsFromActivities()
 *    unbekannte IDs zusaetzlich defensiv, statt zu crashen (falls der
 *    Rollen-Katalog spaeter geaendert wird).
 *  - strength "direkt": die Taetigkeit IST praktisch die Anwendung dieses
 *    Skills. "teilweise": die Taetigkeit beruehrt den Skill, ersetzt aber
 *    keine vollwertige Ausuebung. Steuert nur die VORBELEGUNG des Grads in
 *    der Matrix (siehe suggestedProficiency()), nie den Score direkt.
 *
 * kldb_hauptgruppen: Berufshauptgruppen (2-stellig) der Klassifikation der
 * Berufe 2010 (KldB) der Bundesagentur fuer Arbeit, als Bruecke zur Sprache
 * der Vermittlungsfachkraefte (Berater-Export, spaeter). Nur Hauptgruppen-
 * Ebene, keine 5-stelligen Codes — VOR einer produktiven Verwendung im
 * BA-Kontext einmal gegen die offizielle KldB-2010-Systematik
 * (statistik.arbeitsagentur.de) gegenpruefen. Wird aktuell von keiner
 * Matching-Logik gelesen.
 */

import { ROLES_CATALOG } from "./rolesCatalog";

export type ActivityStrength = "direkt" | "teilweise";

export interface ActivitySkillLink {
  skill_id: string;
  strength: ActivityStrength;
}

export interface CatalogActivity {
  activity_id: string;
  /** Alltagssprache, als Antwort auf "Was hast du schon gemacht?". */
  label: string;
  skills: ActivitySkillLink[];
}

export interface ActivityField {
  field_key: string;
  label: string;
  icon: string;
  kldb_hauptgruppen: string[];
  activities: CatalogActivity[];
}

const d = (skill_id: string): ActivitySkillLink => ({ skill_id, strength: "direkt" });
const t = (skill_id: string): ActivitySkillLink => ({ skill_id, strength: "teilweise" });

export const ACTIVITY_FIELDS: ActivityField[] = [
  {
    field_key: "lager-logistik",
    label: "Lager & Logistik",
    icon: "📦",
    kldb_hauptgruppen: ["51"],
    activities: [
      { activity_id: "lager-wareneingang", label: "Waren annehmen, prüfen und einlagern", skills: [t("qualitaetspruefung"), t("bestandsmanagement")] },
      { activity_id: "lager-inventur", label: "Bestände zählen und Inventur machen", skills: [d("bestandsmanagement")] },
      { activity_id: "lager-system-buchen", label: "Warenbewegungen im System buchen (z. B. SAP, Warenwirtschaft)", skills: [d("warenwirtschaftssysteme"), t("erp-systeme")] },
      { activity_id: "lager-kommissionieren", label: "Aufträge zusammenstellen und Versand vorbereiten", skills: [t("logistikplanung")] },
      { activity_id: "lager-retouren", label: "Rücksendungen und Reklamationen bearbeiten", skills: [d("retourenmanagement"), t("reklamationsmanagement")] },
      { activity_id: "lager-touren", label: "Liefertouren oder Liefertermine planen", skills: [d("logistikplanung"), t("terminplanung")] },
      { activity_id: "lager-nachbestellen", label: "Material nachbestellen und Lieferanten ansprechen", skills: [d("materialwirtschaft"), t("lieferantenmanagement")] },
    ],
  },
  {
    field_key: "verkauf-handel",
    label: "Verkauf & Handel",
    icon: "🛍️",
    kldb_hauptgruppen: ["62"],
    activities: [
      { activity_id: "verkauf-beraten", label: "Kundinnen und Kunden beraten", skills: [d("kundenberatung"), t("verkaufsgespraechsfuehrung")] },
      { activity_id: "verkauf-kasse", label: "Kassieren und die Kasse abrechnen", skills: [d("kassensysteme"), t("kassenbuchfuehrung")] },
      { activity_id: "verkauf-praesentieren", label: "Ware einräumen und ansprechend präsentieren", skills: [d("warenpraesentation"), t("verkaufsfoerderung")] },
      { activity_id: "verkauf-reklamation", label: "Reklamationen und Beschwerden annehmen", skills: [d("reklamationsmanagement"), t("beschwerdemanagement")] },
      { activity_id: "verkauf-bestand", label: "Ware bestellen und Bestände im Blick behalten", skills: [d("bestandsmanagement"), t("warenwirtschaftssysteme")] },
      { activity_id: "verkauf-aktionen", label: "Aktionen und Angebote im Laden umsetzen", skills: [d("verkaufsfoerderung"), t("handelsmarketing")] },
      { activity_id: "verkauf-stammkunden", label: "Stammkundschaft betreuen", skills: [d("kundenbindung"), t("kundenbeziehungsmanagement")] },
      { activity_id: "verkauf-angebote", label: "Angebote schreiben und bei Kunden nachfassen", skills: [d("vertriebsunterstuetzung"), t("angebotskalkulation")] },
    ],
  },
  {
    field_key: "buero-verwaltung",
    label: "Büro & Verwaltung",
    icon: "🗂️",
    kldb_hauptgruppen: ["71", "72", "73"],
    activities: [
      { activity_id: "buero-korrespondenz", label: "E-Mails und Briefe an Kunden oder Ämter schreiben", skills: [d("geschaeftskorrespondenz"), t("kundenkommunikation")] },
      { activity_id: "buero-ablage", label: "Ablage und Dokumente organisieren", skills: [d("ablagesysteme"), t("dokumentenmanagement")] },
      { activity_id: "buero-termine", label: "Termine koordinieren und Kalender führen", skills: [d("terminmanagement"), t("buerorganisation")] },
      { activity_id: "buero-rechnungen", label: "Rechnungen prüfen und weiterleiten", skills: [d("rechnungspruefung"), t("kreditorenbuchhaltung")] },
      { activity_id: "buero-buchen", label: "Belege buchen oder vorkontieren", skills: [d("kontierung"), d("buchfuehrung"), t("datev")] },
      { activity_id: "buero-mahnen", label: "Offene Zahlungen nachhalten und Mahnungen schreiben", skills: [d("mahnwesen"), t("debitorenbuchhaltung")] },
      { activity_id: "buero-excel", label: "Listen und Auswertungen in Excel erstellen", skills: [d("excel"), d("ms-office"), t("reporting-dashboards")] },
      { activity_id: "buero-datenpflege", label: "Kunden- oder Artikeldaten im System pflegen", skills: [d("datenpflege"), t("crm-systeme")] },
      { activity_id: "buero-personal", label: "Personalakten, Urlaube oder Krankmeldungen verwalten", skills: [d("personalaktenverwaltung")] },
      { activity_id: "buero-organisieren", label: "Dienstreisen oder Veranstaltungen organisieren", skills: [d("reisemanagement"), d("veranstaltungsorganisation")] },
    ],
  },
  {
    field_key: "produktion-industrie",
    label: "Produktion & Industrie",
    icon: "🏭",
    kldb_hauptgruppen: ["24", "25", "26", "27"],
    activities: [
      { activity_id: "prod-cnc", label: "CNC-Maschinen einrichten und bedienen", skills: [d("cnc-bedienung")] },
      { activity_id: "prod-pruefen", label: "Teile prüfen, messen und Fehler melden", skills: [d("qualitaetskontrolle"), t("messtechnik-mechanik")] },
      { activity_id: "prod-wartung", label: "Maschinen warten und kleinere Störungen beheben", skills: [d("maschineninstandhaltung"), t("fehlerdiagnose-stoerungsbehebung")] },
      { activity_id: "prod-montage", label: "Bauteile oder Anlagen montieren", skills: [d("maschinen-und-anlagenmontage")] },
      { activity_id: "prod-zeichnungen", label: "Nach technischen Zeichnungen arbeiten", skills: [d("technische-zeichnungen-lesen")] },
      { activity_id: "prod-schweissen", label: "Schweißen (z. B. MAG, WIG)", skills: [d("schweisstechniken-mig-mag-wig")] },
      { activity_id: "prod-steuerung", label: "Mit Anlagensteuerungen (SPS) oder Pneumatik arbeiten", skills: [t("sps-steuerungstechnik"), t("pneumatik")] },
      { activity_id: "prod-sicherheit", label: "Auf Arbeitssicherheit achten und Kollegen unterweisen", skills: [t("sicherheitsvorschriften")] },
    ],
  },
  {
    field_key: "handwerk-bau",
    label: "Handwerk & Bau",
    icon: "🔨",
    kldb_hauptgruppen: ["26", "32", "33", "34"],
    activities: [
      { activity_id: "hw-leitungen", label: "Leitungen verlegen und Elektrik anschließen", skills: [d("kabel-und-leitungsverlegung"), t("elektroinstallationstechnik-gebaeude")] },
      { activity_id: "hw-elektro-pruefen", label: "Elektrische Geräte oder Anlagen prüfen", skills: [d("pruefung-ortsveraenderlicher-geraete"), t("mess-und-pruefeinrichtungen-elektro")] },
      { activity_id: "hw-sanitaer", label: "Rohre, Bäder oder Heizungen installieren", skills: [d("sanitaerinstallation"), t("rohrleitungsbau"), t("heizungstechnik-installation")] },
      { activity_id: "hw-heizung-wartung", label: "Heizungs- oder Sanitäranlagen warten", skills: [d("wartung-shk-anlagen")] },
      { activity_id: "hw-maler", label: "Streichen, lackieren oder tapezieren", skills: [d("tapezierarbeiten"), t("untergrundvorbereitung"), t("lackiertechnik-spritzverfahren")] },
      { activity_id: "hw-baustelle", label: "Auf der Baustelle mitarbeiten und Material einteilen", skills: [t("arbeitssicherheit-baustelle"), t("baustoffkunde")] },
      { activity_id: "hw-aufmass", label: "Aufmaß nehmen und Mengen berechnen", skills: [d("massenberechnung-aufmass")] },
      { activity_id: "hw-plaene", label: "Baupläne lesen", skills: [t("bauplaene-lesen-und-erstellen")] },
    ],
  },
  {
    field_key: "kfz",
    label: "Kfz & Werkstatt",
    icon: "🚗",
    kldb_hauptgruppen: ["25"],
    activities: [
      { activity_id: "kfz-inspektion", label: "Fahrzeuge warten und Inspektionen durchführen", skills: [d("wartung-und-inspektion")] },
      { activity_id: "kfz-diagnose", label: "Fehlerspeicher auslesen und Fehler suchen", skills: [d("fehlerspeicher-auslesen"), d("fahrzeugdiagnosegeraete")] },
      { activity_id: "kfz-reifen", label: "Reifen und Räder wechseln", skills: [d("reifen-und-raedermontage")] },
      { activity_id: "kfz-bremsen", label: "Bremsen und Fahrwerk reparieren", skills: [d("fahrwerks-und-bremsentechnik")] },
      { activity_id: "kfz-elektrik", label: "Fahrzeugelektrik reparieren", skills: [t("fahrzeugelektrik-elektronik")] },
      { activity_id: "kfz-klima", label: "Klimaanlagen warten", skills: [d("klimaanlagenservice")] },
      { activity_id: "kfz-au", label: "Abgasuntersuchungen durchführen", skills: [d("abgasuntersuchung")] },
    ],
  },
  {
    field_key: "pflege-gesundheit",
    label: "Pflege & Gesundheit",
    icon: "🩺",
    kldb_hauptgruppen: ["81", "82"],
    activities: [
      { activity_id: "pflege-koerperpflege", label: "Menschen bei Körperpflege und Alltag unterstützen", skills: [d("grundpflege"), d("unterstuetzung-koerperpflege")] },
      { activity_id: "pflege-vitalzeichen", label: "Blutdruck, Puls und Temperatur messen", skills: [d("vitalzeichenkontrolle")] },
      { activity_id: "pflege-doku", label: "Pflege dokumentieren", skills: [d("pflegedokumentation")] },
      { activity_id: "pflege-medikamente", label: "Medikamente stellen oder verabreichen", skills: [t("medikamentenmanagement")] },
      { activity_id: "pflege-mobilisation", label: "Menschen mobilisieren und Stürzen vorbeugen", skills: [d("mobilisation"), t("sturzprophylaxe")] },
      { activity_id: "pflege-verband", label: "Verbände wechseln", skills: [d("verbandwechsel")] },
      { activity_id: "praxis-empfang", label: "Patientinnen und Patienten empfangen und aufnehmen", skills: [d("patientenaufnahme"), t("terminmanagement")] },
      { activity_id: "praxis-abrechnung", label: "Leistungen in der Praxis abrechnen", skills: [t("abrechnung-goae-ebm"), t("praxisverwaltungssoftware")] },
      { activity_id: "praxis-hygiene", label: "Hygieneregeln umsetzen und Instrumente aufbereiten", skills: [d("hygienemassnahmen"), t("sterilisation-von-instrumenten")] },
      { activity_id: "praxis-blut-ekg", label: "Blut abnehmen oder EKG schreiben", skills: [d("blutentnahme"), d("ekg-durchfuehrung")] },
    ],
  },
  {
    field_key: "erziehung-soziales",
    label: "Erziehung & Soziales",
    icon: "🤝",
    kldb_hauptgruppen: ["83", "84"],
    activities: [
      { activity_id: "sozial-kinder", label: "Kinder betreuen und beschäftigen", skills: [d("spielbegleitung"), t("aufsichtspflicht")] },
      { activity_id: "sozial-beobachten", label: "Entwicklung beobachten und dokumentieren", skills: [d("entwicklungsbeobachtung"), t("beobachtung-und-dokumentation")] },
      { activity_id: "sozial-eltern", label: "Gespräche mit Eltern führen", skills: [d("elterngespraeche"), t("elternarbeit")] },
      { activity_id: "sozial-gruppen", label: "Gruppen anleiten (Kinder, Jugendliche oder Erwachsene)", skills: [d("gruppenleitung"), t("gruppenangebote")] },
      { activity_id: "sozial-beraten", label: "Menschen in schwierigen Lebenslagen beraten", skills: [d("beratungsgespraeche"), t("krisenintervention")] },
      { activity_id: "sozial-alltag", label: "Menschen mit Unterstützungsbedarf im Alltag begleiten", skills: [d("alltagsbegleitung")] },
      { activity_id: "sozial-lernen", label: "Beim Lernen oder mit der Sprache helfen (z. B. Nachhilfe)", skills: [t("lernprozessbegleitung"), t("sprachfoerderung")] },
      { activity_id: "sozial-konflikte", label: "Streit schlichten und Situationen beruhigen", skills: [d("deeskalationstechniken"), t("konfliktmanagement")] },
    ],
  },
  {
    field_key: "it-digital",
    label: "IT & Digitales",
    icon: "💻",
    kldb_hauptgruppen: ["43"],
    activities: [
      { activity_id: "it-support", label: "Computer einrichten und Kollegen bei IT-Problemen helfen", skills: [d("betriebssystem-konfiguration")] },
      { activity_id: "it-server", label: "Netzwerke oder Server betreuen", skills: [d("server-systemadministration"), t("netzwerksicherheit")] },
      { activity_id: "it-programmieren", label: "Programmieren oder Skripte schreiben", skills: [d("programmierung"), t("skriptsprachen")] },
      { activity_id: "it-website", label: "Webseiten pflegen (z. B. WordPress)", skills: [d("cms-systeme")] },
      { activity_id: "it-daten", label: "Daten auswerten und Berichte bauen", skills: [d("reporting-dashboards"), t("datenaufbereitung-bereinigung"), t("sql")] },
      { activity_id: "it-shop", label: "Einen Online-Shop betreuen", skills: [d("shopsystem-management"), t("e-commerce-grundlagen")] },
      { activity_id: "it-sicherheit", label: "Auf IT-Sicherheit und Datenschutz achten", skills: [t("it-sicherheitsgrundlagen"), t("datenschutzgrundlagen-dsgvo")] },
    ],
  },
  {
    field_key: "marketing-medien",
    label: "Marketing & Medien",
    icon: "📣",
    kldb_hauptgruppen: ["92"],
    activities: [
      { activity_id: "mkt-social", label: "Social-Media-Kanäle betreuen", skills: [d("content-erstellung-social-media"), t("community-management")] },
      { activity_id: "mkt-texte", label: "Texte für Website, Newsletter oder Flyer schreiben", skills: [d("texten-fuer-owned-media")] },
      { activity_id: "mkt-grafik", label: "Grafiken oder Flyer gestalten (z. B. Canva, Photoshop)", skills: [d("canva"), t("adobe-photoshop"), t("layoutgestaltung")] },
      { activity_id: "mkt-anzeigen", label: "Online-Werbeanzeigen schalten (z. B. Google, Meta)", skills: [t("google-ads"), t("paid-social-advertising")] },
      { activity_id: "mkt-events", label: "Events oder Messeauftritte organisieren", skills: [d("veranstaltungsorganisation")] },
      { activity_id: "mkt-presse", label: "Pressemitteilungen schreiben", skills: [d("pressemitteilungen-verfassen"), t("pressearbeit")] },
      { activity_id: "mkt-video", label: "Kurze Videos drehen und schneiden", skills: [d("short-video-produktion")] },
    ],
  },
  {
    field_key: "gastro-hotel",
    label: "Gastronomie & Hotel",
    icon: "🍽️",
    kldb_hauptgruppen: ["63", "29"],
    activities: [
      { activity_id: "gastro-gaeste", label: "Gäste bedienen und beraten", skills: [d("kundenberatung"), t("kundenkommunikation")] },
      { activity_id: "gastro-kasse", label: "Abrechnen und kassieren", skills: [d("kassensysteme")] },
      { activity_id: "gastro-beschwerden", label: "Beschwerden von Gästen klären", skills: [d("beschwerdemanagement"), t("deeskalationstechniken")] },
      { activity_id: "gastro-hygiene", label: "Hygiene- und Sauberkeitsregeln umsetzen", skills: [d("hygienemassnahmen")] },
      { activity_id: "gastro-einkauf", label: "Waren bestellen und das Lager führen", skills: [t("bestandsmanagement"), t("materialwirtschaft")] },
      { activity_id: "gastro-reservierung", label: "Reservierungen und Empfang übernehmen", skills: [t("terminplanung"), t("kundenkommunikation")] },
      { activity_id: "gastro-schichten", label: "Schichten einteilen", skills: [d("dienstplanung")] },
    ],
  },
  {
    // Querschnitt: Verantwortung gibt es in jedem Beruf. Bewusst eigenes
    // Feld statt Duplikat in jedem Herkunftsfeld — sonst wuerden Fuehrungs-
    // Skills je nach gewaehltem Feld unterschiedlich angeboten.
    field_key: "verantwortung",
    label: "Verantwortung übernommen (in jedem Beruf)",
    icon: "⭐",
    kldb_hauptgruppen: [],
    activities: [
      { activity_id: "verantw-team", label: "Ein Team oder eine Schicht geleitet", skills: [d("teamfuehrung"), t("personalfuehrung-grundlagen")] },
      { activity_id: "verantw-einarbeiten", label: "Neue Kolleginnen oder Azubis eingearbeitet", skills: [d("mitarbeiterentwicklung-einarbeitung"), d("anleitung-von-auszubildenden")] },
      { activity_id: "verantw-dienstplan", label: "Dienst- oder Schichtpläne erstellt", skills: [d("dienstplanung"), t("personaleinsatzplanung")] },
      { activity_id: "verantw-projekte", label: "Projekte organisiert und koordiniert", skills: [d("projektkoordination"), t("projektmanagement")] },
      { activity_id: "verantw-budget", label: "Ein Budget oder Kosten verantwortet", skills: [t("budgetplanung")] },
      { activity_id: "verantw-praesentieren", label: "Präsentationen oder Schulungen gehalten", skills: [d("praesentationstechniken"), t("moderationstechniken")] },
      { activity_id: "verantw-ablaeufe", label: "Abläufe verbessert", skills: [d("prozessorganisation"), t("qualitaetssicherung")] },
      { activity_id: "verantw-konflikte", label: "Konflikte im Team gelöst", skills: [d("konfliktmanagement")] },
    ],
  },
];

/** Alle skill_ids, die in mindestens einer Rolle vorkommen — einmal pro
 *  Modul-Load berechnet. Grundlage fuer die defensive Laufzeitpruefung. */
const ROLE_SKILL_IDS: ReadonlySet<string> = new Set(ROLES_CATALOG.flatMap((r) => r.skills.map((s) => s.skill_id)));

const ACTIVITY_BY_ID: ReadonlyMap<string, CatalogActivity> = new Map(
  ACTIVITY_FIELDS.flatMap((f) => f.activities.map((a) => [a.activity_id, a] as const))
);

export function getActivity(activityId: string): CatalogActivity | undefined {
  return ACTIVITY_BY_ID.get(activityId);
}

/** Ein aus Taetigkeiten abgeleiteter Skill-VORSCHLAG. */
export interface ActivityDerivedSkill {
  skill_id: string;
  /** Staerkste Verbindung ueber alle gewaehlten Taetigkeiten ("direkt" schlaegt "teilweise"). */
  strength: ActivityStrength;
  /** Welche Taetigkeiten zu diesem Vorschlag gefuehrt haben — fuer die
   *  Begruendung in der UI ("weil du Rechnungen geprueft hast"). */
  source_activity_ids: string[];
}

/**
 * Uebersetzt angeklickte Taetigkeiten in Skill-Vorschlaege. Rein
 * deterministisch; unbekannte activity_ids und skill_ids, die (nicht mehr)
 * im Rollen-Katalog vorkommen, werden stillschweigend ignoriert.
 *
 * @param restrictToSkillIds optional: nur Skills zurueckgeben, die in dieser
 *   Menge liegen (z. B. die Skills der gewaehlten Zielrolle in Schritt 2).
 */
export function deriveSkillsFromActivities(
  activityIds: Iterable<string>,
  restrictToSkillIds?: ReadonlySet<string>
): Map<string, ActivityDerivedSkill> {
  const result = new Map<string, ActivityDerivedSkill>();
  for (const activityId of activityIds) {
    const activity = ACTIVITY_BY_ID.get(activityId);
    if (!activity) continue;
    for (const link of activity.skills) {
      if (!ROLE_SKILL_IDS.has(link.skill_id)) continue;
      if (restrictToSkillIds && !restrictToSkillIds.has(link.skill_id)) continue;
      const existing = result.get(link.skill_id);
      if (!existing) {
        result.set(link.skill_id, { skill_id: link.skill_id, strength: link.strength, source_activity_ids: [activityId] });
        continue;
      }
      if (!existing.source_activity_ids.includes(activityId)) existing.source_activity_ids.push(activityId);
      if (link.strength === "direkt") existing.strength = "direkt";
    }
  }
  return result;
}

/** Vorbelegung des Grads in der 3x3-Matrix (Schritt 2). Bewusst nie
 *  "experte": aus einer Taetigkeit allein laesst sich Expertise nicht
 *  ehrlich ableiten — das hebt die Person selbst an, wenn es zutrifft. */
export function suggestedProficiency(strength: ActivityStrength): "fortgeschritten" | "grundkenntnisse" {
  return strength === "direkt" ? "fortgeschritten" : "grundkenntnisse";
}