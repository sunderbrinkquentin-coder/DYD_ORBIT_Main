import { useEffect, useState, type CSSProperties } from "react";
import {
  createCheckoutSession,
  fetchBillingPlans,
  formatPriceAmount,
  type BillingInterval,
  type BillingPlan,
  type BillingPlansResponse,
} from "../api/billing";

interface PlanPickerProps {
  apiBase: string;
  apiKey: string;
  /** Zeigt optional einen Hinweistext oben an, z.B. im Sperrbildschirm
   *  ("Deine Testphase ist abgelaufen") - im Dashboard einfach weglassen. */
  intro?: string;
}

const PLAN_ORDER: BillingPlan[] = ["starter", "growth", "professional"];

const PLAN_LABELS: Record<BillingPlan, string> = {
  starter: "ORBIT Starter",
  growth: "ORBIT Growth",
  professional: "ORBIT Professional",
};

const PLAN_TAGLINES: Record<BillingPlan, string> = {
  starter: "Für den Einstieg ins Kurs-Matching.",
  growth: "Für wachsende Bildungsträger mit mehr Kursangebot.",
  professional: "Für große Kataloge mit maximalem Volumen.",
};

/**
 * NEU (Schritt 4, Upgrade-Flow): Plan-Auswahl innerhalb von ORBIT selbst
 * (TrialLockedPage/Dashboard) statt auf der externen Website - so kann der
 * Checkout mit dem bereits vorhandenen X-API-Key aus der Tenant-Session
 * aufgerufen werden (siehe Team-Entscheidung im Chat: "Im
 * ORBIT-Dashboard/Sperrbildschirm"). Holt die echten, aktuellen Preise
 * live aus Stripe (GET /api/v1/billing/plans) statt sie hart zu codieren,
 * damit eine spätere Preisänderung in Stripe automatisch ankommt.
 */
