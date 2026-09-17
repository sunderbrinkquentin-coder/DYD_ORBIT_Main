#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
resolve_target_roles.py
========================

Loest den Entwurf "zielrollen_entwurf.csv" (Klartext-Skillnamen wie "Python",
"SQL") in das echte Format der target_role_skills-Tabelle auf: eine Zeile
pro (role_id, esco_uri, weight). Dafuer wird JEDER Skillname gegen den neuen
Endpunkt

    GET /api/v1/skills/search?q=<Suchbegriff>

deiner eigenen DYD-Skill-Intelligence-API abgeglichen (siehe orbit-api.ts,
Abschnitt "Zielrollen-Verwaltung (NEU)"). Das Skript laeuft bewusst bei DIR:
Basis-URL und API-Key bleiben in deiner Umgebung, niemand sonst bekommt sie
zu sehen.

WARUM SELBST LAUFEN LASSEN (statt dass ich es fuer dich mache):
Um Skillnamen aufzuloesen, braucht es Zugriff auf deine LIVE-Daten (die
esco_skills-Tabelle via die API). Das Skript ruft dafuer deine eigene API
mit deinem eigenen Key auf - dein Key bleibt bei dir.

WAS DAS SKRIPT MACHT (in dieser Reihenfolge):
  1. Liest deine (ggf. bearbeitete) zielrollen_entwurf.csv ein.
  2. Ueberspringt Zeilen, die du in der Spalte "freigabe" explizit abgelehnt
     hast (z.B. "nein", "raus", "ablehnen").
  3. Sammelt alle EINDEUTIGEN Skillnamen (Mehrfachnennungen ueber Rollen
     hinweg werden nur einmal abgefragt - schont Requests).
  4. Ruft fuer jeden Skillnamen GET /api/v1/skills/search auf und waehlt aus
     den Kandidaten den besten Treffer per Scoring (exakter Treffer >
     Teilstring-Treffer > Tippfehler-Aehnlichkeit via difflib). Liegt der
     beste Score unter --min-score, wird der Skill NICHT automatisch
     uebernommen, sondern in einem separaten Report gesammelt.
  5. Vergibt pro Rolle automatisch ein weight (1-3) nach Position in der
     Skill-Liste - die zuerst genannten Skills gelten als wichtiger (siehe
     assign_weights() unten). Passt dir das Gewichtungsschema nicht, kannst
     du die erzeugte CSV vor dem Import frei per Hand anpassen.
  6. Schreibt eine fertige CSV im Format role_id,role_name,esco_uri,weight
     - das ist die Zielform von backend/app/data/target_role_skills.csv
     UND das, was Supabase in der target_role_skills-Tabelle erwartet.
     WICHTIG: Ich kenne den GENAUEN Loader eures alten Python-Backends
     nicht (nur die Supabase-Tabellenform, auf die die Edge Function 1:1
     migriert wurde) - falls der alte Loader andere Spaltennamen/eine
     andere Reihenfolge erwartet, sag mir Bescheid, dann passe ich die
     Ausgabe an.
  7. Schreibt einen zweiten Report (unresolved_skills.csv) mit allen
     Skillnamen, die NICHT sicher genug aufgeloest werden konnten, plus den
     betroffenen Rollen - fuer manuelle Nacharbeit (Skillname umformulieren
     und Skript erneut laufen lassen, oder Treffer von Hand nachtragen).
  8. NUR mit --apply: ruft zusaetzlich POST /api/v1/target-roles fuer jede
     Rolle mit mindestens einem aufgeloesten Skill auf - schreibt also
     direkt in Supabase. OHNE --apply (Standard) passiert das NICHT, es
     wird nur lokal geschrieben (Dry-Run) - so kannst du das Ergebnis erst
     pruefen, bevor irgendetwas live aendert.

VERWENDUNG:
    # Zutaten: deine API-Basis-Adresse + ein Key mit Produkt "admin" oder "all"
    export DYD_API_BASE_URL="https://DEIN-PROJECT-REF.supabase.co/functions/v1/api"
    export DYD_API_KEY="dein-admin-key"

    # 1) Erst als Dry-Run - schreibt nur lokale Dateien, aendert nichts live:
    python3 resolve_target_roles.py --input zielrollen_entwurf.csv

    # 2) Ergebnis pruefen (target_role_skills_resolved.csv + unresolved_skills.csv),
    #    ggf. Skillnamen in der Entwurfs-CSV anpassen und Schritt 1 wiederholen.

    # 3) Wenn alles passt: tatsaechlich in Supabase anlegen:
    python3 resolve_target_roles.py --input zielrollen_entwurf.csv --apply

