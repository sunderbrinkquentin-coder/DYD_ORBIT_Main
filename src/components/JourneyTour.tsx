import { useEffect, useMemo, useRef, useState } from "react";
import { readingDurationMs, TourAutoplayBar, TourAutoplayToggle, TourDemoToast, TourStepDots, useTourAutoplay } from "./tourAutoplay";
import { useTourSpotlight } from "./tourSpotlight";

/**
 * Gefuehrter Rundgang durch die Endnutzer-Journey — fuer Demos/Praesentationen
 * gedacht (z.B. vor Bildungstraeger-Kunden), nicht fuer echte Endnutzer:
 * wird deshalb in JourneyPage.tsx genauso wie das Einstellungs-Zahnrad nur
 * gezeigt, wenn `showConnectionPanel` an ist (Dev-/Demo-Modus).
 *
 * Bewusst nach demselben Muster wie DashboardTour.tsx gebaut (siehe
 * Kommentar dort): ein "Spotlight"-Overlay hebt jeweils einen echten
 * DOM-Bereich hervor (per data-tour="..."-Attribut markiert), daneben
 * erscheint eine Karte mit kurzer Erklaerung. Wechselt bei Bedarf selbst
 * den Journey-Schritt ueber onNavigate.
 *
 * Unterschied zu DashboardTour: die Journey ist ein linearer Assistent statt
 * frei waehlbarer Tabs, und zwei Schritte (Skill-Gap, Kursempfehlung) zeigen
 * echte, zuvor berechnete Ergebnisse. Fehlen sie noch, holt runDemoAnalysis
 * (siehe JourneyPage.tsx) sie beim Start automatisch nach - keine erfundenen
 * Beispieldaten, sondern ein echter, live berechneter Abgleich (passend zum
 * Projekt-Prinzip "keine erfundenen Zahlen/Fakten", siehe Kommentar bei
 * skillImportance in JourneyPage.tsx).
 *
 * Die Erklaer-Karte "dockt" bewusst IMMER an derselben festen Stelle
 * (unten mittig, siehe .tour-card-dock) statt neben dem jeweils
 * hervorgehobenen Element zu schweben: bei einem hohen Ziel (z.B. der
 * Zielrollen-Liste mit vielen Karten) konnte die alte, dynamische
 * Positionierung die Karte samt "Weiter"-Button ausserhalb des sichtbaren
 * Bereichs platzieren - bei einer `position: fixed`-Karte hilft dagegen
 * KEIN Scrollen (fixed-Elemente bewegen sich nicht mit), sie war schlicht
 * nicht erreichbar. Die feste Docking-Position macht "Weiter"/"Zurück"
 * unabhaengig von der Groesse des jeweiligen Schritts immer erreichbar.
 * Das Spotlight (Hervorhebung des Elements selbst) bleibt davon unberuehrt.
 */

export type JourneyStepKey =
  | "ziel"
  | "praeferenzen"
  | "bereich"
  | "zielrolle"
  | "skills"
  | "gap"
  | "kurs"
  | "lead"
  // Journey v2 (28.09.2026)
  | "v2ziel"
  | "v2herkunft"
  | "v2richtung"
  | "v2check"
  | "v2rahmen"
  | "v2ergebnis";

interface RawStep {
  /** Journey-Schritt, zu dem vor diesem Tour-Schritt navigiert wird - oder
   *  null fuer einen zentrierten Schritt ohne Navigation (Intro/Abschluss). */
  key: JourneyStepKey | null;
  /** Nur relevant, wenn key gesetzt ist: dieser Tour-Schritt wird
   *  uebersprungen, wenn der Schluessel nicht in availableKeys vorkommt
   *  (z.B. "bereich" im "kennt Zielrolle bereits"-Pfad) oder eine der
   *  optionalen requires-Bedingungen nicht erfuellt ist. */
  requires?: "gapResult" | "courseResult";
  /** Round 24 ("der Schritt mit der Zielrolle soll nicht separat genannt
   *  werden, sondern der Fokus soll mehr auf den Bereichen/dem Schritt davor
   *  liegen"): ist dieser andere Schluessel ebenfalls in availableKeys (d.h.
   *  sein Tour-Schritt wird tatsaechlich gezeigt), wird DIESER Schritt hier
   *  uebersprungen — sein Inhalt ist dann bereits in den vorherigen Schritt
   *  eingearbeitet. Nur "zielrolle" nutzt das aktuell (uebersprungen, wenn
   *  "bereich" gezeigt wird) — im "kennt Zielrolle bereits"-Pfad, wo es
   *  keinen "bereich"-Schritt gibt, bleibt "zielrolle" weiterhin ein
   *  eigener, vollwertiger Schritt (sonst gaebe es dort gar keine
   *  Rollen-Auswahl im Rundgang mehr). */
  hideIfKeyPresent?: JourneyStepKey;
  /** Journey v2: Unter-Ansicht innerhalb des Schritts ("schwerpunkt",
   *  "contact", "plan"), die JourneyPage beim Navigieren setzt. */
  sub?: string;
  /** Ziel-Selektor(en) in Prioritaet — der erste sichtbare Treffer gewinnt
   *  (z. B. erst ein Detail-Element, sonst das ganze Panel). */
  selector: string | string[] | null;
  title: string;
  description: string;
  /** NEU (18.09.): eigener, optischer abgesetzter Nutzen-Satz aus Sicht des
   *  Bildungstraegers (siehe .tour-benefit in journey.css) — bewusst NICHT
   *  in `description` verschachtelt, damit er als eigene, erkennbare Zeile
   *  dargestellt werden kann statt als reiner Fliesstext-Anhang. */
  benefit?: string;
  /** Optionaler, rein simulierter "Live-Hinweis" (siehe tourAutoplay.tsx) —
   *  blendet kurz ein, waehrend die automatische Wiedergabe diesen Schritt
   *  zeigt. Erzeugt nichts Echtes, nur fuers Bild bei einer Aufzeichnung. */
  demoEvent?: string;
}

