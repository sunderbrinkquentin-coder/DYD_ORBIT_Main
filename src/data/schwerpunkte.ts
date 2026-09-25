/**
 * Journey v2 – Schwerpunkte innerhalb eines Bereichs (25.09.2026).
 *
 * Problem: Nach der Wahl eines Bereichs (z. B. "IT & Technik") hat
 * narrowDirection() ueber alle Berufe des Bereichs eingegrenzt — und landete
 * oft direkt bei einem Beruf (z. B. Softwareentwicklung), obwohl die Person
 * vielleicht eher ins IT-Projektmanagement will. Deshalb waehlt die Person
 * nach dem Bereich zuerst einen Schwerpunkt (Unterbereich); die Eingrenzung
 * laeuft danach nur ueber die Berufe dieses Schwerpunkts.
 *
 * Reine Daten + Logik, keine UI. Jeder Beruf aus ROLES_CATALOG gehoert genau
 * einem Schwerpunkt seines Bereichs an (geprueft in
 * scripts/tests/schwerpunkte.test.ts). Berufe, die nur im Backend-Katalog
 * des Traegers existieren, haben keinen Schwerpunkt und bleiben nur bei
 * "Noch offen – alles zeigen" im Spiel.
 */

import type { CatalogRole } from "./rolesCatalog";
import { suggestRolesForSkillIds } from "./gapAnalysis";
import { deriveSkillsFromActivities } from "./activitiesCatalog";

export interface Schwerpunkt {
  key: string;
  bereich_key: string;
  label: string;
  icon: string;
  /** Kurze Beschreibung in Alltagssprache (was man dort macht). */
  hint: string;
  role_ids: string[];
}

