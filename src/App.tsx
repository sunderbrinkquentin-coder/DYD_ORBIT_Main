import { useState } from "react";
import { DashboardPage } from "./pages/DashboardPage";
import { JourneyPage } from "./pages/JourneyPage";

      {view === "dashboard" ? <DashboardPage /> : <JourneyPage journeyVersion="v2" />}

/**
 * Einfacher Umschalter zwischen den beiden Vorschau-Oberflächen:
 *  - Dashboard  = Interface A, für den Bildungsträger/Operator
 *  - Journey    = Interface B, für den Endnutzer/Lead
 *
 * In deiner echten Website ersetzt du diesen Umschalter später durch echtes
 * Routing (z.B. zwei getrennte Seiten/Routen) — hier reicht ein einfacher
 * Toggle, um beide Oberflächen direkt in Bolt anzuschauen.
 */
export default function App() {
  const [view, setView] = useState<View>("dashboard");

  return (
    <div>
      <div
        style={{
          position: "fixed",
          top: 12,
          left: 12,
          zIndex: 50,
          display: "flex",
          gap: 8,
          background: "#fff",
          border: "1px solid #e6eaf2",
          borderRadius: 12,
          padding: 6,
          boxShadow: "0 8px 24px rgba(15,27,45,.08)",
          fontFamily: "'Inter', system-ui, sans-serif",
        }}
      >
        <ViewButton active={view === "dashboard"} onClick={() => setView("dashboard")}>
          Bildungsträger-Dashboard
        </ViewButton>
        <ViewButton active={view === "journey"} onClick={() => setView("journey")}>
          Nutzer-Journey
        </ViewButton>
      </div>

      {view === "dashboard" ? <DashboardPage /> : <JourneyPage />}
    </div>
  );
}

function ViewButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      style={{
        border: "none",
        borderRadius: 8,
        padding: "8px 14px",
        fontSize: 12.5,
        fontWeight: 700,
        cursor: "pointer",
        fontFamily: "inherit",
        background: active ? "linear-gradient(90deg, #8fecb4, #2f8fd6)" : "transparent",
        color: active ? "#0c1c34" : "#5b6779",
      }}
    >
      {children}
    </button>
  );
}