/**
 * Update 18.09. ("die Journeytour muss sich auf die Beduerfnisse der
 * Bildungstraeger und die Vorteile dafuer beziehen"): jeder inhaltliche
 * Schritt bekommt jetzt zusaetzlich einen eigenen `benefit`-Satz, der den
 * konkreten Nutzen fuer den Bildungstraeger benennt — die Tour erklaert
 * nicht mehr nur, WAS der Endnutzer sieht, sondern WARUM das dem
 * Bildungstraeger hilft (mehr/qualifiziertere Leads, weniger Abbrueche,
 * belastbarere Beratungsgespraeche). Der "bereich"-Schritt bekommt dabei die
 * staerkste Ueberarbeitung ("die angezeigten Bereiche muessen immer im
 * Mittelpunkt stehen"): er macht jetzt explizit die Bruecke zum
 * Bereich-Filter im Dashboard (siehe Filterleiste, 18. Durchgang).
 */
const RAW_STEPS: RawStep[] = [
  {
    key: null,
    selector: null,
    title: "Rundgang durch die Journey",
    description:
      "Ein kurzer, gefuehrter Durchlauf durch den Weiterbildungs-Finder aus Sicht des Endnutzers — gedacht, damit DU als Bildungsträger in einer Präsentation oder Aufzeichnung schnell zeigen kannst, wie aus einer einfachen Frage ein qualifizierter Lead in deinem Dashboard wird. Mit „Beenden“ jederzeit aussteigen. Tipp: „▶ Automatisch abspielen“ oben in dieser Karte lässt die Tour für eine Bildschirmaufzeichnung von selbst weiterlaufen, ganz ohne eigenes Klicken.",
  },
  {
    key: "ziel",
    selector: '[data-tour="tour-stepper"]',
    title: "Fortschrittsanzeige",
    description:
      "Zeigt dem Nutzer jederzeit, wo er in der Journey steht und wie viele Schritte noch kommen — hier startet die eigentliche Befragung.",
    benefit: "Transparenz über die verbleibenden Schritte senkt nachweislich die Abbruchquote — mehr Personen kommen bis zum Ende durch und werden zu einem Lead in deinem Dashboard statt unterwegs auszusteigen.",
  },
  {
    key: "ziel",
    selector: '[data-tour="tour-panel"]',
    title: "Motivations-Frage",
    description:
      "Bevor es technisch wird, fragen wir nach dem persoenlichen „Warum“. Rein qualifizierend — beeinflusst spaeter Formulierungen, nicht das Matching selbst.",
    benefit: "Das „Warum“ landet mit im Lead-Datensatz und hilft dir, ein späteres Beratungsgespräch von der ersten Sekunde an persönlicher statt generisch zu führen.",
  },
  {
    key: "praeferenzen",
    selector: '[data-tour="tour-panel"]',
    title: "Rahmenbedingungen",
    description:
      "Beschäftigungsart, gewünschter Arbeitsort (Remote/Vor Ort), grober Startzeitpunkt und ob eine Förderung (z.B. Bildungsgutschein) wichtig ist — vier kurze, jederzeit mit „Egal“ überspringbare Fragen. Beeinflusst NIE, ob ein Kurs überhaupt vorgeschlagen wird, nur die Reihenfolge unter fachlich gleichwertigen Treffern (siehe „Passende Weiterbildung“ weiter unten).",
    benefit: "Diese vier Antworten stehen direkt an jedem Lead in deinem Dashboard — du weißt schon vor dem ersten Anruf, ob Förderung oder Remote-Möglichkeit den Ausschlag geben könnte.",
  },
  {
    key: "bereich",
    selector: '[data-tour="tour-panel"]',
    title: "Bereich vorschlagen lassen",
    description:
      // Round 24 ("der Schritt mit der Zielrolle soll nicht separat genannt
      // werden, sondern der Fokus soll mehr auf den Bereichen/dem Schritt
      // davor liegen"): der bisher eigene "Zielrolle waehlen"-Schritt wird
      // im Bereichs-Pfad jetzt uebersprungen (siehe hideIfKeyPresent am
      // "zielrolle"-Schritt unten) — sein Kern (automatische Rollenauswahl,
      // anlaufende Kette) steht deshalb jetzt HIER, direkt im Anschluss an
      // die Bereichs-Erklaerung, statt als eigener, separat betitelter
      // Tour-Schritt danach.
      // Round 27 (18.09., "bei der Journey-Tour soll es mit dem allgemeinen
      // Prozess durchgehen, nicht mit dem spezifischen Rollenbild — das will
      // ich da nicht drin haben"): Runde 21-24 hatten den Zielrollen-FOKUS
      // (die rhetorische Betonung) entschaerft, das blosse WORT "Zielrolle"
      // aber an mehreren Stellen unveraendert gelassen (galt als reine
      // Feld-Nennung, nicht als Fokus). Das war zu fein unterschieden fuer
      // Quentins Anspruch — er will den Begriff "Zielrolle" (den er als "das
      // spezifische Rollenbild" beschreibt) an keiner sichtbaren Tour-Stelle
      // mehr sehen, nicht nur seltener betont. Deshalb hier UND in den
      // folgenden Schritten "Zielrolle" durchgaengig durch "Rolle"/"gewaehlte
      // Rolle" ersetzt (inhaltlich identisch, keine erfundene Aenderung an
      // der eigentlichen Funktion).
      "Wer die eigene Rolle noch nicht kennt, klickt hier einfach an, was er/sie schon kann oder gerne macht — kein Text nötig. Daraus errechnen wir echte, prozentuale Rollen-Vorschläge statt nur eine Branche raten zu lassen. Eine konkrete Rolle muss dabei nicht aktiv angeklickt werden: ein einfaches „Weiter“ wählt automatisch die am besten passende, direkt aus diesem Bereich. Ab hier läuft der komplette weitere Ablauf entlang derselben Kette automatisch: Bereich → Rolle → Skill-Abgleich → Lücken-Berechnung → passende Kursempfehlung — die angeklickten Skills sind im Fragebogen-Schritt danach schon vorausgewählt.",
    benefit: "Dieser Weg fängt genau die Personen auf, die sonst ohne konkrete Rolle abgesprungen wären — der hier ermittelte Bereich taucht danach direkt im Dashboard wieder auf (Filterleiste in Leads, Kurse und Reports, siehe Branche/Bereich-Filter) und entscheidet mit, welche deiner Kurse überhaupt als Empfehlung infrage kommen. Ein Kurs ohne gepflegten Bereich bleibt für genau diese Zielgruppe unsichtbar. Die daraus automatisch gewählte Rolle steht danach genauso fest im Lead wie bei einer manuellen Auswahl — du siehst im Dashboard exakt, wofür sich jemand qualifizieren möchte.",
    demoEvent: "🧭 Bereich erkannt: Wirtschaft & Verwaltung",
  },
  {
    key: "zielrolle",
    // Round 24: im Bereichs-Pfad (der Regelfall bei einer Demo/Aufzeichnung)
    // jetzt uebersprungen — sein Inhalt steckt seitdem im "bereich"-Schritt
    // oben. Im "kennt Zielrolle bereits"-Pfad gibt es keinen "bereich"-Schritt,
    // dort bleibt dies weiterhin der einzige, vollwertige Rollen-Auswahl-Schritt.
    hideIfKeyPresent: "bereich",
    selector: '[data-tour="tour-panel"]',
    // Round 27: Titel von "Zielrolle waehlen" auf "Rolle direkt angeben"
    // umbenannt — gleiche Funktion (Freitextsuche + Karten-Auswahl), aber
    // ohne das Wort "Zielrolle" als Ueberschrift, siehe Kommentar am
    // "bereich"-Schritt oben.
    title: "Rolle direkt angeben",
    description:
      "Freitextsuche plus Karten-Auswahl. Ab hier läuft der komplette weitere Ablauf automatisch: Skill-Abgleich → Lücken-Berechnung → passende Kursempfehlung.",
    benefit: "Die gewählte Rolle steht danach fest im Lead — du siehst im Dashboard exakt, wofür sich jemand qualifizieren möchte, statt nur vager „Interesse an Weiterbildung“.",
  },
  {
    key: "skills",
    selector: '[data-tour="tour-panel"]',
    title: "Lebenslauf oder Fragebogen",
    description:
      "Zwei Wege zum selben Ergebnis: Lebenslauf hochladen (inkl. OCR-Fallback fuer eingescannte PDFs) oder die Kern-Skills der gewählten Rolle per Checkbox angeben. Die DSGVO-Einwilligung ist beim Upload Pflicht.",
    benefit: "Beide Wege liefern echte, belegte Skills statt einer Selbsteinschätzung „aus dem Bauch heraus“ — die Grundlage für ein Match, das im Beratungsgespräch auch inhaltlich standhält.",
  },
  {
    key: "gap",
    requires: "gapResult",
    selector: '[data-tour="tour-panel"]',
    title: "Skill-Gap-Ergebnis",
    description:
      // Round 23 ("du hast das Problem nicht behoben" — Round 21 hatte den
      // Zielrollen-Fokus bewusst nur bei "Zielrolle waehlen" und "Passende
      // Weiterbildung" entschärft und diesen Schritt hier explizit
      // ausgenommen, siehe alter Kommentar unten bzw. Projekt-Doku
      // "Nicht Teil dieses Durchgangs". Das war die Lücke: gerade dieser
      // Schritt klang mit "fuer die Zielrolle" am staerksten nach
      // Einzelfall-Bezug statt Mechanismus. Jetzt vorne der ALLGEMEINE
      // Abgleichs-Mechanismus, die aktive Rolle liefert nur die
      // Vergleichsbasis, ist aber nicht mehr der rhetorische Aufhaenger.
      "So entsteht das Ergebnis: die erkannten Skills werden automatisch gegen die Kern-Anforderungen der gewählten Rolle abgeglichen — jeder Treffer und jede Lücke mit einer echten Begründung statt einer abstrakten Prozentzahl: ein woertliches Zitat aus dem Lebenslauf (per Ueberschriften-Erkennung sogar mit Abschnitt wie „Berufserfahrung“ oder „Ausbildung“), oder sobald verfuegbar die Einschaetzung der KI-Tiefenanalyse. Zusaetzlich waehlbar: das eigene Erfahrungslevel je Skill (Grundkenntnisse/Fortgeschritten/Experte, mit KI-Vorschlag vorbelegt) sowie eine manuelle Korrektur („✕ Entfernen“/„+ Als vorhanden markieren“) — jede Anpassung wirkt sich sofort auf Match-Prozent UND die anschliessende Kursempfehlung aus, der Prozess reagiert live auf jede Aenderung.",
    benefit: "Ein nachvollziehbar begründetes Ergebnis schafft an genau diesem kritischen Punkt Vertrauen — und erhöht die Wahrscheinlichkeit, dass die Person danach wirklich einen Kurs auswählt statt abzuspringen.",
    // Round 23: feste "82 % Match"-Zahl entfernt — derselbe Grund wie beim
    // Kursempfehlungs-Toast in Runde 21 (siehe unten): der tatsaechliche
    // Demo-Gap-Fallback in runDemoAnalysis() (JourneyPage.tsx) liefert einen
    // anderen, ebenfalls variablen Wert, eine fest im Code stehende Prozentzahl
    // im Toast waere eine erfundene Zahl statt einer echten Berechnung.
    demoEvent: "✨ Skill-Gap live berechnet",
  },
  {
    key: "kurs",
    requires: "courseResult",
    selector: '[data-tour="tour-panel"]',
    title: "Passende Weiterbildung",
    description:
      // Round 21 ("bei der Journey soll nicht so auf die Zielrolle
      // eingegangen werden, sondern der Prozess soll erklärt werden"):
      // vorher stand hier eine Zusicherung, WARUM "genau dieser Kurs"
      // passt — das behauptet für den konkret gezeigten Beispielkurs eine
      // Präzision, die pickShowcaseCourses() (siehe JourneyPage.tsx) im
      // Rundgang gar nicht mehr verspricht (dort zählt Datenvollständigkeit,
      // nicht Rollen-Passung). Jetzt erklärt der Text den MECHANISMUS
      // allgemein, statt eine Aussage über den gerade sichtbaren Einzelfall
      // zu treffen.
      "So funktioniert die Empfehlung: die Kurse aus dem eigenen Katalog werden nach gewichteter Abdeckung der Skill-Lücke sortiert, die weiter oben genannten Rahmenbedingungen entscheiden nur bei fachlich gleichwertigen Treffern über die Reihenfolge — nie über die Sichtbarkeit. Jede Karte zeigt zusätzlich Preis (inkl. USt.-Hinweis/Prüfungsgebühr), Unterrichtseinheiten, Abschlussart und einen „Förderfähig“-Hinweis, falls vom Bildungsträger gepflegt, und bei einem echten Treffer eine individuelle Begründung mit konkreten Skill-Namen statt einer allgemeinen Floskel. Einzelne Kurskacheln können außerdem Banner wie „Startet in Kürze“ oder „Nur noch wenige Plätze“ zeigen — direkt vom Bildungsträger im Dashboard aus echten Werten gesetzt, nie erfunden. Der Nutzer wählt hier aktiv einen konkreten Kurs, „Match danach“ zeigt ehrlich, wie viel näher die eigene Wahl ans Ziel bringt.",
    benefit: "Hier entscheidet sich, welcher deiner Kurse überhaupt gezeigt wird — gepflegte Rahmendaten, ein aktueller Buchungslink und der richtige Bereich zahlen sich direkt in mehr qualifizierten Leads aus.",
    // Round 21: keine feste Prozentzahl mehr behaupten (siehe Kommentar an
    // der description oben) — die im Rundgang gezeigte Beispielkarte kann
    // je nach Katalog auch mal 0% Lücken-Abdeckung haben (bewusst, siehe
    // pickShowcaseCourses()).
    demoEvent: "🎓 Kursempfehlung angezeigt",
  },
  {
    key: "lead",
    selector: '[data-tour="tour-panel"]',
    title: "Kontaktaufnahme",
    description:
      "Letzter Schritt: nur noch Name, E-Mail (optional Telefon) und die DSGVO-Einwilligung — der qualifizierte Lead landet direkt im Bildungstraeger-Dashboard, inklusive gewählter Rolle, Match-Score, gewaehltem Kurs und den weiter oben angegebenen Rahmenbedingungen (Beschaeftigungsart, Arbeitsort, Wunschstart, Foerderung). Zwei klare Wege: direkt buchen oder erst beraten lassen — beides landet als Lead im Dashboard, nur mit unterschiedlichem Status. Die Einwilligung wird mit Zeitpunkt und Text-Version nachweisbar gespeichert, die Person kann ihre Daten jederzeit vom Bildungstraeger loeschen lassen (Recht auf Loeschung, Art. 17 DSGVO).",
    benefit: "Das komplette Ergebnis landet ohne manuelle Übertragung direkt im Dashboard — inklusive Bereich, gewählter Rolle und Match-Score, sofort filterbar und einsatzbereit fürs Beratungsgespräch.",
    demoEvent: "📥 Neuer Lead im Dashboard sichtbar",
  },
  {
    key: null,
    selector: null,
    title: "Das war der Rundgang",
    description:
      "Den Button „🧭 Rundgang starten“ findest du jederzeit wieder — praktisch direkt vor einer Praesentation oder Bildschirmaufzeichnung. Er erscheint nur im Demo-/Entwicklungsmodus, nie fuer echte Endnutzer. Beim erneuten Start läuft eine laufende automatische Wiedergabe wieder von vorne los.",
  },
];