export const SCHWERPUNKTE: Schwerpunkt[] = [
  // ---------------- IT & Technik ----------------
  {
    key: "it-entwicklung",
    bereich_key: "it-tech",
    label: "Programmierung & Entwicklung",
    icon: "💻",
    hint: "Software, Websites und Apps bauen",
    role_ids: ["it-tech-it-berufsspezialist-softwareentwicklung-ihk", "it-tech-geprueft-it-entwickler-ihk", "it-tech-webentwickler", "it-tech-devops-engineer"],
  },
  {
    key: "it-systeme",
    bereich_key: "it-tech",
    label: "Systeme, Cloud & Support",
    icon: "🖥️",
    hint: "Netzwerke, Server und Anwender betreuen",
    role_ids: ["it-tech-it-berufsspezialist-systemintegration-ihk", "it-tech-cloud-engineer", "it-tech-it-supporter"],
  },
  {
    key: "it-sicherheit",
    bereich_key: "it-tech",
    label: "IT-Sicherheit & Datenschutz",
    icon: "🔒",
    hint: "Systeme und Daten schützen",
    role_ids: ["it-tech-it-security-specialist", "it-tech-datenschutzbeauftragter"],
  },
  {
    key: "it-daten",
    bereich_key: "it-tech",
    label: "Daten & KI",
    icon: "📊",
    hint: "Daten auswerten, KI im Unternehmen einsetzen",
    role_ids: ["it-tech-data-analyst", "it-tech-data-scientist", "it-tech-ki-manager-ihk"],
  },
  {
    key: "it-projekte",
    bereich_key: "it-tech",
    label: "IT-Projektmanagement & Beratung",
    icon: "📋",
    hint: "IT-Projekte steuern, Anforderungen klären, Teams führen",
    role_ids: [
      "it-tech-geprueft-it-projektleiter-ihk",
      "it-tech-geprueft-it-berater-ihk",
      "it-tech-business-analyst",
      "it-tech-scrum-master",
      "it-tech-geprueft-informatiker-ihk",
    ],
  },
  // ---------------- Wirtschaft & Verwaltung ----------------
  {
    key: "wi-buero",
    bereich_key: "wirtschaft",
    label: "Büro, Assistenz & Verwaltung",
    icon: "🗂️",
    hint: "Organisation, Korrespondenz, Termine und Abläufe",
    role_ids: [
      "wirtschaft-fachwirt-buero-projektorganisation-ihk",
      "wirtschaft-buerohilfe",
      "wirtschaft-kaufmann-bueromanagement",
      "wirtschaft-assistenz-geschaeftsfuehrung",
      "wirtschaft-verwaltungsfachangestellte",
    ],
  },
  {
    key: "wi-finanzen",
    bereich_key: "wirtschaft",
    label: "Buchhaltung, Steuern & Controlling",
    icon: "🧮",
    hint: "Zahlen, Abschlüsse, Lohn und Steuern",
    role_ids: [
      "wirtschaft-buchhalter-ihk",
      "wirtschaft-bilanzbuchhalter-ihk",
      "wirtschaft-lohnbuchhalter",
      "wirtschaft-steuerfachangestellte",
      "wirtschaft-controller",
    ],
  },
  {
    key: "wi-personal",
    bereich_key: "wirtschaft",
    label: "Personal (HR)",
    icon: "👥",
    hint: "Mitarbeitende gewinnen, betreuen und entwickeln",
    role_ids: ["wirtschaft-personalfachkaufmann-ihk"],
  },
  {
    key: "wi-einkauf",
    bereich_key: "wirtschaft",
    label: "Einkauf & Industriekaufleute",
    icon: "🏭",
    hint: "Beschaffung, Angebote und kaufmännische Abläufe im Betrieb",
    role_ids: ["wirtschaft-fachwirt-einkauf-ihk", "wirtschaft-industriekaufmann"],
  },
  {
    key: "wi-management",
    bereich_key: "wirtschaft",
    label: "Projektmanagement & Führung",
    icon: "🧭",
    hint: "Projekte leiten, Teams und Bereiche führen",
    role_ids: ["wirtschaft-wirtschaftsfachwirt-ihk", "wirtschaft-betriebswirt-ihk", "wirtschaft-projektmanager"],
  },
  {
    key: "wi-immo-finanz",
    bereich_key: "wirtschaft",
    label: "Immobilien, Versicherung & Finanzen",
    icon: "🏠",
    hint: "Beraten, vermitteln und verwalten",
    role_ids: [
      "wirtschaft-immobilienfachwirt-ihk",
      "wirtschaft-immobilienmakler",
      "wirtschaft-versicherungsfachmann-ihk",
      "wirtschaft-finanzanlagenfachmann-ihk",
    ],
  },
  // ---------------- Handel & Verkauf ----------------
  {
    key: "ha-verkauf",
    bereich_key: "handel",
    label: "Verkauf & Filiale",
    icon: "🛍️",
    hint: "Kundschaft beraten, Ware präsentieren, Filiale führen",
    role_ids: [
      "handel-verkaufshelfer",
      "handel-kassierer",
      "handel-verkaeufer",
      "handel-kaufmann-einzelhandel",
      "handel-visual-merchandiser",
      "wirtschaft-fachwirt-vertrieb-einzelhandel-ihk",
    ],
  },
  {
    key: "ha-vertrieb",
    bereich_key: "handel",
    label: "Vertrieb & Kundenbetreuung",
    icon: "🤝",
    hint: "Geschäftskunden gewinnen und betreuen",
    role_ids: ["handel-vertrieb-innendienst", "handel-aussendienst", "handel-key-account-manager", "handel-vertriebsleiter", "handel-pharmareferent"],
  },
  {
    key: "ha-grosshandel",
    bereich_key: "handel",
    label: "Großhandel, Sortiment & E-Commerce",
    icon: "📦",
    hint: "Sortiment planen, Onlinehandel, Groß- und Außenhandel",
    role_ids: ["wirtschaft-handelsfachwirt-ihk", "handel-kaufmann-gross-aussenhandel", "handel-kaufmann-e-commerce"],
  },
  // ---------------- Gesundheit & Pflege ----------------
  {
    key: "ge-pflege",
    bereich_key: "gesundheit",
    label: "Pflege & Betreuung",
    icon: "🩺",
    hint: "Menschen pflegen, betreuen und anleiten",
    role_ids: [
      "gesundheit-pflegefachassistenz",
      "gesundheit-pflegefachkraft",
      "gesundheit-pflegehilfskraft",
      "gesundheit-alltagsbegleiter",
      "gesundheit-fachpflegekraft-fuer-intensivpflege-und-anaesthesie",
      "gesundheit-wundexperte",
      "gesundheit-hygienebeauftragter",
      "gesundheit-praxisanleiter",
    ],
  },
  {
    key: "ge-leitung",
    bereich_key: "gesundheit",
    label: "Leitung & Verwaltung",
    icon: "🏥",
    hint: "Wohnbereich, Pflegedienst oder Einrichtung leiten",
    role_ids: [
      "gesundheit-wohnbereichsleitung-verantwortliche-pflegefachkraft",
      "gesundheit-pflegedienstleitung",
      "gesundheit-fachwirt-gesundheits-sozialwesen",
    ],
  },
  {
    key: "ge-praxis",
    bereich_key: "gesundheit",
    label: "Arzt- & Zahnarztpraxis",
    icon: "🦷",
    hint: "Patient:innen betreuen, Praxis organisieren",
    role_ids: [
      "gesundheit-medizinische-fachangestellte",
      "gesundheit-zfa",
      "gesundheit-fachwirt-fuer-ambulante-medizinische-versorgung",
      "gesundheit-zmv",
    ],
  },
  {
    key: "ge-therapie",
    bereich_key: "gesundheit",
    label: "Therapie",
    icon: "🤸",
    hint: "Beweglichkeit und Alltag wieder aufbauen",
    role_ids: ["gesundheit-physiotherapeut", "gesundheit-ergotherapeut"],
  },
  {
    key: "ge-rettung",
    bereich_key: "gesundheit",
    label: "Rettungsdienst",
    icon: "🚑",
    hint: "Im Notfall helfen",
    role_ids: ["gesundheit-notfallsanitaeter", "gesundheit-rettungssanitaeter"],
  },
  // ---------------- Handwerk & Bau ----------------
  {
    key: "hw-elektro",
    bereich_key: "handwerk",
    label: "Elektro, Solar & Energie",
    icon: "⚡",
    hint: "Elektroanlagen, Photovoltaik, Energieberatung",
    role_ids: [
      "handwerk-elektroniker-energie-und-gebaeudetechnik",
      "handwerk-elektrotechnikermeister",
      "handwerk-elektrofachkraft-festgelegte-taetigkeiten",
      "handwerk-solarteur",
      "handwerk-energieberater",
    ],
  },
  {
    key: "hw-shk",
    bereich_key: "handwerk",
    label: "Sanitär, Heizung & Klima",
    icon: "🔧",
    hint: "Bäder, Heizungen und Wärmepumpen",
    role_ids: ["handwerk-anlagenmechaniker-shk", "handwerk-shk-meister"],
  },
  {
    key: "hw-bau",
    bereich_key: "handwerk",
    label: "Bau & Ausbau",
    icon: "🧱",
    hint: "Bauen, Innenausbau, Holz und Farbe",
    role_ids: [
      "handwerk-bautechniker-hochbau",
      "handwerk-bauhelfer",
      "handwerk-maurer",
      "handwerk-trockenbauer",
      "handwerk-maler-und-lackierer",
      "handwerk-tischler",
    ],
  },
  {
    key: "hw-metall",
    bereich_key: "handwerk",
    label: "Metall, Mechatronik & Kfz",
    icon: "🔩",
    hint: "Schweißen, Maschinen und Fahrzeuge",
    role_ids: ["handwerk-schweissfachmann", "handwerk-mechatroniker", "handwerk-kfz-mechatroniker"],
  },
  // ---------------- Soziales & Bildung ----------------
  {
    key: "so-kinder",
    bereich_key: "soziales-bildung",
    label: "Kinder & Jugend",
    icon: "🧸",
    hint: "Kita, Schule und Jugendarbeit",
    role_ids: [
      "soziales-bildung-sozialpaed-assistent",
      "soziales-bildung-erzieher",
      "soziales-bildung-kita-leitung",
      "soziales-bildung-kinderpfleger",
      "soziales-bildung-schulbegleiter",
    ],
  },
  {
    key: "so-sozial",
    bereich_key: "soziales-bildung",
    label: "Soziale Arbeit & Inklusion",
    icon: "🤲",
    hint: "Menschen in schwierigen Lagen begleiten",
    role_ids: [
      "soziales-bildung-sozialarbeiter",
      "soziales-bildung-sozialpaedagoge-leitung",
      "soziales-bildung-heilerziehungspfleger-bildung",
      "soziales-bildung-jobcoach",
    ],
  },
  {
    key: "so-bildung",
    bereich_key: "soziales-bildung",
    label: "Erwachsenenbildung & Coaching",
    icon: "🎓",
    hint: "Unterrichten, ausbilden, beraten",
    role_ids: [
      "soziales-bildung-aus-und-weiterbildungspaedagoge",
      "soziales-bildung-lerntherapeut",
      "soziales-bildung-dozent-erwachsenenbildung",
      "soziales-bildung-coach",
    ],
  },
  // ---------------- Marketing & Kommunikation ----------------
  {
    key: "ma-online",
    bereich_key: "marketing",
    label: "Online-Marketing & Social Media",
    icon: "📱",
    hint: "Kampagnen, Social Media, SEO und Onlineshop",
    role_ids: ["marketing-social-media-manager-ihk", "marketing-seo-sea-manager-ihk", "marketing-ecommerce-manager-ihk"],
  },
  {
    key: "ma-content",
    bereich_key: "marketing",
    label: "Content, PR & Redaktion",
    icon: "✍️",
    hint: "Texte, Pressearbeit und Inhalte",
    role_ids: ["marketing-content-pr-manager", "marketing-online-redakteur"],
  },
  {
    key: "ma-design",
    bereich_key: "marketing",
    label: "Design & Gestaltung",
    icon: "🎨",
    hint: "Grafik, Medien und digitale Oberflächen",
    role_ids: ["marketing-grafikdesigner", "marketing-ux-ui-designer", "marketing-mediengestalter"],
  },
  {
    key: "ma-management",
    bereich_key: "marketing",
    label: "Marketing-Management",
    icon: "📈",
    hint: "Strategie, Budget und Team verantworten",
    role_ids: ["marketing-fachwirt-fuer-marketing-ihk", "marketing-head-of-marketing"],
  },
  // ---------------- Logistik & Verkehr ----------------
  {
    key: "lo-lager",
    bereich_key: "logistik",
    label: "Lager & Umschlag",
    icon: "📦",
    hint: "Waren annehmen, lagern, kommissionieren – bis zur Lagerleitung",
    role_ids: [
      "logistik-lagerhelfer",
      "logistik-staplerfahrer",
      "logistik-fachlagerist",
      "logistik-fachkraft-lagerlogistik",
      "logistik-kranfuehrer",
      "logistik-schichtleiter",
      "logistik-lagerleiter",
    ],
  },
  {
    key: "lo-transport",
    bereich_key: "logistik",
    label: "Transport & Fahren",
    icon: "🚚",
    hint: "Lkw, Auslieferung und Kurierfahrten",
    role_ids: ["logistik-auslieferungsfahrer", "logistik-berufskraftfahrer"],
  },
  {
    key: "lo-disposition",
    bereich_key: "logistik",
    label: "Disposition, Spedition & Supply Chain",
    icon: "🗺️",
    hint: "Touren planen, Sendungen und Zoll abwickeln, Lieferketten steuern",
    role_ids: ["logistik-speditionskaufmann", "logistik-sachbearbeiter-zoll-export", "logistik-disponent", "logistik-supply-chain-manager"],
  },
  // ---------------- Produktion & Industrie ----------------
  {
    key: "pr-fertigung",
    bereich_key: "produktion",
    label: "Fertigung & Maschinen",
    icon: "⚙️",
    hint: "Anlagen bedienen, zerspanen, schweißen",
    role_ids: [
      "produktion-produktionshelfer",
      "produktion-maschinen-anlagenfuehrer",
      "produktion-zerspanungsmechaniker",
      "produktion-schweisser",
      "produktion-chemikant",
    ],
  },
  {
    key: "pr-technik",
    bereich_key: "produktion",
    label: "Technik & Instandhaltung",
    icon: "🔧",
    hint: "Maschinen warten, reparieren und verbessern",
    role_ids: ["produktion-industriemechaniker", "produktion-elektroniker-betriebstechnik", "produktion-instandhaltungstechniker"],
  },
  {
    key: "pr-qualitaet",
    bereich_key: "produktion",
    label: "Qualität & Arbeitssicherheit",
    icon: "✅",
    hint: "Prüfen, Standards sichern, Unfälle vermeiden",
    role_ids: ["produktion-qualitaetspruefer", "produktion-qualitaetsmanagementbeauftragter", "produktion-fachkraft-arbeitssicherheit"],
  },
  {
    key: "pr-steuerung",
    bereich_key: "produktion",
    label: "Planung & Führung",
    icon: "🧭",
    hint: "Produktion planen, Schichten und Teams führen",
    role_ids: ["produktion-produktionsplaner", "produktion-schichtleiter", "produktion-produktionsleiter"],
  },
  // ---------------- Gastronomie, Hotel & Dienstleistung ----------------
  {
    key: "ga-kueche",
    bereich_key: "gastro-service",
    label: "Küche",
    icon: "🍳",
    hint: "Kochen, vorbereiten, Küche leiten",
    role_ids: ["gastro-kuechenhilfe", "gastro-koch", "gastro-kuechenchef"],
  },
  {
    key: "ga-service",
    bereich_key: "gastro-service",
    label: "Service & Restaurant",
    icon: "🍽️",
    hint: "Gäste bewirten, Veranstaltungen, Restaurant leiten",
    role_ids: ["gastro-servicekraft", "gastro-fachmann-restaurants", "gastro-restaurantleiter"],
  },
  {
    key: "ga-hotel",
    bereich_key: "gastro-service",
    label: "Hotel & Empfang",
    icon: "🛎️",
    hint: "Rezeption, Gästebetreuung, Hotelmanagement",
    role_ids: ["gastro-hotelfachmann", "gastro-rezeptionist", "gastro-hotelleiter"],
  },
  {
    key: "ga-sicherheit",
    bereich_key: "gastro-service",
    label: "Sicherheit",
    icon: "🛡️",
    hint: "Objekte und Veranstaltungen schützen",
    role_ids: ["dienstleistung-sicherheitsmitarbeiter", "dienstleistung-fachkraft-schutz-sicherheit"],
  },
  {
    key: "ga-gebaeude",
    bereich_key: "gastro-service",
    label: "Reinigung & Haustechnik",
    icon: "🧹",
    hint: "Gebäude reinigen, pflegen und betreuen",
    role_ids: ["dienstleistung-reinigungskraft", "dienstleistung-gebaeudereiniger", "dienstleistung-objektleiter-reinigung", "dienstleistung-hausmeister"],
  },
];