Keine Abhaengigkeiten ausserhalb der Python-Standardbibliothek noetig.
"""

import argparse
import csv
import difflib
import json
import sys
import urllib.error
import urllib.parse
import urllib.request
from collections import defaultdict

REJECTED_VALUES = {"nein", "n", "no", "raus", "ablehnen", "entfernen", "streichen"}


def score_match(query: str, label: str) -> float:
    """Bewertet (0-100), wie gut ein Kandidat aus /skills/search zur Anfrage
    passt. Gleiche Grundidee wie roleMatchScore() im Frontend (JourneyPage.tsx):
    exakter Treffer zuerst, dann Teilstring, dann Tippfehler-Toleranz ueber
    eine String-Aehnlichkeit (hier via difflib statt einer eigenen
    Levenshtein-Implementierung, weil das schon in der Python-Standard-
    bibliothek steckt)."""
    q = query.strip().lower()
    n = label.strip().lower()
    if not q:
        return 0.0
    if n == q:
        return 100.0
    if q in n or n in q:
        return 90.0
    return difflib.SequenceMatcher(None, q, n).ratio() * 100.0


def api_get(base_url: str, api_key: str, path: str, params: dict) -> dict:
    query = urllib.parse.urlencode(params)
    url = f"{base_url.rstrip('/')}{path}?{query}"
    req = urllib.request.Request(url, headers={"X-API-Key": api_key})
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        detail = e.read().decode("utf-8", errors="replace")
        raise SystemExit(f"GET {path} fehlgeschlagen ({e.code}): {detail}")


def api_post(base_url: str, api_key: str, path: str, body: dict) -> dict:
    url = f"{base_url.rstrip('/')}{path}"
    data = json.dumps(body).encode("utf-8")
    req = urllib.request.Request(
        url,
        data=data,
        method="POST",
        headers={"X-API-Key": api_key, "Content-Type": "application/json"},
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            raw = resp.read().decode("utf-8")
            return json.loads(raw) if raw else {}
    except urllib.error.HTTPError as e:
        detail = e.read().decode("utf-8", errors="replace")
        raise SystemExit(f"POST {path} fehlgeschlagen ({e.code}): {detail}")


def resolve_skill(base_url: str, api_key: str, skill_name: str, min_score: float, cache: dict):
    """Loest EINEN Skillnamen auf, mit Cache (dieselbe Bezeichnung taucht in
    vielen Rollen auf - nicht mehrfach dieselbe Anfrage schicken)."""
    if skill_name in cache:
        return cache[skill_name]

    result = api_get(base_url, api_key, "/api/v1/skills/search", {"q": skill_name, "max_results": 25})
    candidates = result.get("results", [])
    best = None
    best_score = -1.0
    for c in candidates:
        # matched_on ist das Label (preferred_label ODER ein alt_label), das
        # den Treffer in der API ausgeloest hat - dagegen bewerten wir, nicht
        # blind gegen preferred_label. Sonst wuerde z.B. "SQL" -> Skill mit
        # preferred_label "Grundlagen der Abfragesprache SQL" (Treffer kam
        # aber ueber das kurze alt_label "SQL") faelschlich niedrig bewertet.
        label_to_score_against = c.get("matched_on") or c.get("preferred_label", "")
        s = score_match(skill_name, label_to_score_against)
        if s > best_score:
            best_score = s
            best = c

    if best is None or best_score < min_score:
        cache[skill_name] = None
        return None

    resolved = {"esco_uri": best["esco_uri"], "preferred_label": best["preferred_label"], "score": round(best_score, 1)}
    cache[skill_name] = resolved
    return resolved


def assign_weights(skill_count: int):
    """Vergibt automatisch ein weight (1-3) je nach Position in der
    Skill-Liste einer Rolle: die ersten paar Skills gelten als 'weight 3'
    (Kern-Skill), die mittleren als 'weight 2', der Rest als 'weight 1'.
    Reine Standardannahme, weil die Entwurfs-CSV keine expliziten Gewichte
    pro Skill hat - nach dem Import in der Zieltabelle jederzeit von Hand
    anpassbar."""
    third = max(1, round(skill_count / 3))
    weights = []
    for i in range(skill_count):
        if i < third:
            weights.append(3)
        elif i < 2 * third:
            weights.append(2)
        else:
            weights.append(1)
    return weights


def main():
    parser = argparse.ArgumentParser(description="Loest Zielrollen-CSV (Klartext-Skills) in target_role_skills auf.")
    parser.add_argument("--input", default="zielrollen_entwurf.csv", help="Pfad zur (geprueften) Entwurfs-CSV.")
    parser.add_argument("--output-csv", default="target_role_skills_resolved.csv",
                         help="Wohin die fertige role_id,role_name,esco_uri,weight-CSV geschrieben wird.")
    parser.add_argument("--unresolved-csv", default="unresolved_skills.csv",
                         help="Report mit Skillnamen, die nicht sicher genug aufgeloest werden konnten.")
    parser.add_argument("--min-score", type=float, default=60.0,
                         help="Mindest-Score (0-100), ab dem ein Suchtreffer automatisch uebernommen wird. Default 60, wie beim Skill-Matching im Backend.")
    parser.add_argument("--apply", action="store_true",
                         help="Zusaetzlich POST /api/v1/target-roles fuer jede Rolle aufrufen (schreibt live in Supabase). Ohne dieses Flag: reiner Dry-Run, nur lokale Dateien.")
    parser.add_argument("--base-url", default=None, help="API-Basis-Adresse. Alternativ Env-Var DYD_API_BASE_URL.")
    parser.add_argument("--api-key", default=None, help="API-Key (Produkt 'admin' oder 'all'). Alternativ Env-Var DYD_API_KEY.")
    args = parser.parse_args()

    import os
    base_url = args.base_url or os.environ.get("DYD_API_BASE_URL")
    api_key = args.api_key or os.environ.get("DYD_API_KEY")
    if not base_url or not api_key:
        sys.exit(
            "Fehlt: --base-url/--api-key oder die Env-Vars DYD_API_BASE_URL/DYD_API_KEY.\n"
            "Beispiel:\n"
            '  export DYD_API_BASE_URL="https://DEIN-PROJECT-REF.supabase.co/functions/v1/api"\n'
            '  export DYD_API_KEY="dein-admin-key"\n'
        )

    with open(args.input, encoding="utf-8-sig") as f:
        rows = list(csv.DictReader(f))

    accepted_rows = []
    skipped = 0
    for row in rows:
        freigabe = (row.get("freigabe") or "").strip().lower()
        if freigabe in REJECTED_VALUES:
            skipped += 1
            continue
        accepted_rows.append(row)

    print(f"Eingelesen: {len(rows)} Rollen, davon {skipped} in 'freigabe' abgelehnt -> {len(accepted_rows)} werden verarbeitet.")

    skill_cache = {}
    unresolved = defaultdict(list)  # skill_name -> [role_id, ...]
    resolved_rows = []  # role_id, role_name, esco_uri, weight
    role_skill_counts = {}
    roles_with_zero_resolved = []

    for row in accepted_rows:
        role_id = row["role_id"].strip()
        role_name = row["rollenname"].strip()
        skill_names = [s.strip() for s in row["kern_skills"].split(";") if s.strip()]
        weights = assign_weights(len(skill_names))

        resolved_count = 0
        for skill_name, weight in zip(skill_names, weights):
            resolved = resolve_skill(base_url, api_key, skill_name, args.min_score, skill_cache)
            if resolved is None:
                unresolved[skill_name].append(role_id)
                continue
            resolved_rows.append({
                "role_id": role_id,
                "role_name": role_name,
                "esco_uri": resolved["esco_uri"],
                "weight": weight,
            })
            resolved_count += 1

        role_skill_counts[role_id] = resolved_count
        if resolved_count == 0:
            roles_with_zero_resolved.append(role_id)

    with open(args.output_csv, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=["role_id", "role_name", "esco_uri", "weight"])
        writer.writeheader()
        writer.writerows(resolved_rows)

    with open(args.unresolved_csv, "w", newline="", encoding="utf-8") as f:
        writer = csv.writer(f)
        writer.writerow(["skill_name", "betroffene_role_ids"])
        for skill_name, role_ids in sorted(unresolved.items()):
            writer.writerow([skill_name, "; ".join(sorted(set(role_ids)))])

    print(f"\nFertig: {len(resolved_rows)} Skill-Zeilen aufgeloest -> {args.output_csv}")
    print(f"Nicht sicher genug aufgeloest: {len(unresolved)} eindeutige Skillnamen -> {args.unresolved_csv}")
    if roles_with_zero_resolved:
        print(f"ACHTUNG: {len(roles_with_zero_resolved)} Rolle(n) haben KEINEN aufgeloesten Skill "
              f"(werden beim Import uebersprungen, das Backend verlangt mindestens einen Skill pro Rolle):")
        for rid in roles_with_zero_resolved:
            print(f"  - {rid}")

    if not args.apply:
        print("\nDry-Run (kein --apply) - es wurde NICHTS live in Supabase geschrieben.")
        print(f"Naechster Schritt: {args.output_csv} und {args.unresolved_csv} pruefen, dann ggf. mit --apply erneut laufen lassen.")
        return

    print("\n--apply gesetzt: schreibe jetzt live nach Supabase (POST /api/v1/target-roles) ...")
    by_role = defaultdict(list)
    role_names = {}
    for r in resolved_rows:
        by_role[r["role_id"]].append({"esco_uri": r["esco_uri"], "weight": r["weight"]})
        role_names[r["role_id"]] = r["role_name"]

    ok, failed = 0, 0
    for role_id, skills in by_role.items():
        try:
            api_post(base_url, api_key, "/api/v1/target-roles", {
                "role_id": role_id,
                "role_name": role_names[role_id],
                "skills": skills,
            })
            ok += 1
            print(f"  OK: {role_id} ({len(skills)} Skills)")
        except SystemExit as e:
            failed += 1
            print(f"  FEHLER: {role_id}: {e}")

    print(f"\nFertig: {ok} Rollen angelegt/aktualisiert, {failed} fehlgeschlagen.")


if __name__ == "__main__":
    main()