/**
 * Journey v2 (28.09.2026): eigener Rundgang fuer die neue, kurze Journey
 * (Ziel -> Erfahrung -> Richtung/Schwerpunkt -> Kurz-Check -> Rahmen ->
 * Empfehlung/Anfrage). Die Vorschau-Daten baut runV2Demo() in JourneyPage.tsx
 * aus dem echten Katalog des Traegers, ohne Eintrag in den Reports.
 */
const RAW_STEPS_V2: RawStep[] = [
  {
    key: null,
    selector: null,
    title: "Rundgang durch die Journey",
    description:
      "So erleben Interessierte deinen Weiterbildungs-Finder – Bildschirm für Bildschirm, von „Was möchtest du erreichen?“ bis zur Anfrage in deinem Dashboard. Der Rundgang füllt dafür eine Beispiel-Journey mit Werten aus deinem echten Kurskatalog. Dabei entstehen keine Leads und keine Einträge in deinen Reports; beim Beenden wird alles zurückgesetzt.",
    benefit: "Für eine Bildschirmaufnahme: „▶ Automatisch abspielen“ lässt den Rundgang von selbst laufen.",
  },
  {
    key: "v2ziel",
    selector: '[data-tour="tour-stepper"]',
    title: "Sechs Schritte, klarer Fortschritt",
    description:
      "Ziel, Erfahrung, Richtung, Kurz-Check, Rahmen, Empfehlung. Die Leiste zeigt jederzeit, wo man steht und wie viel noch kommt; mit „Zurück“ lässt sich jede Angabe ändern.",
    benefit: "Sichtbarer Fortschritt hält Interessierte bis zur Anfrage bei der Stange.",
  },
  {
    key: "v2ziel",
    selector: ['[data-tour="v2-goals"]', '[data-tour="tour-panel"]'],
    title: "1 · Ziel statt Berufsbezeichnung",
    description:
      "Der Einstieg fragt nach dem Ziel, nicht nach einem Jobtitel – etwa im Beruf weiterkommen, sich neu orientieren oder Führung übernehmen. Das Ziel steuert später, auf welchem Niveau die passenden Berufe liegen (z. B. Aufstieg statt Wiedereinstieg).",
    benefit: "Niemand muss am Anfang einen Berufsnamen kennen – das senkt die Hürde für den Einstieg.",
  },
  {
    key: "v2ziel",
    selector: ['[data-tour="v2-known"]', '[data-tour="tour-panel"]'],
    title: "Abkürzung für Entschlossene",
    description:
      "Wer schon einen Beruf im Kopf hat, springt über „Ich weiß schon, welchen Beruf ich anstrebe“ direkt in die Berufssuche. Wird es dort doch zu konkret, führt „Nur Branche wählen“ zurück auf den Weg über Bereich und Schwerpunkt – ohne neu anzufangen.",
    benefit: "Beide Gruppen kommen ans Ziel: die Entschlossenen schneller, die Suchenden ohne Abbruch.",
  },
  {
    key: "v2herkunft",
    selector: ['[data-tour="v2-qualification"]', '[data-tour="tour-panel"]'],
    title: "2 · Höchster Abschluss",
    description:
      "Ein Tipp genügt: kein Berufsabschluss, Berufsausbildung, Meister/Fachwirt/Techniker oder Studium. Daraus prüft die Journey später bei jedem Kurs die Zulassung und zeigt realistische nächste Schritte.",
    benefit: "Du bekommst weniger Anfragen, bei denen die Zulassungsvoraussetzungen gar nicht passen.",
  },
  {
    key: "v2herkunft",
    selector: ['[data-tour="v2-activities"]', '[data-tour="tour-panel"]'],
    title: "Erfahrung in Alltagssprache",
    description:
      "Erst das Arbeitsfeld, dann anklicken, was man dort gemacht hat – z. B. „Waren annehmen, prüfen und einlagern“. Jede Tätigkeit ist fest mit Kompetenzen verknüpft; die Journey zeigt sofort, wie viele Stärken dadurch schon erkannt sind. Aushilfsjobs, Praktika und Ehrenamt zählen mit.",
    benefit: "Auch Menschen ohne aktuellen Lebenslauf, etwa aus Transfergesellschaften, kommen so ins Matching.",
  },
  {
    key: "v2herkunft",
    selector: ['[data-tour="v2-cv"]', '[data-tour="tour-panel"]'],
    title: "Oder: Lebenslauf hochladen",
    description:
      "Wer lieber seinen Lebenslauf nutzt, lädt ihn hier hoch (auch eingescannte PDFs). Die Einwilligung zur Verarbeitung wird dabei ausdrücklich eingeholt und mit Zeitpunkt gespeichert.",
  },
  {
    key: "v2richtung",
    sub: "bereich",
    selector: ['[data-tour="v2-bereiche"]', '[data-tour="tour-panel"]'],
    title: "3 · Bereich wählen",
    description:
      "Ein oder zwei Branchen auswählen. Bereiche, zu denen die angeklickten Tätigkeiten schon passen, stehen oben – mit „✓ Erfahrung vorhanden“ und der Begründung in den Worten der Person. Angezeigt werden nur Bereiche, in denen du Kurse anbietest.",
    benefit: "Der gewählte Bereich landet im Lead und ist im Dashboard filterbar.",
  },
  {
    key: "v2richtung",
    sub: "schwerpunkt",
    selector: ['.v2-focus', '[data-tour="tour-panel"]'],
    title: "Schwerpunkt im Bereich",
    description:
      "Danach grenzt die Person den Bereich ein – in der IT z. B. „Programmierung“ oder „IT-Projektmanagement“, in der Logistik „Lager & Umschlag“ oder „Disposition“. Hinweise zeigen, wo schon Erfahrung da ist und wo es passende Kurse gibt. Wer sich nicht festlegen will, wählt „Noch offen – zeig mir alle Möglichkeiten“.",
    benefit: "Schwerpunkte mit deinen Kursen stehen oben – und die Fragen danach passen genau zum gewählten Weg.",
    demoEvent: "🧭 Schwerpunkt gewählt",
  },
  {
    key: "v2check",
    selector: ['.v2-evidence', '[data-tour="tour-panel"]'],
    title: "4 · Was schon belegt ist",
    description:
      "Oben steht „Dein Bereich: … · Schwerpunkt“ (jederzeit änderbar) und darunter, welche Stärken aus den Tätigkeiten schon belegt sind. Stimmt etwas nicht, reicht ein Klick auf ×, dann wird es stattdessen kurz abgefragt.",
    benefit: "Ehrlich und nachvollziehbar – niemand bekommt Kompetenzen „untergeschoben“.",
  },
  {
    key: "v2check",
    selector: ['.v2-check-card', '[data-tour="tour-panel"]'],
    title: "Kurz-Check: höchstens fünf Fragen",
    description:
      "Nur die Fragen, die für den gewählten Weg wirklich zählen – in Alltagssprache, eine Frage pro Karte, beantwortet mit „Ja“, „Ein bisschen“ oder „Noch nicht“. Nach jeder Antwort geht es automatisch weiter.",
    benefit: "Kurz genug gegen Abbrüche, genau genug für ein belastbares Kompetenzprofil im Lead.",
  },
  {
    key: "v2rahmen",
    selector: ['.v2-rahmen-grid', '[data-tour="tour-panel"]'],
    title: "5 · Situation und Rahmen",
    description:
      "Die Situation (beschäftigt, arbeitsuchend, Transfergesellschaft, Ausbildung) bestimmt die passenden Förderwege. Dazu der Wunschstart sowie Zeitmodell und Lernort – die letzten beiden erscheinen nur, wenn dein Katalog dort eine echte Wahl bietet. Alles ist optional.",
    benefit: "Die Angaben stehen am Lead – du weißt vor dem Rückruf, ob z. B. ein Bildungsgutschein Thema ist.",
  },
  {
    key: "v2rahmen",
    selector: ['.v2-hurdles', '[data-tour="tour-panel"]'],
    title: "Was wichtig ist – und was schwierig werden könnte",
    description:
      "Zwei kurze Chip-Zeilen: Was ist am wichtigsten (z. B. anerkannter Abschluss, flexibel lernen)? Was könnte schwierig werden (Zeit, Kosten, lange nicht gelernt, Deutsch)? Die Empfehlung geht später genau darauf ein.",
    benefit: "Wie im Beratungsgespräch: Einwände werden beantwortet, bevor sie zum Abbruchgrund werden.",
  },
  {
    key: "v2ergebnis",
    requires: "courseResult",
    selector: ['.v2-strengths', '.v2-basis', '[data-tour="tour-panel"]'],
    title: "6 · Deine Basis",
    description:
      "Das Ergebnis beginnt mit dem, was die Person mitbringt: die angeklickten Tätigkeiten und die Stärken aus dem Kurz-Check. Über „Stimmt etwas nicht? Anpassen“ geht es direkt zurück zum Check. Darüber steht offen, aus wessen Kursangebot die Empfehlungen stammen.",
  },
  {
    key: "v2ergebnis",
    requires: "courseResult",
    selector: ['[data-tour="v2-options"]', '[data-tour="tour-panel"]'],
    title: "Möglichkeiten statt Einzeltreffer",
    description:
      "Wer über einen Bereich kam, sieht hier realistische Berufe mit Niveau und dem Kurs dorthin. „Weg ansehen“ springt zur passenden Kurskarte; für Berufe ohne eigenen Kurs führt „Dazu beraten lassen“ direkt zur Anfrage mit Beratung.",
    benefit: "Auch Interessierte ohne festes Ziel landen bei einem konkreten nächsten Schritt.",
    demoEvent: "🎓 Empfehlung berechnet",
  },
  {
    key: "v2ergebnis",
    requires: "courseResult",
    selector: ['[data-tour="v2-top-course"] .v2-ladder', '[data-tour="v2-top-course"]'],
    title: "Top-Empfehlung: wohin der Kurs führt",
    description:
      "Jede Kurskarte zeigt, zu welchem Beruf der Kurs führt und was danach möglich ist, dazu Dauer, Preis, Start und Lernform. Darunter: worauf der Kurs aufbaut, was neu dazukommt und warum er zu den Angaben passt.",
    benefit: "Gepflegte Kursdaten wie Start, Preis, Abschluss und Zielberuf machen deine Kurse hier überzeugender.",
  },
  {
    key: "v2ergebnis",
    requires: "courseResult",
    selector: [
      '[data-tour="v2-top-course"] .v2-funding-plan',
      '[data-tour="v2-top-course"] .v2-prereq',
      '[data-tour="v2-top-course"]',
    ],
    title: "Förderung, Zulassung, offene Fragen",
    description:
      "Passend zur Situation erklärt die Karte den Förderweg in konkreten Schritten – etwa zum Bildungsgutschein mit deiner Maßnahmenummer und Link zur Arbeitsagentur. Dazu der Zulassungs-Check zum Abschluss und kurze Antworten auf die genannten Hürden. Förderung wird nie versprochen, nur erklärt.",
    benefit: "Voraussetzung: Förderwege und Maßnahmenummer sind am Kurs im Dashboard gepflegt.",
  },
  {
    key: "v2ergebnis",
    requires: "courseResult",
    selector: ['.v2-request-bar', '[data-tour="v2-top-course"] .v2-request-toggle'],
    title: "Mehrere Kurse gleichzeitig anfragen",
    description:
      "Mit „Zur Anfrage hinzufügen“ sammelt die Person beliebig viele Kurse. Die Leiste unten zeigt, wie viele es sind, und führt mit „Anfrage fertigstellen“ zur Abschlussseite.",
    benefit: "Im Dashboard entsteht daraus ein einziger Lead, an dem alle angefragten Kurse hängen.",
  },
  {
    key: "v2ergebnis",
    requires: "courseResult",
    selector: ['[data-tour="v2-consult"]', '[data-tour="tour-panel"]'],
    title: "Lieber erst persönlich sprechen?",
    description:
      "Wer noch unsicher ist, fragt direkt ein kostenloses Beratungsgespräch an. Die Antworten aus der Journey liegen der Beratung dann schon vor.",
  },
  {
    key: "v2ergebnis",
    sub: "contact",
    requires: "courseResult",
    selector: ['.v2-contact-form', '.v2-contact', '[data-tour="tour-panel"]'],
    title: "Eine Abschlussseite für alles",
    description:
      "Oben die gewählten Kurse (einzeln entfernbar oder ergänzbar), darunter Vorname, E-Mail und Telefon. Ein großer Haken steht für das kostenlose persönliche Beratungsgespräch, danach folgt die DSGVO-Einwilligung – sie wird mit Zeitpunkt und Textversion nachweisbar gespeichert.",
    benefit: "Ist der Haken gesetzt, steht am Lead im Dashboard „Beratungsgespräch angefragt“ – mit „Vereinbart“ und „Durchgeführt“ zum Abhaken.",
    demoEvent: "📥 Neuer Lead im Dashboard",
  },
  {
    key: "v2ergebnis",
    sub: "plan",
    requires: "courseResult",
    selector: ['.v2-plan', '.v2-plan-screen', '[data-tour="tour-panel"]'],
    title: "Der persönliche Weiterbildungsplan",
    description:
      "Nach dem Absenden bekommt die Person ihren Plan: Ziel, Weg, Kurs mit Dauer, Start und Kosten, was sie mitbringt und lernt, den Förderweg und die nächsten Schritte. Er lässt sich drucken oder als PDF speichern.",
    benefit: "Die Person geht mit etwas Greifbarem aus der Journey – und kommt gut vorbereitet in dein Beratungsgespräch.",
  },
  {
    key: null,
    selector: null,
    title: "Was bei dir im Dashboard ankommt",
    description:
      "Ein Lead mit Kontaktdaten, allen angefragten Kursen, Zielberuf und Match, Beratungswunsch sowie einer Notiz aus der Journey: Situation, was wichtig ist, mögliche Hürden und die Erfahrung in den Worten der Person. Bereich und Zeitraum sind filterbar, die Reports werten Skill-Gaps und Top-Kurse aus.",
  },
  {
    key: null,
    selector: null,
    title: "Das war der Rundgang",
    description:
      "Beim Beenden wird die Beispiel-Journey zurückgesetzt. Den Button „Rundgang starten“ findest du jederzeit wieder – praktisch direkt vor einer Präsentation oder Aufnahme.",
  },
];

