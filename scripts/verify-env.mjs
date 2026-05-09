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

async function testRejseplanen(accessId) {
  if (!accessId) {
    fail("REJSEPLANEN_ACCESS_ID", "mangler eller tom");
    return false;
  }
  const u = new URL("https://www.rejseplanen.dk/api/location.name");
  u.searchParams.set("accessId", accessId);
  u.searchParams.set("format", "json");
  u.searchParams.set("lang", "da");
  u.searchParams.set("input", "Roskilde St.");
  const res = await fetch(u);
  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    fail("REJSEPLANEN_ACCESS_ID", "ikke JSON (tjek nøgle og netværk)");
    return false;
  }
  const rejseErr = data.error ?? data.errorCode;
  if (rejseErr) {
    fail(
      "REJSEPLANEN_ACCESS_ID",
      String(data.errorText || data.error || data.errorCode)
    );
    return false;
  }
  if (!res.ok) {
    fail("REJSEPLANEN_ACCESS_ID", `HTTP ${res.status}`);
    return false;
  }
  ok("REJSEPLANEN_ACCESS_ID (location.name → JSON)");
  return true;
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
  const results = await Promise.all([
    testRejseplanen(env.REJSEPLANEN_ACCESS_ID),
    testGoogleMaps(env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY),
    testGemini(env.GOOGLE_AI_API_KEY)
  ]);
  const allOk = results.every(Boolean);
  if (!allOk) {
    console.error("\nEn eller flere nøgler fejlede.");
    process.exit(1);
  }
  console.log("\nAlle tre nøgler er gyldige mod API’erne.");
}

main().catch((e) => {
  console.error("Uventet fejl:", e.message);
  process.exit(1);
});
