// E2E smoke test against the PRODUCTION deploy: sign in as the seeded seller
// and buyer via admin-generated magic-link token_hash (same verification path
// a real email click uses), then screenshot what each of them sees.
// Run: node scripts/e2e-smoke.mjs  (env must be exported)
import { createClient } from "@supabase/supabase-js";
import { chromium } from "playwright";

const APP = "https://pitchbook-ashen.vercel.app";
const DEAL = "729c990f-8e57-4c1b-b5e2-84f334e37769";
const admin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } },
);

async function tokenHashFor(email) {
  const { data, error } = await admin.auth.admin.generateLink({
    type: "magiclink",
    email,
  });
  if (error) throw error;
  return data.properties.hashed_token;
}

async function sessionPage(browser, email, label) {
  const ctx = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    ignoreHTTPSErrors: true, // proxy re-signs TLS with a local CA
  });
  const page = await ctx.newPage();
  const th = await tokenHashFor(email);
  await page.goto(`${APP}/auth/callback?token_hash=${th}&type=magiclink`, {
    waitUntil: "networkidle",
    timeout: 60000,
  });
  console.log(`${label}: landed on ${page.url()}`);
  return page;
}

const browser = await chromium.launch({
  executablePath: "/opt/pw-browsers/chromium",
  proxy: { server: "http://127.0.0.1:42801" }, // sandbox egress proxy
});

// ── Seller: deal console ────────────────────────────────────────────────
const seller = await sessionPage(browser, "seller@meridianlogistics.example.com", "seller");
await seller.goto(`${APP}/deals/${DEAL}`, { waitUntil: "networkidle", timeout: 60000 });
await seller.waitForTimeout(2500);
console.log(`seller console: ${seller.url()}`);
console.log(`  has Buyers section: ${await seller.locator("text=Buyers").count() > 0}`);
console.log(`  has Activity section: ${await seller.locator("text=Activity").count() > 0}`);
console.log(`  has audit CSV link: ${await seller.locator('a[href*="audit.csv"]').count() > 0}`);
await seller.screenshot({ path: "/home/claude/seller-console.png", fullPage: true });

// ── Buyer: data room ────────────────────────────────────────────────────
const buyer = await sessionPage(browser, "diligence@crestlinecap.example.com", "buyer");
await buyer.goto(`${APP}/room/${DEAL}`, { waitUntil: "networkidle", timeout: 60000 });
await buyer.waitForTimeout(2500);
console.log(`buyer room: ${buyer.url()}`);
const bodyText = await buyer.locator("body").innerText();
console.log(`  sees document index: ${bodyText.includes("Financials") || bodyText.includes("Corporate")}`);
console.log(`  restricted folder hidden: ${!bodyText.includes("Restricted")}`);
console.log(`  litigation memo hidden: ${!bodyText.toLowerCase().includes("litigation")}`);
await buyer.screenshot({ path: "/home/claude/buyer-room.png", fullPage: true });

await browser.close();
console.log("DONE");