const PAD = 10;
const CARD_WIDTH = 380;

interface JourneyTourProps {
  open: boolean;
  onClose: () => void;
  /** Schluessel des Journey-Schritts, der gerade aktiv ist (oder "intro",
   *  solange die Einstiegsfrage/knowsRole noch nicht beantwortet ist). */
  currentKey: JourneyStepKey | "intro";
  /** Schluessel, die im AKTUELL gueltigen Pfad ueberhaupt vorkommen (5 oder
   *  6 Schritte, je nachdem ob "bereich" dabei ist) - steuert, ob der
   *  "bereich"-Tour-Schritt angezeigt wird. */
  availableKeys: JourneyStepKey[];
  hasGapResult: boolean;
  hasCourseResult: boolean;
  /** Navigiert die Journey selbst zum gewuenschten Schritt (kuemmert sich in
   *  JourneyPage auch darum, aus der Einstiegsfrage herauszukommen, falls
   *  der Rundgang dort gestartet wurde). */
  onNavigate: (key: JourneyStepKey, sub?: string) => void;
  /** Loest bei Bedarf eine echte (nicht erfundene) Beispiel-Analyse aus,
   *  damit "Skill-Gap" und "Kurs" auch ohne vorherigen echten Durchlauf im
   *  Rundgang etwas zeigen - siehe runDemoAnalysis in JourneyPage.tsx. Wird
   *  nur aufgerufen, wenn hasGapResult/hasCourseResult beim Oeffnen noch
   *  false sind; ist schon ein echtes Ergebnis da, passiert nichts. */
  onEnsureDemoResults: () => void;
  /** Welche Journey laeuft (v2 = neue, kurze Journey). */
  version?: "v1" | "v2";
}

