/**
 * Gemeinsame, kleine Fehlerklasse fuer die schlanken Fetch-Helfer, die NICHT
 * die requestJson()-Konvention aus core.ts nutzen (session.ts, billing.ts) -
 * beide authentifizieren anders (Bearer-JWT bzw. eigene Endpunkte) und
 * brauchen deshalb ihre eigene fetch-Logik, sollen aber trotzdem denselben
 * Fehlertyp werfen statt jede Datei ihre eigene Kopie definieren zu lassen.
 *
 * WICHTIG: core.ts definiert bewusst KEINE eigene Error-Klasse (siehe
 * genericRequestError()-Kommentar dort) - diese Klasse hier ist NUR fuer
 * session.ts/billing.ts, core.ts/orbit.ts bleiben unveraendert.
 */
export class ApiRequestError extends Error {
  status: number;
  /** Maschinenlesbarer Backend-Code (z.B. "trial_expired", "tenant_inactive") -
   *  KEIN Freitext, KEIN Stacktrace-Fragment - darf deshalb von der UI
   *  ausgewertet werden. */
  code?: string;

  constructor(status: number, message: string, code?: string) {
    super(message);
    this.name = "ApiRequestError";
    this.status = status;
    this.code = code;
  }
}