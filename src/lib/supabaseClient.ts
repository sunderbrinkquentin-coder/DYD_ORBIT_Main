/**
 * NEU (Schritt 7, Auth-Flow): Supabase-Browser-Client für den echten
 * E-Mail+Passwort-Login im Dashboard-Frontend.
 *
 * WICHTIG: hier gehört NUR der "anon"/"public" Key rein (Supabase Dashboard
 * -> Project Settings -> API -> "anon public"). Der service_role-Key lebt
 * ausschließlich in den Supabase-Edge-Function-Secrets (siehe orbit-api.ts,
 * SUPABASE_SERVICE_ROLE_KEY) und darf NIEMALS in den Browser-Code — der
 * anon-Key ist bewusst dafür gemacht, öffentlich im Frontend zu stehen (er
 * kann laut Row Level Security nichts, was ein Angreifer nicht auch über die
 * Login-Maske selbst könnte).
 *
 * In Bolt unter "Umgebungsvariablen" (bzw. lokal in einer .env-Datei im
 * Projekt-Root) setzen:
 *   VITE_SUPABASE_URL=https://<DEIN-PROJECT-REF>.supabase.co
 *   VITE_SUPABASE_ANON_KEY=<dein anon/public Key>
 */

import { createClient } from "@supabase/supabase-js";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

if (!supabaseUrl || !supabaseAnonKey) {
  // Bewusst nur eine Konsolen-Warnung, kein throw: die App soll trotzdem
  // laden (z.B. für den Dev-Vorschau-Modus ohne Login), nur der echte
  // Login-Flow funktioniert dann nicht, bis die beiden Variablen gesetzt sind.
  console.warn(
    "[Supabase] VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY sind nicht gesetzt — der Login wird nicht funktionieren, bis diese Umgebungsvariablen hinterlegt sind."
  );
}

export const supabase = createClient(supabaseUrl ?? "", supabaseAnonKey ?? "");