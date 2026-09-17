# DYD Skill Intelligence API — Scaffold (NEXUS + ORBIT)

Eine eigenstaendige, mandantenfaehige REST-API fuer Skill-Extraktion, ESCO-Matching
und Gap-Berechnung — als **gemeinsame Engine fuer beide Produkte**, DYD NEXUS
(Workforce Skill Intelligence fuer Unternehmen) und DYD ORBIT (Lead Intelligence fuer
Bildungstraeger). Getrennt von jedem Frontend (auch getrennt von der bisherigen
Bolt-Website).

**Wichtig:** Dies ist ein Scaffold mit einer kuratierten Teilmenge (~32) der ECHTEN
ESCO-Taxonomie (echte offizielle URIs, aus dem oeffentlichen Mirror
[tabiya-open-dataset](https://github.com/tabiya-tech/tabiya-open-dataset), da der
offizielle ESCO-Bulk-Download eine manuelle E-Mail-Verifizierung erfordert). Die
deutschen Skill-Bezeichnungen sind eine manuelle Uebersetzung, KEINE offiziell von
ESCO verifizierte deutsche Uebersetzung - siehe Hinweis in `app/services/esco_loader.py`.
4 Beispiel-Zielrollen, ein Beispiel-Kurskatalog und ein Beispiel-Lernmodul-Katalog
kommen dazu. Kein Produktivsystem. Ziel ist ein lauffaehiger, testbarer Ausgangspunkt,
den du in VS Code oeffnen und ab hier weiterentwickeln kannst. Was als Naechstes
ansteht: siehe "Roadmap ab hier".

## Ein Kern, zwei Produkte

```
                     ┌─────────────────────────────┐
                     │   Gemeinsamer Kern (Engine)  │
                     │  /api/v1/skill-match          │
                     │  /api/v1/gap-analysis          │
                     │  /api/v1/target-roles           │
                     └──────────────┬──────────────────┘
                                    │
                ┌───────────────────┴───────────────────┐
                │                                        │
   ┌────────────▼─────────────┐          ┌───────────────▼────────────┐
   │  NEXUS (Unternehmen)     │          │  ORBIT (Bildungstraeger)    │
   │  /api/v1/nexus/...        │          │  /api/v1/orbit/...          │
   │  - skill-matrix (Team)     │          │  - course-match (Kursvorschlag) │
   │  - learning-path (intern)   │          │  - leads (Schritt 6: Lead anlegen) │
   │                              │          │  - reports (Dashboard-Kennzahlen)   │
   └────────────────────────────┘          └────────────────────────────────┘
```

Jeder API-Key ist einem Tenant zugeordnet UND auf bestimmte Produkte lizenziert
(`nexus`, `orbit`, oder `all`). Ein Whitelabel-Bildungstraeger bekommt z.B. nur Zugriff
auf die ORBIT-Endpunkte, ein Unternehmenskunde nur auf NEXUS — das ist die technische
Grundlage fuer unterschiedliche Lizenzmodelle pro Zielgruppe. Siehe `app/auth.py`
(`require_product(...)`).

## Zwei Oberflaechen-Vorschauen (nicht Teil der API, nur lokale Demo-Frontends)

Zwei eigenstaendige, selbst-enthaltene HTML-Dateien im Projekt-Root demonstrieren, wie
die API von echten Oberflaechen genutzt werden koennte (beide sprechen live mit dem
lokal laufenden Server, kein Build-Schritt noetig — einfach im Browser oeffnen):

- **`orbit-dashboard-preview.html`** — die Bildungstraeger-Seite: Dashboard mit Leads,
  Reports, Lead-Erstellungsformular. Im DYD-CI gestaltet (DYD als Hauptmarke, ORBIT als
  Produkt-Modul darunter, Platzhalter fuer das Logo des jeweiligen Bildungstraeger-Tenants
  — "Ingredient Branding").
- **`orbit-user-journey.html`** — die Endnutzer-Seite: ein 5-Schritte-Assistent
  (Zielrolle -> Skills angeben -> Skill-Gap -> Kurs -> Anfrage), der exakt den
  Skill-Matching-Prozess von der Landingpage nachbildet und am Ende einen echten Lead
  per `POST /api/v1/orbit/leads` anlegt. Simuliert, wie das eingebettet auf der Seite
  eines Bildungstraegers aussehen koennte (inkl. "Powered by DYD ORBIT"-Badge als
  Ingredient-Branding-Beispiel). Beim Schritt "Skills angeben" kann die Person zwischen
  zwei Methoden waehlen:
  - **Freitext / Lebenslauf-Upload** — entweder ein paar Saetze eintippen oder direkt
    eine PDF/Word/TXT-Datei hochladen; der Text wird ueber
    `POST /api/v1/documents/extract-text` ausgelesen und automatisch ins Textfeld
    uebernommen.
  - **Fragebogen** — zeigt die vollstaendige Skill-Liste der gewaehlten Zielrolle als
    ankreuzbare Liste (technisch ueber einen `gap-analysis`-Aufruf mit leerem Text, der
    dadurch alle Rollen-Skills als `gap_skills` zurueckgibt — keine neue Route noetig)
    und baut daraus automatisch einen Profiltext.

  Beide Methoden fuettern danach dieselbe Gap-Analyse-/Kursempfehlungs-Pipeline ("eine
  Engine, viele Wege rein"). Der Kurs-Schritt zeigt zusaetzlich einen kurzen Pitch-Text
  und einen staerker hervorgehobenen CTA-Button.

Ein in `orbit-user-journey.html` abgeschlossener Prozess erzeugt einen Lead, der sofort
in `orbit-dashboard-preview.html` sichtbar ist (beide nutzen denselben API-Key/Tenant) —
das zeigt den kompletten Kreislauf von "Nutzer stellt Anfrage" bis "Bildungstraeger sieht
qualifizierten Lead".

## Setup in VS Code

Voraussetzung: Python 3.11+ ist installiert (`python3 --version` im Terminal pruefen).

1. Ordner in VS Code oeffnen (`File > Open Folder...` -> diesen Ordner waehlen).
2. Terminal in VS Code oeffnen (`Terminal > New Terminal`) und virtuelle Umgebung anlegen:

   ```bash
   python3 -m venv .venv
   source .venv/bin/activate        # Windows: .venv\Scripts\activate
   ```

3. Abhaengigkeiten installieren:

   ```bash
   pip install -r requirements.txt
   ```

4. `.env.example` zu `.env` kopieren (Demo-API-Keys sind schon vorbelegt, fuer den Start
   musst du nichts aendern):

   ```bash
   cp .env.example .env
   ```

5. Server starten:

   ```bash
   uvicorn app.main:app --reload
   ```

   Beim ersten Start wird automatisch eine lokale SQLite-Datei `dyd_skill_api.db`
   angelegt und mit den Demo-Kurskatalogen befuellt (siehe Abschnitt "Datenbank &
   Migrationen" unten) — kein separater Setup-Schritt noetig.

6. Im Browser oeffnen: http://127.0.0.1:8000/docs — automatisch generierte, interaktive
   API-Doku (Swagger UI), aufgeteilt nach Tags "skill-match"/"gap-analysis" (gemeinsam),
   "nexus" und "orbit". Genau das brauchst du spaeter als Doku fuer API-Kunden.

### VS Code Tipp
Installiere die Extension "Python" (Microsoft) fuer Autocomplete, Debugging (F5) und
Test-Runner-Integration. Der `.venv`-Ordner wird von VS Code automatisch als
Interpreter vorgeschlagen (unten rechts bestaetigen).

## Demo-API-Keys (aus `.env.example`)

| Key                  | Tenant           | Zugriff auf         |
|-----------------------|-------------------|-----------------------|
| `demo-key-nexus`       | DYD NEXUS Demo     | nur `nexus`             |
| `demo-key-orbit`        | DYD ORBIT Demo       | nur `orbit`               |
| `demo-key-partnerA`      | Beispiel Bildungstraeger | nur `orbit` (Whitelabel-Beispiel) |
| `demo-key-all`             | DYD Internal          | `nexus` + `orbit`           |

## Datenbank & Migrationen

Leads und Kurskataloge liegen jetzt in einer echten Datenbank (SQLAlchemy), nicht mehr
nur im Arbeitsspeicher — sie ueberleben also einen Server-Neustart. Standardmaessig
zeigt `DATABASE_URL` (siehe `app/config.py`) auf eine lokale SQLite-Datei
(`sqlite:///./dyd_skill_api.db`), die automatisch angelegt wird — kein separates
Datenbank-Setup fuer die lokale Entwicklung noetig.

Fuer Produktion in `.env` auf Postgres umstellen, z.B.:
```
DATABASE_URL=postgresql+psycopg2://user:pass@host:5432/dbname
```

**Tabellen anlegen:** `app/main.py` ruft beim Start automatisch
`Base.metadata.create_all(...)` auf — das reicht fuer die lokale Entwicklung, die
Tabellen existieren garantiert, bevor der erste Request reinkommt.

**Alembic (fuer echte Migrationen, z.B. bei Schema-Aenderungen in Produktion):**
```bash
alembic upgrade head          # aktuelles Schema anwenden
alembic revision --autogenerate -m "beschreibung der aenderung"   # neue Migration erzeugen
```
Alembic liest dieselbe `DATABASE_URL` aus `.env` wie die App selbst (siehe
`migrations/env.py`) — keine doppelt gepflegte Konfiguration.

**Demo-Kurskataloge:** Beim ersten Start werden zwei Demo-Bildungstraeger automatisch
mit UNTERSCHIEDLICHEN Kurskatalogen befuellt (`app/db/seed.py`), damit man live sehen
kann, dass jeder Tenant wirklich nur seine eigenen Kurse angezeigt bekommt:
- `tenant_orbit` (Key `demo-key-orbit`) — der groessere Katalog aus `courses.csv`
- `tenant_partnerA` (Key `demo-key-partnerA`) — ein kleinerer, komplett anderer Katalog

Das Seeding ist idempotent: ein Tenant wird nur befuellt, wenn er noch GAR KEINE eigenen
Kurse hat, ueberschreibt also nie echte, ueber die API angelegte Daten.

**Eigenen Kurskatalog verwalten (Self-Service, pro Tenant isoliert):**
```bash
# Kurs anlegen/aktualisieren (Upsert nach course_id)
curl -X POST http://127.0.0.1:8000/api/v1/orbit/courses \
  -H "Content-Type: application/json" \
  -H "X-API-Key: demo-key-orbit" \
  -d '{
    "course_id": "mein-kurs-1",
    "course_name": "Excel Aufbaukurs",
    "provider": "Mein Bildungstraeger",
    "duration_weeks": 4,
    "covered_skill_uris": ["http://data.europa.eu/esco/skill/2b92a5b2-6758-4ee3-9fb4-b6387a55cc8f"]
  }'

# Eigenen Katalog auflisten
curl http://127.0.0.1:8000/api/v1/orbit/courses -H "X-API-Key: demo-key-orbit"

# Kurs loeschen
curl -X DELETE http://127.0.0.1:8000/api/v1/orbit/courses/mein-kurs-1 -H "X-API-Key: demo-key-orbit"
```
Ein Tenant sieht und verwaltet ausschliesslich seine eigenen Kurse — weder in der
Katalogverwaltung noch in den Kursempfehlungen aus `/course-match` sind Kurse eines
anderen Tenants sichtbar (siehe `tests/test_orbit_courses.py`).

## Deployment (Render) — damit Bolt die echte API erreicht

Bolt fuehrt das React-Frontend in einer eigenen Cloud-Sandbox im Browser aus (nicht auf
deinem PC) — es kann deshalb `http://127.0.0.1:8000` (dein lokaler Server) nicht
erreichen. Damit der komplette Prozess auch INNERHALB von Bolt live durchlaeuft, braucht
das Backend eine oeffentliche Adresse im Internet. `render.yaml` (im Projekt-Root) ist
dafuer vorbereitet — ein sogenanntes Render-"Blueprint", das Web-Service + Datenbank in
einem Schritt anlegt.

**Einmalig einrichten (im Browser, keine IDE noetig):**
1. Sicherstellen, dass `render.yaml` in deinem Backend-Repo auf GitHub liegt (Upload
   ueber "Add file -> Upload files" auf github.com, falls noch nicht geschehen).
2. Auf [render.com](https://render.com) registrieren (kostenlos, z.B. mit GitHub-Login).
3. "New +" -> "Blueprint" -> dein Backend-Repo auswaehlen. Render erkennt `render.yaml`
   automatisch und zeigt Web-Service + Datenbank zur Bestaetigung an -> "Apply".
4. Nach ein paar Minuten Build-Zeit ist die API unter `https://<dein-servicename>.onrender.com`
   erreichbar. Kurzer Test im Browser: `https://<dein-servicename>.onrender.com/health`
   sollte `{"status":"ok"}` zeigen.

**Demo-Daten auf dem deployten Server anlegen:** einmalig lokal (reicht ein einfaches
Terminal, keine IDE noetig):
```
set DYD_BASE_URL=https://<dein-servicename>.onrender.com
python scripts/seed_demo_leads.py
```
(macOS/Linux: `export DYD_BASE_URL=...` statt `set ...`)

**Im Bolt-Frontend verbinden:** im Feld "API-Adresse" (Dashboard- und Journey-Seite)
statt `http://127.0.0.1:8000` die neue `https://...onrender.com`-Adresse eintragen —
danach laeuft der komplette Prozess (Journey -> Lead -> Dashboard) direkt in Bolt, ohne
lokal laufenden Server.

**Wichtig fuer die Demo:** der kostenlose Render-Plan "schlaeft" nach ca. 15 Minuten
Inaktivitaet ein und braucht beim naechsten Aufruf ~30-60 Sekunden zum Aufwachen — vor
einer Live-Demo kurz vorher einmal die `/health`-Adresse aufrufen, damit der Server schon
wach ist. Die im Blueprint verwendeten Demo-API-Keys sind bewusst dieselben wie lokal
(siehe oben) — fuer einen echten Kunden-Pilot vorher durch gehashte, produktionstaugliche
Keys ersetzen (siehe Roadmap, Punkt "Auth haerten").

## Beispiel-Requests

Alle Endpunkte (ausser `/health`) brauchen den Header `X-API-Key`.

**Skill-Matching (gemeinsam):**
```bash
curl -X POST http://127.0.0.1:8000/api/v1/skill-match \
  -H "Content-Type: application/json" \
  -H "X-API-Key: demo-key-all" \
  -d '{"text": "5 Jahre Erfahrung mit SQL, Excel und Power BI."}'
```

**Gap-Analyse gegen eine Zielrolle (gemeinsam, verfuegbare Rollen: `GET /api/v1/target-roles`):**
```bash
curl -X POST http://127.0.0.1:8000/api/v1/gap-analysis \
  -H "Content-Type: application/json" \
  -H "X-API-Key: demo-key-all" \
  -d '{"text": "Marketing-Managerin mit Excel- und Power-BI-Kenntnissen.", "target_role_id": "data-analyst"}'
```

**ORBIT — Kurs-Empfehlung fuer einen Lead:**
```bash
curl -X POST http://127.0.0.1:8000/api/v1/orbit/course-match \
  -H "Content-Type: application/json" \
  -H "X-API-Key: demo-key-orbit" \
  -d '{"text": "Marketing-Managerin mit Excel- und Power-BI-Kenntnissen.", "target_role_id": "data-analyst"}'
```

**NEXUS — Abteilungs-Skill-Matrix (mehrere Mitarbeiterprofile auf einmal):**
```bash
curl -X POST http://127.0.0.1:8000/api/v1/nexus/skill-matrix \
  -H "Content-Type: application/json" \
  -H "X-API-Key: demo-key-nexus" \
  -d '{
    "profiles": [
      {"employee_id": "e1", "text": "Marketing-Managerin mit Excel- und Power-BI-Kenntnissen."},
      {"employee_id": "e2", "text": "SQL, Excel, Statistik"}
    ],
    "target_role_id": "data-analyst"
  }'
```

**NEXUS — Lernpfad fuer einen einzelnen Mitarbeiter:**
```bash
curl -X POST http://127.0.0.1:8000/api/v1/nexus/learning-path \
  -H "Content-Type: application/json" \
  -H "X-API-Key: demo-key-nexus" \
  -d '{"text": "Marketing-Managerin mit Excel- und Power-BI-Kenntnissen.", "target_role_id": "data-analyst"}'
```

**ORBIT — Lead anlegen (Schritt 6: aus Profil + Zielrolle einen qualifizierten Lead machen,
inkl. bester Kursempfehlung und projiziertem Match-Score nach Kursabschluss):**
```bash
curl -X POST http://127.0.0.1:8000/api/v1/orbit/leads \
  -H "Content-Type: application/json" \
  -H "X-API-Key: demo-key-orbit" \
  -d '{
    "text": "Erfahrene Marketing-Managerin mit SQL-, Excel- und Statistik-Kenntnissen.",
    "target_role_id": "data-analyst",
    "lead_name": "M. Becker"
  }'
```
Optional: `qualification_threshold` (Default `80.0`) — ab welchem projizierten Match-Score
(in Prozent, NACH dem empfohlenen Kurs) ein Lead als `qualified: true` gilt.

**Dokument-Text-Extraktion (gemeinsam — Lebenslauf-Upload fuer die ORBIT-User-Journey,
liefert NUR reinen Text zurueck, kein eigener Skill-Match; der Text geht danach durch
dieselbe `/api/v1/skill-match`- bzw. `/api/v1/gap-analysis`-Pipeline wie Freitext):**
```bash
curl -X POST http://127.0.0.1:8000/api/v1/documents/extract-text \
  -H "X-API-Key: demo-key-orbit" \
  -F "file=@/pfad/zu/lebenslauf.pdf"
```
Unterstuetzt: `.pdf`, `.docx`, `.txt` (max. 10 MB). Liefert `400`, wenn der Dateityp nicht
unterstuetzt wird oder das PDF keine Text-Ebene hat (z.B. ein eingescanntes Bild ohne OCR).

**ORBIT — Eigene Leads auflisten:**
```bash
curl http://127.0.0.1:8000/api/v1/orbit/leads -H "X-API-Key: demo-key-orbit"
```

**ORBIT — Dashboard-Kennzahlen (entspricht den Kacheln "Neue Leads" / "Ø Match-Score" auf
der Landingpage, plus die am haeufigsten empfohlenen Kurse, die groessten Skill-Gaps und die
Conversion-Rate):**
```bash
curl http://127.0.0.1:8000/api/v1/orbit/reports -H "X-API-Key: demo-key-orbit"
```
Liefert u.a.:
- `conversion_rate` — Anteil der Leads (in %), die nach Abschluss des empfohlenen Kurses den
  Qualifizierungs-Schwellenwert erreichen wuerden (`qualified_leads / total_leads`). Das ist
  die aus den Lead-Daten tatsaechlich ableitbare "Conversion" — nicht zu verwechseln mit einer
  Ad-/Marketing-Conversion (dafuer fehlen externe Kampagnendaten).
- `top_skill_gaps` — die Skills, die den Leads dieses Tenants am haeufigsten fehlen
  (`skill_name`, `lead_count`, `percentage`), absteigend sortiert, max. 10 Eintraege. Zeigt dem
  Bildungstraeger, wofuer sich ein neuer oder ausgebauter Kurs am ehesten lohnt.
- `top_courses` — wie bisher die am haeufigsten empfohlenen Kurse.

Hinweis: `CPA` / `Akquisekosten` stehen NICHT im Report, weil dafuer reale
Marketing-Kostendaten (z.B. aus einem Ad-Konto) noetig sind, die die Skill-Matching-Engine
selbst nicht kennt — siehe Kommentar in `app/services/orbit/reports_service.py`.

Testweise mit dem falschen Produkt-Key (z.B. `demo-key-orbit` auf einem NEXUS-Endpunkt)
antwortet die API mit `403 Forbidden` — das demonstriert die Produkt-Lizenzierung.

## Tests ausfuehren

```bash
pytest
```

29 Tests, decken beide Produkte ab: Skill-Matching, Gap-Analyse, Kurs-Matching, Lead-Erstellung
(inkl. optionalem Kontakt-E-Mail-Feld) + Dashboard-Reports (ORBIT, inkl. Conversion-Rate und
groesster Skill-Gaps), Skill-Matrix + Lernpfad (NEXUS), Dokument-Textextraktion fuer
Lebenslauf-Uploads (PDF/DOCX/TXT, inkl. Fehlerfaellen wie eingescannte PDFs ohne Text-Ebene
oder nicht unterstuetzte Dateitypen), die produktbasierte Zugriffskontrolle (403-Faelle),
sowie den Self-Service-Kurskatalog inklusive der Tenant-Isolation (`test_orbit_courses.py`) —
der Beweis, dass zwei Bildungstraeger sich unter keinen Umstaenden gegenseitig Kurse sehen
koennen, weder in der Katalogverwaltung noch in den Kursempfehlungen. Nutzt eine eigene,
isolierte SQLite-Testdatenbank (siehe `tests/conftest.py`), voellig getrennt von deiner
lokalen `dyd_skill_api.db`.

## Projektstruktur

```
app/
  main.py                      # FastAPI-App, bindet alle Router ein, legt Tabellen an + seeded Demo-Kurse
  config.py                     # Settings aus .env (inkl. DATABASE_URL, Produkt-Lizenzierung pro Key)
  auth.py                        # API-Key -> Tenant + Produkt-Berechtigung (require_product)
  db/
    session.py                    # SQLAlchemy Engine/Session, get_db()-Dependency
    models.py                       # ORM-Modelle: Course, Lead
    seed.py                           # idempotentes Seeding der Demo-Kurskataloge (2 Tenants)
  data/
    esco_skills.csv                # Echte ESCO-URIs (Teilmenge), deutsche Labels manuell uebersetzt
    target_roles.csv              # Beispiel-Zielrollen mit benoetigten Skills
    orbit/
      courses.csv                   # Beispiel-Kurskatalog (ORBIT)
    nexus/
      learning_modules.csv          # Beispiel-Lernmodul-Katalog (NEXUS)
  services/
    esco_loader.py                # laedt ESCO- + Zielrollen-CSV
    skill_matcher.py                # Fuzzy-Matching Text -> ESCO-Skills (gemeinsam)
    gap_analysis.py                  # Profil-Skills vs. Zielrollen-Skills (gemeinsam)
    document_extractor.py              # PDF/DOCX/TXT -> reiner Text (gemeinsam, Lebenslauf-Upload)
    orbit/
      catalog_loader.py               # laedt Kurskatalog pro Tenant aus der DB
      course_matcher.py                 # Gap -> passende Kurse (tenant-scoped)
      course_catalog_service.py           # Self-Service-CRUD (Upsert/List/Delete) fuer eigenen Kurskatalog
      lead_store.py                       # Lead-Persistenz in der DB (tenant-scoped)
      lead_service.py                       # Gap + Kurs -> projizierter Match-Score, Qualifizierung
      reports_service.py                      # Leads -> Dashboard-Kennzahlen (Neue Leads, Match-Score, Top-Kurse)
    nexus/
      catalog_loader.py               # laedt Lernmodul-Katalog
      skill_matrix.py                   # aggregiert Gaps ueber mehrere Mitarbeiterprofile
      learning_path.py                  # Gap -> passende interne Lernmodule
  routers/
    health.py                     # GET /health
    skill_match.py                  # POST /api/v1/skill-match (gemeinsam)
    gap_analysis.py                   # GET /api/v1/target-roles, POST /api/v1/gap-analysis (gemeinsam)
    documents.py                        # POST /api/v1/documents/extract-text (gemeinsam, Lebenslauf-Upload)
    orbit/
      course_match.py                   # POST /api/v1/orbit/course-match
      leads.py                            # POST/GET /api/v1/orbit/leads (Schritt 6)
      reports.py                            # GET /api/v1/orbit/reports (Dashboard-Kennzahlen)
      courses.py                              # POST/GET/DELETE /api/v1/orbit/courses (eigener Kurskatalog)
    nexus/
      skill_matrix.py                     # POST /api/v1/nexus/skill-matrix
      learning_path.py                      # POST /api/v1/nexus/learning-path
  models/
    schemas.py                        # Pydantic-Modelle fuer den gemeinsamen Kern
    orbit_schemas.py                    # Pydantic-Modelle fuer ORBIT
    nexus_schemas.py                      # Pydantic-Modelle fuer NEXUS
tests/                                     # pytest-Tests fuer Kern + beide Produkte
migrations/                                  # Alembic-Migrationen (siehe "Datenbank & Migrationen")
```

## Roadmap ab hier

Gemeinsamer Kern steht, produktspezifische Endpunkte fuer NEXUS und ORBIT sind angelegt,
ein Teil der Skills nutzt echte ESCO-URIs statt frei erfundener Platzhalter, und ORBIT hat
den kompletten Prozess von der Landingpage abgebildet — inklusive Schritt 6 ("Lead
qualifiziert uebergeben", Endpunkt `POST /api/v1/orbit/leads`) und den
Dashboard-Kennzahlen (`GET /api/v1/orbit/reports`).

**Persistenz-Fundament ist erledigt** (frueher Punkt 5 unten): Leads UND Kurskataloge
liegen jetzt in einer echten Datenbank (SQLAlchemy + Alembic, siehe "Datenbank &
Migrationen" oben) statt im Arbeitsspeicher — live getestet, dass Leads einen
Server-Neustart ueberleben. Jeder Bildungstraeger-Tenant hat jetzt zusaetzlich seinen
**eigenen, isolierten Kurskatalog** mit Self-Service-CRUD
(`POST/GET/DELETE /api/v1/orbit/courses`) statt eines gemeinsamen Demo-Katalogs — live
und per Test bewiesen (`tests/test_orbit_courses.py`), dass ein Tenant niemals Kurse
eines anderen sieht, weder in der Verwaltung noch in den Kursempfehlungen. Das war die
zentrale Luecke, um das Produkt echten Bildungstraegern zu verkaufen: jeder Kunde zeigt
ausschliesslich seine eigenen Kurse.

Sinnvolle naechste Schritte, in etwa dieser Reihenfolge:

1. **Mit ORBIT pilotieren**: `leads`-Endpunkt mit einem echten Bildungstraeger-Kontakt
   (z.B. Hochschule Fresenius) an echten Profilen testen, bevor mehr Infrastruktur
   gebaut wird.
2. **ESCO-Daten vervollstaendigen**: (a) vollstaendigen ESCO-Datensatz statt nur ~32
   kuratierter Skills laden (das echte offizielle CSV-Bulk-Package von
   esco.ec.europa.eu, mit E-Mail-Verifizierung), und/oder (b) offiziell verifizierte
   deutsche Labels einspielen statt der aktuellen manuellen Uebersetzung. Danach
   `esco_loader.py` von CSV auf eine Datenbank (Postgres) umstellen.
3. **Auth haerten**: API-Keys nicht mehr in `.env` im Klartext, sondern gehasht in einer
   DB-Tabelle, inkl. Ablaufdatum, Rate-Limit pro Tenant, Nutzungsmessung (Grundlage fuers
   Billing).
4. **Matching verbessern**: Von reinem Fuzzy-Matching auf semantische Embeddings
   umstellen (siehe Kommentar in `skill_matcher.py`), damit auch Umschreibungen erkannt
   werden, nicht nur wortnahe Treffer.
5. **Einbettbares Widget**: die React/ORBIT-User-Journey (`dyd-bolt-frontend`) als
   eingebettetes Widget (iframe oder Web Component) verpacken, das ein Bildungstraeger mit
   wenigen Zeilen auf seiner eigenen Seite einbinden kann.
6. **Deployment + echtes Auth**: auf Render/Railway/Fly.io deployen (jetzt mit Postgres
   statt SQLite via `DATABASE_URL`), Staging- und Prod-Umgebung trennen, CI (z.B. GitHub
   Actions) fuer automatische Tests bei jedem Push.
7. **Whitelabel-Layer**: Tenant-Konfiguration (Branding/Domain) in eigener Tabelle, damit
   Tenants ihr Branding selbst verwalten koennen statt fest in `.env` zu stehen.
8. **Make.com anbinden**: Webhook-Endpunkt fuer Tenant-Provisionierung, damit ein neuer
   Whitelabel-Kunde automatisiert angelegt werden kann.

Details zu Vertrieb/Integration/Gesamtarchitektur stehen im Strategiedokument im
Claude-Projekt "API/White Label".

