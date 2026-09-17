/**
 * ESCO-Skills auf Deutsch nachladen — Version 2 (direkter Supabase-Sync)
 * =======================================================================
 *
 * Ersetzt scripts/esco-fetch-german-labels.mjs: das alte Skript brauchte
 * einen manuellen Umweg über den Supabase SQL Editor (Query ausführen,
 * Ergebnis als CSV exportieren, uris.txt bauen) — und der SQL Editor
 * begrenzt die angezeigte/exportierbare Ergebnistabelle auf 100 Zeilen, bei
 * ~13.900 ESCO-Skills also unbrauchbar für den vollen Export.
 *
 * Dieses Skript braucht KEINEN manuellen SQL-Schritt mehr (bis auf das
 * einmalige Anlegen der Zieltabelle, siehe SCHRITT 1 unten): es liest die
 * esco_uris direkt aus eurer Supabase-Datenbank (mit Pagination, umgeht
 * damit jedes Anzeige-Limit), holt die deutschen Bezeichnungen von der
 * ESCO-API — GENAU dieselbe Logik wie im alten Skript, siehe
 * extractGermanLabel() — und schreibt sie direkt zurück in die Datenbank.
 * Kein uris.txt, keine SQL-Datei mehr, kein manuelles Kopieren.
 *
 * WICHTIG — bitte VOR dem produktiven Lauf stichprobenartig prüfen: die
 * Cloud-Umgebung, in der dieses Skript entstanden ist, hat KEINEN
 * Netzwerkzugriff auf ec.europa.eu (dort geblockt) — ich konnte die exakte
 * Feld-Struktur der ESCO-API-Antwort deshalb NICHT live testen. Das Skript
 * gibt bei der ALLERERSTEN URI die komplette Rohantwort in der Konsole aus
 * — bitte kurz draufschauen, ob eine sinnvolle deutsche Bezeichnung dabei
 * rauskommt, bevor der volle Lauf durchläuft (Strg+C bricht sauber ab,
 * bereits geschriebene Zeilen bleiben erhalten — nichts geht kaputt).
 *
 * ----------------------------------------------------------------------
 * SCHRITT 1 — Zieltabelle einmalig anlegen (Supabase SQL Editor)
 * ----------------------------------------------------------------------
 * Nur eine CREATE TABLE-Anweisung, keine Datenabfrage — trifft das
 * 100-Zeilen-Anzeigelimit also nicht:
 *
 *   CREATE TABLE IF NOT EXISTS esco_skill_labels_de (
 *     esco_uri TEXT PRIMARY KEY,
 *     label_de TEXT NOT NULL,
 *     updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
 *   );
 *
 * ----------------------------------------------------------------------
 * SCHRITT 2 — Zugangsdaten setzen (NICHT ins Skript eintragen, NICHT
 * committen — als Umgebungsvariablen im Terminal setzen, in derselben
 * Sitzung, in der du das Skript startest)
 * ----------------------------------------------------------------------
 * Beide stehen in Supabase unter Project Settings -> API:
 *
 *   export SUPABASE_URL="https://<dein-project-ref>.supabase.co"
 *   export SUPABASE_SERVICE_ROLE_KEY="<dein service_role Secret>"
 *
 * Der service_role-Key umgeht Row Level Security (wie in der "api"-Edge-
 * Function auch) — deshalb bewusst nur als Umgebungsvariable, nie im Code
 * oder in Git.
 *
 * ----------------------------------------------------------------------
 * SCHRITT 3 — Abhängigkeit installieren (falls noch nicht vorhanden)
 * ----------------------------------------------------------------------
 *   npm install @supabase/supabase-js
 *
 * ----------------------------------------------------------------------
 * SCHRITT 4 — Skript ausführen
 * ----------------------------------------------------------------------
 *   node scripts/esco-sync-german-labels.mjs
 *
 * Läuft bei ~13.900 Skills geschätzt 3-4 Minuten (Batches von 20 URIs,
 * 300ms Pause dazwischen — rücksichtsvoll gegenüber der öffentlichen
 * ESCO-API). Am Ende steht eine Zusammenfassung: wie viele übersetzt,
 * wie viele ohne Treffer (bleiben einfach Englisch, kein Fehler).
 *
 * ----------------------------------------------------------------------
 * SCHRITT 5 — In der "api"-Edge-Function nutzen
 * ----------------------------------------------------------------------
 * Genau wie im alten Skript beschrieben: an der Stelle, wo preferred_label
 * zurückgegeben wird (Skill-Match, Gap-Analyse), sinngemäß ergänzen:
 *
 *   const { data } = await supabase
 *     .from("esco_skill_labels_de")
 *     .select("esco_uri,label_de")
 *     .in("esco_uri", uris);
 *   const deLabels = new Map(data.map(r => [r.esco_uri, r.label_de]));
 *   preferred_label: lang === "de" && deLabels.has(esco_uri)
 *     ? deLabels.get(esco_uri)
 *     : englishLabel, // Fallback: fehlt eine Übersetzung, lieber Englisch
 *                      // zeigen als eine leere/falsche Bezeichnung.
 */

import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error(
    "Fehlt: SUPABASE_URL und/oder SUPABASE_SERVICE_ROLE_KEY als Umgebungsvariable.\n" +
      "Siehe SCHRITT 2 im Kommentar oben — beide stehen in Supabase unter Project Settings -> API."
  );
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

