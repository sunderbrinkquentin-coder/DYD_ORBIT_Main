import { useEffect, useState, type CSSProperties } from "react";
import { supabase } from "../lib/supabaseClient";
import { fetchAdminTenants, impersonateTenant, type AdminTenantSummary } from "../api/admin";
import type { TenantSessionResponse } from "../api/session";

interface AdminTenantListPageProps {
  apiBase: string;
  adminEmail: string;
  /** Wird mit der aufgelösten Tenant-Session aufgerufen, sobald "Dashboard
   *  öffnen" erfolgreich war — App.tsx wechselt daraufhin in denselben
   *  "loggedIn"-Zustand wie bei einem echten Tenant-Login, ergänzt um die
   *  Admin-Leiste (siehe adminBannerStyle dort). */
  onOpenTenant: (session: TenantSessionResponse) => void;
  onLogout: () => void;
}

const STATUS_LABELS: Record<string, string> = {
  trial: "Trial",
  active: "Aktiv",
  past_due: "Zahlung überfällig",
  canceled: "Gekündigt",
};

/**
 * NEU (30.09.2026, Admin-Modus): Tenant-Auswahl für dein eigenes Admin-Konto
 * (siehe admin_users-Tabelle im Backend) — ersetzt für DICH das normale
 * Dashboard direkt nach dem Login. Klick auf "Dashboard öffnen" ruft
 * POST /api/v1/admin/impersonate auf und liefert denselben Sitzungs-Typ
 * (TenantSessionResponse) wie ein echter Tenant-Login — App.tsx zeigt
 * danach exakt dasselbe Dashboard wie der Kunde selbst (Kurse pflegen,
 * Leads, Reports, API-Zugang, Journey einbetten), nur ergänzt um eine feste
 * Admin-Leiste mit "Zurück zur Tenant-Liste".
 */
export function AdminTenantListPage({ apiBase, adminEmail, onOpenTenant, onLogout }: AdminTenantListPageProps) {
  const [tenants, setTenants] = useState<AdminTenantSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [openingId, setOpeningId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setError(null);
      const { data } = await supabase.auth.getSession();
      const accessToken = data.session?.access_token;
      if (!accessToken) return;

      try {
        const list = await fetchAdminTenants(apiBase, accessToken);
        if (!cancelled) setTenants(list);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [apiBase]);

  async function handleOpen(tenantId: string) {
    setError(null);
    setOpeningId(tenantId);

    const { data } = await supabase.auth.getSession();
    const accessToken = data.session?.access_token;
    if (!accessToken) {
      setOpeningId(null);
      setError("Sitzung abgelaufen - bitte neu einloggen.");
      return;
    }

    try {
      const session = await impersonateTenant(apiBase, accessToken, tenantId);
      onOpenTenant(session);
    } catch (err) {
      setOpeningId(null);
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  const filtered = (tenants ?? []).filter((t) =>
    t.tenant_name.toLowerCase().includes(search.trim().toLowerCase())
  );

  return (
    <div style={styles.page}>
      <div style={styles.card}>
        <div style={styles.headerRow}>
          <div>
            <div style={styles.brand}>DYD ORBIT · Admin</div>
            <h1 style={styles.heading}>Tenants</h1>
            <p style={styles.subheading}>Angemeldet als {adminEmail}</p>
          </div>
          <button style={styles.logoutButton} onClick={onLogout}>
            Abmelden
          </button>
        </div>

        <input
          type="search"
          placeholder="Bildungsträger suchen…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={styles.search}
        />

        {error && <div style={styles.error}>{error}</div>}

        {tenants === null && !error ? (
          <p style={styles.subheading}>Lade…</p>
        ) : filtered.length === 0 ? (
          <p style={styles.subheading}>Keine Tenants gefunden.</p>
        ) : (
          <div style={styles.list}>
            {filtered.map((t) => (
              <div key={t.tenant_id} style={styles.row}>
                <div style={styles.rowInfo}>
                  <div style={styles.rowName}>{t.tenant_name}</div>
                  <div style={styles.rowMeta}>
                    {t.plan ? t.plan : "Legacy"} · {t.status ? STATUS_LABELS[t.status] ?? t.status : "—"}
                    {t.course_limit != null && <> · Kurslimit {t.course_limit}</>}
                  </div>
                </div>
                <button
                  style={styles.openButton}
                  disabled={openingId === t.tenant_id}
                  onClick={() => void handleOpen(t.tenant_id)}
                >
                  {openingId === t.tenant_id ? "Öffnet…" : "Dashboard öffnen"}
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

const styles: Record<string, CSSProperties> = {
  page: {
    minHeight: "100vh",
    display: "flex",
    justifyContent: "center",
    background: "#f4f6fb",
    fontFamily: "'Inter', system-ui, sans-serif",
    padding: "48px 16px",
  },
  card: {
    width: "100%",
    maxWidth: 640,
    background: "#fff",
    border: "1px solid #e6eaf2",
    borderRadius: 16,
    padding: "28px 28px 12px",
    boxShadow: "0 8px 24px rgba(15,27,45,.08)",
    height: "fit-content",
  },
  headerRow: {
    display: "flex",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 12,
  },
  brand: {
    fontSize: 12.5,
    fontWeight: 700,
    letterSpacing: 1.5,
    color: "#2f8fd6",
    marginBottom: 6,
  },
  heading: {
    margin: "0 0 4px",
    fontSize: 22,
    color: "#0c1c34",
  },
  subheading: {
    margin: 0,
    fontSize: 13,
    color: "#5b6779",
  },
  logoutButton: {
    border: "1px solid #e6eaf2",
    borderRadius: 8,
    padding: "8px 14px",
    fontSize: 12.5,
    fontWeight: 700,
    cursor: "pointer",
    fontFamily: "inherit",
    background: "#fff",
    color: "#5b6779",
    whiteSpace: "nowrap",
  },
  search: {
    width: "100%",
    boxSizing: "border-box",
    marginTop: 20,
    padding: "10px 12px",
    fontSize: 14,
    border: "1px solid #dfe4ee",
    borderRadius: 8,
    fontFamily: "inherit",
  },
  error: {
    marginTop: 14,
    fontSize: 13,
    color: "#c0392b",
    background: "#fdecea",
    border: "1px solid #f5c6c0",
    borderRadius: 8,
    padding: "8px 10px",
  },
  list: {
    marginTop: 16,
    display: "flex",
    flexDirection: "column",
  },
  row: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    padding: "14px 0",
    borderTop: "1px solid #eef1f7",
  },
  rowInfo: {
    minWidth: 0,
  },
  rowName: {
    fontSize: 14.5,
    fontWeight: 700,
    color: "#0c1c34",
  },
  rowMeta: {
    fontSize: 12.5,
    color: "#5b6779",
    marginTop: 2,
  },
  openButton: {
    border: "none",
    borderRadius: 8,
    padding: "9px 14px",
    fontSize: 12.5,
    fontWeight: 700,
    cursor: "pointer",
    fontFamily: "inherit",
    background: "linear-gradient(90deg, #8fecb4, #2f8fd6)",
    color: "#0c1c34",
    whiteSpace: "nowrap",
  },
};