export function JourneyTour({
  open,
  onClose,
  currentKey,
  availableKeys,
  hasGapResult,
  hasCourseResult,
  onNavigate,
  onEnsureDemoResults,
  version = "v1",
}: JourneyTourProps) {
  const steps = useMemo(
    () =>
      (version === "v2" ? RAW_STEPS_V2 : RAW_STEPS).filter((s) => {
        if (s.key === null) return true;
        if (!availableKeys.includes(s.key)) return false;
        if (s.requires === "gapResult" && !hasGapResult) return false;
        if (s.requires === "courseResult" && !hasCourseResult) return false;
        // Round 24: "zielrolle" bekommt keinen eigenen Schritt, wenn "bereich"
        // in dieser Session ohnehin gezeigt wird (siehe hideIfKeyPresent-Kommentar
        // an RawStep) — sein Inhalt steckt dann bereits im "bereich"-Schritt.
        if (s.hideIfKeyPresent && availableKeys.includes(s.hideIfKeyPresent)) return false;
        return true;
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [availableKeys.join(","), hasGapResult, hasCourseResult, version],
  );
  const [stepIdx, setStepIdx] = useState(0);
  const cardRef = useRef<HTMLDivElement>(null);
  // Karte einklappen (v. a. auf schmalen Screens), damit das hervorgehobene
  // Element komplett sichtbar ist. Bleibt ueber die Schritte hinweg bestehen.
  const [collapsed, setCollapsed] = useState(false);
  const demoTriggeredRef = useRef(false);
  // Automatische Wiedergabe (NEU, 18.09., siehe tourAutoplay.tsx) — rein
  // clientseitig, nur fuers Bild bei einer Bildschirmaufzeichnung.
  const [autoplay, setAutoplay] = useState(false);

  const step = steps[Math.min(stepIdx, steps.length - 1)];
  const isLast = stepIdx >= steps.length - 1;
  const isFirst = stepIdx === 0;
  // Solange Skill-Gap- oder Kursergebnis noch fehlen, erst eine echte
  // Beispiel-Analyse anstossen (einmal pro Oeffnen) und in der Zwischenzeit
  // eine kurze Warteflaeche statt des eigentlichen Rundgangs zeigen - sonst
  // wuerden "gap"/"kurs" beim Start einfach lautlos aus der Tour fallen.
  const waitingForDemoResults = open && (!hasGapResult || !hasCourseResult);
  // Laeuft der letzte Schritt oder wird noch auf die Demo-Analyse gewartet,
  // bleibt die Automatik bewusst stehen statt weiterzuspringen oder die Tour
  // zu schliessen — bei einer Aufzeichnung soll Quentin selbst entscheiden,
  // wann er "Fertig" klickt bzw. abwarten, bis echte Ergebnisse da sind.
  const autoplayProgress = useTourAutoplay(
    autoplay && open && !isLast && !waitingForDemoResults,
    stepIdx,
    readingDurationMs(step.description + (step.benefit ?? "")),
    () => setStepIdx((i) => Math.min(i + 1, steps.length - 1)),
  );

  useEffect(() => {
    if (open) {
      setStepIdx(0);
      setAutoplay(false);
    }
  }, [open]);

  /** Bugfix (14.09., "die Kachel von der Rundtour ist hinter den Infos, die
   *  muss irgendwo am Rand stehen, sodass man beides immer sieht"): die feste
   *  Docking-Position allein loest das Ausserhalb-des-Bildschirms-Problem
   *  (siehe Kopf-Kommentar), aber bei einem inhaltsreichen Schritt wie
   *  "Skill-Gap-Ergebnis" kann die (immer gleich grosse) Karte trotzdem Teile
   *  des ECHTEN, gerade hervorgehobenen Inhalts ueberdecken, wenn dieser
   *  hoeher ist als der Platz unten. Ab einer gewissen Fensterbreite (siehe
   *  Media Query bei .tour-card-dock in journey.css) dockt die Karte deshalb
   *  stattdessen seitlich am rechten Rand — und ".stage" bekommt hier per
   *  Body-Klasse echten zusaetzlichen Platz auf der rechten Seite (kein
   *  Ueberlappen, sondern eine echte Verschiebung des Widgets nach links),
   *  damit "man beides immer sieht" auch bei hohem Inhalt stimmt. Auf
   *  schmalen Bildschirmen (Media Query greift dort nicht) bleibt exakt das
   *  bisherige Verhalten (unten mittig) erhalten. */
  useEffect(() => {
    document.body.classList.toggle("journey-tour-open", open);
    return () => {
      document.body.classList.remove("journey-tour-open");
    };
  }, [open]);

  useEffect(() => {
    if (!open) {
      demoTriggeredRef.current = false;
      return;
    }
    if (!demoTriggeredRef.current && (!hasGapResult || !hasCourseResult)) {
      demoTriggeredRef.current = true;
      onEnsureDemoResults();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, hasGapResult, hasCourseResult]);

  // Journey zum passenden Schritt navigieren, falls der Tour-Schritt einen
  // anderen Schluessel braucht als gerade aktiv ist. Erst NACHDEM die
  // Beispiel-Analyse (falls noetig) fertig ist, sonst wuerde die Tour schon
  // lospatschen, waehrend im Hintergrund noch nachgeladen wird.
  useEffect(() => {
    if (!open || waitingForDemoResults || !step.key) return;
    // v2: immer navigieren (auch innerhalb desselben Schritts wechselt die
    // Unter-Ansicht, z. B. Bereich -> Schwerpunkt oder Ergebnis -> Anfrage).
    if (step.key !== currentKey || version === "v2") onNavigate(step.key, step.sub);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, waitingForDemoResults, stepIdx, step.key]);

  // Spotlight erst, wenn die Navigation im richtigen Journey-Schritt
  // angekommen ist (gemeinsame Logik, siehe tourSpotlight.ts).
  const selectors = step.selector === null ? null : Array.isArray(step.selector) ? step.selector : [step.selector];
  const rect = useTourSpotlight(
    open && !waitingForDemoResults && (!step.key || step.key === currentKey),
    selectors,
    stepIdx,
    cardRef,
  );

  useEffect(() => {
    if (!open) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
      else if (e.key === "ArrowRight") setStepIdx((i) => Math.min(i + 1, steps.length - 1));
      else if (e.key === "ArrowLeft") {
        // Autoplay bei manueller Rückwärts-Navigation stoppen (analog DashboardTour.tsx) —
        // sonst springt der Timer mitten in der eigenen Rückschau wieder nach vorne.
        setAutoplay(false);
        setStepIdx((i) => Math.max(i - 1, 0));
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, onClose, steps.length]);

  if (!open) return null;

  if (waitingForDemoResults) {
    return (
      <div className="tour-layer" role="dialog" aria-modal="true" aria-label="Gefuehrter Rundgang durch die Journey">
        <div className="tour-scrim" />
        <div className="tour-card tour-card-dock tour-card-preparing" style={{ width: CARD_WIDTH }}>
          <div className="tour-card-head">
            <span className="tour-step-count">Rundgang wird vorbereitet</span>
            <button className="tour-close" onClick={onClose} aria-label="Rundgang beenden" title="Beenden (Esc)">
              ×
            </button>
          </div>
          <div className="tour-card-body">
            <div className="tour-autoplay-row">
              <TourAutoplayToggle active={autoplay} onToggle={() => setAutoplay((a) => !a)} />
            </div>
            <div className="tour-preparing-spinner" aria-hidden="true" />
            <p className="tour-desc">
              Der Rundgang bereitet gerade ein Beispiel aus deinem Kurskatalog vor, damit auch die Empfehlung etwas
              zeigt – dauert nur einen Moment.
            </p>
          </div>
        </div>
      </div>
    );
  }

  const highlightBox = rect
    ? { top: rect.top - PAD, left: rect.left - PAD, width: rect.width + PAD * 2, height: rect.height + PAD * 2 }
    : null;

  return (
    <div className="tour-layer" role="dialog" aria-modal="true" aria-label="Gefuehrter Rundgang durch die Journey">
      {/* Mit Spotlight durchsichtig (dessen Schatten dunkelt ab), sonst dunkel.
          Ein Klick darauf beendet den Rundgang nicht versehentlich. */}
      <div className={`tour-scrim ${highlightBox ? "is-clear" : ""}`} />
      {highlightBox && (
        <div
          className="tour-spotlight"
          style={{ top: highlightBox.top, left: highlightBox.left, width: highlightBox.width, height: highlightBox.height }}
        />
      )}
      <TourDemoToast text={autoplay ? step.demoEvent : null} toastKey={stepIdx} />
      <div ref={cardRef} className={`tour-card tour-card-dock ${collapsed ? "is-collapsed" : ""}`} style={{ width: CARD_WIDTH }}>
        <div className="tour-card-head">
          <span className="tour-step-count">
            {stepIdx + 1} / {steps.length}
          </span>
          <span className="tour-head-btns">
            <button
              type="button"
              className="tour-collapse"
              onClick={() => setCollapsed((c) => !c)}
              aria-expanded={!collapsed}
              title={collapsed ? "Erklärung wieder anzeigen" : "Karte einklappen, um den Bereich ganz zu sehen"}
            >
              {collapsed ? "Text zeigen ▴" : "Einklappen ▾"}
            </button>
            <button className="tour-close" onClick={onClose} aria-label="Rundgang beenden" title="Beenden (Esc)">
              ×
            </button>
          </span>
        </div>
        {/* Rueckmeldung (19./20.09., "Beschreibung soll immer sichtbar sein,
           egal in welchem Format man die Seite offen hat") — identischer
           Aufbau wie in DashboardTour.tsx (siehe Kommentar dort): dieser
           mittlere Block ist der einzige Scroll-Container der Karte, Kopf
           und die Weiter/Zurueck-Buttons bleiben aussen und damit immer
           sichtbar. */}
        <div className="tour-card-body">
          {/* Eigene, auffällige Zeile statt im engen Kopf (siehe Kommentar an
             TourAutoplayToggle in tourAutoplay.tsx) — vorher zwischen
             Schrittzähler und ×-Button eingeklemmt und dadurch leicht zu
             übersehen. */}
          <div className="tour-autoplay-row">
            <TourAutoplayToggle active={autoplay} onToggle={() => setAutoplay((a) => !a)} />
          </div>
          <TourAutoplayBar active={autoplay && !isLast} progress={autoplayProgress} />
          <h3 className="tour-title">{step.title}</h3>
          <p className="tour-desc">{step.description}</p>
          {step.benefit && <p className="tour-benefit">{step.benefit}</p>}
          {/* Klickbare Punkte statt reiner Anzeige (NEU, 18.09., "es soll
             interaktiver sein") — direkter Sprung zu jedem Schritt, stoppt
             dabei die Automatik wie ein manueller Zurück-Klick. Die
             bestehende Navigations-/Mess-Logik oben reagiert bereits allein
             auf `stepIdx`, ein Sprung über mehrere Schritte hinweg
             funktioniert also genauso wie ein einzelner Weiter-/Zurück-Klick. */}
          <TourStepDots
            count={steps.length}
            currentIndex={stepIdx}
            onJump={(i) => {
              setAutoplay(false);
              setStepIdx(i);
            }}
          />
        </div>
        <div className="tour-actions">
          <button className="tour-btn tour-btn-ghost" onClick={onClose}>
            Beenden
          </button>
          <div className="tour-nav-btns">
            <button
              className="tour-btn tour-btn-secondary"
              onClick={() => {
                // Siehe ArrowLeft-Handler oben: manuelles Zurückgehen beendet Autoplay.
                setAutoplay(false);
                setStepIdx((i) => Math.max(i - 1, 0));
              }}
              disabled={isFirst}
            >
              ← Zurück
            </button>
            <button
              className="tour-btn tour-btn-primary"
              onClick={() => (isLast ? onClose() : setStepIdx((i) => Math.min(i + 1, steps.length - 1)))}
            >
              {isLast ? "Fertig ✓" : "Weiter →"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}