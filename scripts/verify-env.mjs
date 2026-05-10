/**
 * Verifies .env.local keys against live APIs. Never prints secret values.
 * Run: node scripts/verify-env.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");
const envPath = path.join(root, ".env.local");

function loadEnvLocal() {
  if (!fs.existsSync(envPath)) {
    console.error("❌ Mangler .env.local");
    process.exit(1);
  }
  const raw = fs.readFileSync(envPath, "utf8").replace(/^\uFEFF/, "");
  const out = {};
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim().replace(/\r$/, "");
    let val = trimmed.slice(eq + 1).trim().replace(/\r$/, "");
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    out[key] = val;
  }
  return out;
}

function ok(name) {
  console.log(`✅ ${name}`);
}

function fail(name, hint) {
  console.error(`❌ ${name}${hint ? `: ${hint}` : ""}`);
}

async function testGoogleMaps(key) {
  if (!key) {
    fail("NEXT_PUBLIC_GOOGLE_MAPS_API_KEY", "mangler eller tom");
    return false;
  }
  const u = new URL("https://maps.googleapis.com/maps/api/geocode/json");
  u.searchParams.set("address", "København");
  u.searchParams.set("key", key);
  const res = await fetch(u);
  const data = await res.json();
  if (data.status === "OK" || data.status === "ZERO_RESULTS") {
    ok("NEXT_PUBLIC_GOOGLE_MAPS_API_KEY (Geocoding API)");
    return true;
  }
  fail("NEXT_PUBLIC_GOOGLE_MAPS_API_KEY", `status: ${data.status}${data.error_message ? " — " + data.error_message : ""}`);
  return false;
}

async function testGoogleDirections(key) {
  if (!key) {
    fail("NEXT_PUBLIC_GOOGLE_MAPS_API_KEY (Directions)", "mangler eller tom");
    return false;
  }
  const u = new URL("https://maps.googleapis.com/maps/api/directions/json");
  u.searchParams.set("origin", "55.675,12.568");
  u.searchParams.set("destination", "55.687,12.491");
  u.searchParams.set("mode", "transit");
  u.searchParams.set("departure_time", String(Math.floor(Date.now() / 1000)));
  u.searchParams.set("region", "dk");
  u.searchParams.set("language", "da");
  u.searchParams.set("key", key);
  const res = await fetch(u);
  const data = await res.json();
  if (data.status === "OK" && Array.isArray(data.routes) && data.routes.length > 0) {
    ok("NEXT_PUBLIC_GOOGLE_MAPS_API_KEY (Directions API — transit)");
    return true;
  }
  const hint =
    data.status === "REQUEST_DENIED"
      ? " — aktivér Directions API for nøglen (Google Cloud Console)"
      : "";
  fail(
    "NEXT_PUBLIC_GOOGLE_MAPS_API_KEY (Directions)",
    `${data.status ?? "ukendt"}${data.error_message ? " — " + data.error_message : ""}${hint}`
  );
  return false;
}

async function testGoogleWeather(key) {
  if (!key) {
    fail("NEXT_PUBLIC_GOOGLE_MAPS_API_KEY (Weather)", "mangler eller tom");
    return false;
  }
  const u = new URL("https://weather.googleapis.com/v1/forecast/hours:lookup");
  u.searchParams.set("key", key);
  u.searchParams.set("location.latitude", "55.676");
  u.searchParams.set("location.longitude", "12.568");
  u.searchParams.set("hours", "1");
  const res = await fetch(u);
  const data = await res.json().catch(() => ({}));
  if (res.ok && Array.isArray(data.forecastHours) && data.forecastHours.length > 0) {
    ok("NEXT_PUBLIC_GOOGLE_MAPS_API_KEY (Weather API — weather.googleapis.com)");
    return true;
  }
  const errMsg = data?.error?.message || data?.error?.status || res.statusText;
  const hint =
    data?.error?.status === "PERMISSION_DENIED" || String(errMsg).includes("API key")
      ? " — aktivér Weather API for nøglen (Google Cloud Console)"
      : "";
  fail(
    "NEXT_PUBLIC_GOOGLE_MAPS_API_KEY (Weather)",
    `${errMsg || `HTTP ${res.status}`}${hint}`
  );
  return false;
}

async function testGemini(key) {
  if (!key) {
    fail("GOOGLE_AI_API_KEY", "mangler eller tom");
    return false;
  }
  const listUrl = `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(key)}`;
  const res = await fetch(listUrl);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = data?.error?.message || res.statusText;
    fail("GOOGLE_AI_API_KEY", msg);
    return false;
  }
  const models = data.models;
  if (!Array.isArray(models) || models.length === 0) {
    fail("GOOGLE_AI_API_KEY", "models-liste tom (tjek nøglen)");
    return false;
  }
  ok("GOOGLE_AI_API_KEY (Gemini API — models/list)");
  return true;
}

async function main() {
  console.log("Miljøcheck (.env.local) — værdier vises ikke.\n");
  const env = loadEnvLocal();
  const key = env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;
  const results = await Promise.all([
    testGoogleMaps(key),
    testGoogleDirections(key),
    testGoogleWeather(key),
    testGemini(env.GOOGLE_AI_API_KEY)
  ]);
  const allOk = results.every(Boolean);
  if (!allOk) {
    console.error("\nEn eller flere nøgler fejlede.");
    process.exit(1);
  }
  console.log("\nAlle nøgler er gyldige mod API’erne (Geocoding, Directions, Weather, Gemini).");
}

main().catch((e) => {
  console.error("Uventet fejl:", e.message);
  process.exit(1);
});