export function PlanPicker({ apiBase, apiKey, intro }: PlanPickerProps) {
  const [interval, setInterval] = useState<BillingInterval>("monthly");
  const [plans, setPlans] = useState<BillingPlansResponse | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [checkoutPlan, setCheckoutPlan] = useState<BillingPlan | null>(null);
  const [checkoutError, setCheckoutError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    fetchBillingPlans(apiBase, apiKey)
      .then((res) => {
        if (!cancelled) setPlans(res);
      })
      .catch((err) => {
        if (!cancelled) setLoadError(err instanceof Error ? err.message : String(err));
      });

    return () => {
      cancelled = true;
    };
  }, [apiBase, apiKey]);

  async function handleSelectPlan(plan: BillingPlan) {
    setCheckoutError(null);
    setCheckoutPlan(plan);
    try {
      // Redirect-Ziele: aktuelle Seite, damit Stripe nach Checkout/Abbruch
      // wieder genau hierhin (Sperrbildschirm bzw. Dashboard) zurückschickt.
      // App.tsx wertet ?checkout=success in der URL aus, um die
      // Tenant-Session danach neu zu laden (siehe dort).
      const redirectBase = window.location.origin + window.location.pathname;
      const { checkout_url } = await createCheckoutSession(
        apiBase,
        apiKey,
        plan,
        interval,
        `${redirectBase}?checkout=success`,
        `${redirectBase}?checkout=cancelled`
      );
      window.location.href = checkout_url;
    } catch (err) {
      setCheckoutError(err instanceof Error ? err.message : String(err));
      setCheckoutPlan(null);
    }
  }

  return (
    <div style={styles.wrap}>
      {intro && <p style={styles.intro}>{intro}</p>}

      <div style={styles.toggleRow}>
        <IntervalButton active={interval === "monthly"} onClick={() => setInterval("monthly")}>
          Monatlich
        </IntervalButton>
        <IntervalButton active={interval === "yearly"} onClick={() => setInterval("yearly")}>
          Jährlich <span style={styles.badge}>2 Monate gratis</span>
        </IntervalButton>
      </div>

      {loadError && <p style={styles.errorText}>{loadError}</p>}
      {checkoutError && <p style={styles.errorText}>{checkoutError}</p>}

      <div style={styles.grid}>
        {PLAN_ORDER.map((plan) => {
          const info = plans?.plans[plan];
          const price = info ? info[interval] : null;
          const isLoading = checkoutPlan === plan;

          return (
            <div key={plan} style={styles.card}>
              <div style={styles.cardName}>{PLAN_LABELS[plan]}</div>
              <div style={styles.cardTagline}>{PLAN_TAGLINES[plan]}</div>
              <div style={styles.cardPrice}>
                {price ? formatPriceAmount(price.amount, price.currency) : "…"}
                <span style={styles.cardPriceUnit}>{interval === "monthly" ? " / Monat" : " / Jahr"}</span>
              </div>
              <div style={styles.cardLimit}>
                {info ? `bis zu ${info.course_limit.toLocaleString("de-DE")} Kurse` : " "}
              </div>
              <button
                style={{ ...styles.cta, ...(isLoading ? styles.ctaDisabled : {}) }}
                disabled={isLoading || !plans}
                onClick={() => void handleSelectPlan(plan)}
              >
                {isLoading ? "Weiterleitung…" : "Diesen Plan wählen"}
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function IntervalButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      style={{
        ...styles.toggleButton,
        ...(active ? styles.toggleButtonActive : {}),
      }}
    >
      {children}
    </button>
  );
}

const styles: Record<string, CSSProperties> = {
  wrap: {
    width: "100%",
  },
  intro: {
    margin: "0 0 18px",
    fontSize: 14,
    lineHeight: 1.5,
    color: "#5b6779",
    textAlign: "center",
  },
  toggleRow: {
    display: "flex",
    justifyContent: "center",
    gap: 8,
    marginBottom: 20,
  },
  toggleButton: {
    border: "1px solid #e6eaf2",
    background: "#fff",
    color: "#5b6779",
    borderRadius: 999,
    padding: "8px 16px",
    fontSize: 13,
    fontWeight: 600,
    fontFamily: "inherit",
    cursor: "pointer",
  },
  toggleButtonActive: {
    background: "#0c1c34",
    borderColor: "#0c1c34",
    color: "#fff",
  },
  badge: {
    marginLeft: 6,
    fontSize: 11,
    fontWeight: 700,
    color: "#2f8fd6",
  },
  errorText: {
    color: "#c23b3b",
    fontSize: 13,
    textAlign: "center",
    marginBottom: 16,
  },
  grid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
    gap: 14,
  },
  card: {
    border: "1px solid #e6eaf2",
    borderRadius: 14,
    padding: "20px 16px",
    textAlign: "center",
    background: "#fafbfd",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
  },
  cardName: {
    fontSize: 15,
    fontWeight: 700,
    color: "#0c1c34",
    marginBottom: 4,
  },
  cardTagline: {
    fontSize: 12.5,
    color: "#5b6779",
    marginBottom: 14,
    minHeight: 32,
  },
  cardPrice: {
    fontSize: 22,
    fontWeight: 800,
    color: "#0c1c34",
    marginBottom: 2,
  },
  cardPriceUnit: {
    fontSize: 12,
    fontWeight: 500,
    color: "#5b6779",
  },
  cardLimit: {
    fontSize: 12.5,
    color: "#5b6779",
    marginBottom: 16,
  },
  cta: {
    width: "100%",
    boxSizing: "border-box",
    border: "none",
    borderRadius: 8,
    padding: "10px 14px",
    fontSize: 13.5,
    fontWeight: 700,
    fontFamily: "inherit",
    cursor: "pointer",
    background: "linear-gradient(90deg, #8fecb4, #2f8fd6)",
    color: "#0c1c34",
    marginTop: "auto",
  },
  ctaDisabled: {
    opacity: 0.6,
    cursor: "default",
  },
};