const ESCO_API = "https://ec.europa.eu/esco/api/resource/skill";
const FETCH_BATCH_SIZE = 20; // ESCO-API erlaubt mehrere URIs pro Aufruf, aber nicht beliebig viele
const DELAY_MS_BETWEEN_BATCHES = 300; // rücksichtsvoll gegenüber der öffentlichen API
const DB_PAGE_SIZE = 1000; // Supabase/PostgREST liefert pro Aufruf standardmässig max. 1000 Zeilen
const UPSERT_CHUNK_SIZE = 500;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Liest ALLE esco_uris aus der esco_skills-Tabelle — mit eigener
 * Pagination (.range()), damit auch bei ~13.900 Zeilen nichts abgeschnitten
 * wird (anders als die 100-Zeilen-Anzeige im SQL-Editor-UI, oder das
 * PostgREST-Standardlimit von 1000 Zeilen pro einzelnem Aufruf). */
async function loadAllEscoUris() {
  const uris = [];
  let from = 0;
  for (;;) {
    const to = from + DB_PAGE_SIZE - 1;
    const { data, error } = await supabase.from("esco_skills").select("esco_uri").range(from, to);
    if (error) throw new Error(`esco_skills laden fehlgeschlagen: ${error.message}`);
    if (!data || data.length === 0) break;
    for (const row of data) uris.push(row.esco_uri);
    if (data.length < DB_PAGE_SIZE) break;
    from += DB_PAGE_SIZE;
  }
  return uris;
}

/** Extrahiert die deutsche Bezeichnung defensiv aus mehreren bekannten
 * ESCO-API-Antwortformen — die exakte Struktur konnte in dieser Session
 * nicht live verifiziert werden, siehe Kommentar oben. */
function extractGermanLabel(entry) {
  if (!entry) return null;
  if (typeof entry.title === "string" && entry.title.trim()) return entry.title.trim();
  if (entry.preferredLabel) {
    if (typeof entry.preferredLabel === "string" && entry.preferredLabel.trim()) {
      return entry.preferredLabel.trim();
    }
    if (typeof entry.preferredLabel === "object") {
      const de = entry.preferredLabel.de ?? entry.preferredLabel["de"];
      if (typeof de === "string" && de.trim()) return de.trim();
    }
  }
  if (entry.hasLabel && typeof entry.hasLabel.de === "string") return entry.hasLabel.de.trim();
  return null;
}

async function fetchBatch(uris, logFirstRaw) {
  const url = `${ESCO_API}?uris=${uris.map(encodeURIComponent).join(",")}&language=de`;
  const res = await fetch(url, { headers: { Accept: "application/json" } });
  if (!res.ok) {
    console.error(`  ⚠ HTTP ${res.status} für Batch (${uris.length} URIs) — übersprungen.`);
    return {};
  }
  const body = await res.json();
  if (logFirstRaw) {
    console.log("\n---- Rohantwort der ERSTEN Anfrage (bitte kurz prüfen) ----");
    console.log(JSON.stringify(body, null, 2).slice(0, 3000));
    console.log("---- Ende Rohantwort-Auszug ----\n");
  }
  const embedded = body._embedded ?? body;
  const out = {};
  for (const uri of uris) {
    const entry = embedded[uri] ?? (uris.length === 1 ? body : null);
    const label = extractGermanLabel(entry);
    if (label) out[uri] = label;
  }
  return out;
}

/** Schreibt gesammelte Labels in Chunks in die Datenbank — nicht erst am
 * ganz Ende alles auf einmal, damit bei einem Abbruch mittendrin (Strg+C,
 * Netzwerkfehler) bereits gefundene Übersetzungen nicht verloren gehen. */
async function flushToDatabase(labelsChunk) {
  const rows = Object.entries(labelsChunk).map(([esco_uri, label_de]) => ({ esco_uri, label_de }));
  if (rows.length === 0) return;
  for (let i = 0; i < rows.length; i += UPSERT_CHUNK_SIZE) {
    const slice = rows.slice(i, i + UPSERT_CHUNK_SIZE);
    const { error } = await supabase.from("esco_skill_labels_de").upsert(slice, { onConflict: "esco_uri" });
    if (error) throw new Error(`In Datenbank schreiben fehlgeschlagen: ${error.message}`);
  }
}

async function main() {
  console.log("Lade ESCO-URIs aus eurer Supabase-Datenbank…");
  const uris = await loadAllEscoUris();
  console.log(`${uris.length} ESCO-URIs gefunden, starte Übersetzung in Batches von ${FETCH_BATCH_SIZE}…`);

  let totalFound = 0;
  let first = true;
  const missing = [];

  for (let i = 0; i < uris.length; i += FETCH_BATCH_SIZE) {
    const batch = uris.slice(i, i + FETCH_BATCH_SIZE);
    const batchNum = Math.floor(i / FETCH_BATCH_SIZE) + 1;
    const totalBatches = Math.ceil(uris.length / FETCH_BATCH_SIZE);
    process.stdout.write(`  Batch ${batchNum}/${totalBatches}…\r`);
    try {
      const result = await fetchBatch(batch, first);
      await flushToDatabase(result);
      totalFound += Object.keys(result).length;
      for (const uri of batch) {
        if (!result[uri]) missing.push(uri);
      }
    } catch (err) {
      console.error(`\n  ⚠ Fehler bei Batch ${batchNum}: ${err instanceof Error ? err.message : String(err)} — übersprungen.`);
      missing.push(...batch);
    }
    first = false;
    await sleep(DELAY_MS_BETWEEN_BATCHES);
  }

  console.log(`\n\n✓ ${totalFound} von ${uris.length} URIs übersetzt und in esco_skill_labels_de gespeichert.`);
  if (missing.length > 0) {
    console.log(`  ${missing.length} ohne Treffer (bleiben beim Anzeigen in Englisch), z.B.:`);
    missing.slice(0, 5).forEach((u) => console.log(`    - ${u}`));
  }
}

main().catch((err) => {
  console.error("Abbruch:", err);
  process.exit(1);
});