export interface SchwerpunktOption extends Schwerpunkt {
  /** Berufe dieses Schwerpunkts, die im Portfolio vorkommen. */
  roles: CatalogRole[];
  /** Bester Erfahrungs-Match (0–100) der Taetigkeiten mit einem Beruf hier. */
  experience: number;
  /** Der Traeger hat Kurse, die zu einem Beruf dieses Schwerpunkts fuehren. */
  hasOffer: boolean;
}

/**
 * Schwerpunkte eines Bereichs, die im Portfolio mindestens einen Beruf haben.
 * Reihenfolge: erst mit Kursangebot, dann nach Erfahrung, dann Katalog-
 * Reihenfolge (deterministisch).
 */
export function schwerpunkteFor(
  bereichKey: string,
  roles: CatalogRole[],
  opts: { activityIds?: string[]; offeredRoleIds?: ReadonlySet<string> } = {},
): SchwerpunktOption[] {
  const byId = new Map(roles.map((r) => [r.role_id, r] as const));
  const derived = deriveSkillsFromActivities(opts.activityIds ?? []);
  const skillIds = new Set(derived.keys());
  const offered = opts.offeredRoleIds ?? new Set<string>();
  const list = SCHWERPUNKTE.filter((s) => s.bereich_key === bereichKey)
    .map((s, idx) => {
      const own = s.role_ids.map((id) => byId.get(id)).filter((r): r is CatalogRole => Boolean(r));
      const experience =
        skillIds.size > 0 && own.length > 0
          ? Math.max(0, ...suggestRolesForSkillIds(skillIds, { roles: own, limit: own.length, minMatchPercentage: 0.1 }).map((m) => m.match_percentage))
          : 0;
      return { opt: { ...s, roles: own, experience: Math.round(experience), hasOffer: own.some((r) => offered.has(r.role_id)) }, idx };
    })
    .filter((x) => x.opt.roles.length > 0);
  list.sort((a, b) => Number(b.opt.hasOffer) - Number(a.opt.hasOffer) || b.opt.experience - a.opt.experience || a.idx - b.idx);
  return list.map((x) => x.opt);
}

