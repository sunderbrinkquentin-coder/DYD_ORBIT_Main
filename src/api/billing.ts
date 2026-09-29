/**
 * NEU (Schritt 4, Stripe): eigene, kleine Fetch-Helfer fuer die beiden neuen
 * Billing-Endpunkte (GET /api/v1/billing/plans, POST
 * /api/v1/billing/checkout-session). Bewusst eine EIGENE Datei statt in
 * core.ts/orbit.ts ergaenzt: diese beiden sind weit umfangreicher und aktiv
 * in Bolt weiterentwickelt worden (siehe Chat) - eine neue, unabhaengige
 * Datei kann nichts davon versehentlich ueberschreiben oder mit einer
 * veralteten Kopie kollidieren.
 */

import { genericRequestError } from "./core";
import { ApiRequestError } from "./apiError";

export type BillingPlan = "starter" | "growth" | "professional";
export type BillingInterval = "monthly" | "yearly";

// Re-exportiert, damit bestehender Code (falls vorhanden) weiterhin
// "BillingApiError" importieren kann - ist aber identisch mit der
// gemeinsamen ApiRequestError aus session.ts (siehe apiError.ts).
export { ApiRequestError as BillingApiError };

export interface BillingPlanPrice {
  /** Betrag in der kleinsten Waehrungseinheit (Cent), direkt aus Stripe -
   *  null, falls der Preis (noch) nicht in Stripe gefunden wurde. */
  amount: number | null;
  currency: string;
}

export interface BillingPlanInfo {
  course_limit: number;
  monthly: BillingPlanPrice | null;
  yearly: BillingPlanPrice | null;
}

export interface BillingPlansResponse {
  plans: Record<BillingPlan, BillingPlanInfo>;
}

export interface CheckoutSessionResponse {
  checkout_url: string;
}

function safeJsonParse(text: string): { detail?: unknown; code?: unknown } | null {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

async function requestJson<TResponse>(
  apiBase: string,
  apiKey: string,
  path: string,
  init?: RequestInit,
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
    // Wie in core.ts: die rohe Serverantwort nur in die Entwicklerkonsole,
    // NIE als angezeigte Fehlermeldung (kann interne Details enthalten).
    const body = await res.text().catch(() => "");
    console.error(`Anfrage an ${path} fehlgeschlagen (HTTP ${res.status})`, body);
    const parsed = body ? safeJsonParse(body) : null;
    const code = parsed && typeof parsed.code === "string" ? parsed.code : undefined;
    throw new ApiRequestError(res.status, genericRequestError(res.status), code);
  }

  return res.json() as Promise<TResponse>;
}

/** Ruft GET /api/v1/billing/plans auf - die echten, aktuellen Preise direkt
 *  aus Stripe (siehe Backend-Kommentar bei handleGetBillingPlans). */
export function fetchBillingPlans(apiBase: string, apiKey: string): Promise<BillingPlansResponse> {
  return requestJson<BillingPlansResponse>(apiBase, apiKey, "/api/v1/billing/plans", {
    method: "GET",
  });
}

/** Ruft POST /api/v1/billing/checkout-session auf. successUrl/cancelUrl
 *  muessen https:// sein (Backend lehnt sonst ab) - im lokalen Dev-Server
 *  (http://localhost) schlaegt der Checkout deshalb erwartungsgemaess fehl;
 *  zum Testen des Checkout-Flows die deployte https-URL verwenden. */
export function createCheckoutSession(
  apiBase: string,
  apiKey: string,
  plan: BillingPlan,
  interval: BillingInterval,
  successUrl: string,
  cancelUrl: string,
): Promise<CheckoutSessionResponse> {
  return requestJson<CheckoutSessionResponse>(apiBase, apiKey, "/api/v1/billing/checkout-session", {
    method: "POST",
    body: JSON.stringify({
      plan,
      interval,
      success_url: successUrl,
      cancel_url: cancelUrl,
    }),
  });
}

/** Formatiert einen Stripe-Centbetrag als lesbaren Preis, z.B. 19900 -> "199 €". */
export function formatPriceAmount(amount: number | null, currency: string): string {
  if (amount === null) return "–";
  try {
    return new Intl.NumberFormat("de-DE", {
      style: "currency",
      currency: currency.toUpperCase(),
      maximumFractionDigits: amount % 100 === 0 ? 0 : 2,
    }).format(amount / 100);
  } catch {
    return `${(amount / 100).toFixed(2)} ${currency.toUpperCase()}`;
  }
}