/** Ab so viel Erfahrungs-Match zeigen wir "✓ Erfahrung vorhanden". */
export const SCHWERPUNKT_EXPERIENCE_MIN = 25;

/**
 * Schraenkt die Berufe fuer narrowDirection() auf die gewaehlten Schwerpunkte
 * ein. Bereiche ohne gewaehlten Schwerpunkt bleiben vollstaendig; ohne jede
 * Auswahl ("Noch offen") bleibt alles wie bisher.
 */
export function rolesForSchwerpunkte(roles: CatalogRole[], bereichKeys: string[], schwerpunktKeys: string[]): CatalogRole[] {
  if (schwerpunktKeys.length === 0) return roles;
  const chosen = SCHWERPUNKTE.filter((s) => schwerpunktKeys.includes(s.key));
  const restricted = new Set(chosen.map((s) => s.bereich_key));
  const allowed = new Set(chosen.flatMap((s) => s.role_ids));
  const filtered = roles.filter((r) => !bereichKeys.includes(r.bereich_key) || !restricted.has(r.bereich_key) || allowed.has(r.role_id));
  // Sicherheitsnetz: bleibt fuer einen Bereich nichts uebrig, nicht einschraenken.
  return bereichKeys.every((k) => !restricted.has(k) || filtered.some((r) => r.bereich_key === k)) ? filtered : roles;
}

export function schwerpunktLabel(key: string): string | null {
  return SCHWERPUNKTE.find((s) => s.key === key)?.label ?? null;
}