#!/usr/bin/env bash
# E2E smoke vs production using curl + cookie jars.
# Proves: magic-link token verify → session cookie → authorized pages render,
# and buyer-side permission filtering holds on the deployed app.
set -euo pipefail
APP="https://pitchbook-ashen.vercel.app"
DEAL="729c990f-8e57-4c1b-b5e2-84f334e37769"

th() { # $1 = email → token_hash
  node --input-type=module -e "
import { createClient } from '@supabase/supabase-js';
const a = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {auth:{persistSession:false}});
const { data, error } = await a.auth.admin.generateLink({ type: 'magiclink', email: '$1' });
if (error) { console.error(error.message); process.exit(1); }
console.log(data.properties.hashed_token);
"
}

echo "== SELLER =="
TH=$(th seller@meridianlogistics.example.com)
rm -f /tmp/seller.jar
curl -s -c /tmp/seller.jar -o /dev/null -w "callback: %{http_code} → %{redirect_url}\n" "$APP/auth/callback?token_hash=$TH&type=magiclink"
HTML=$(curl -s -b /tmp/seller.jar -L "$APP/deals/$DEAL")
echo "console page bytes: ${#HTML}"
for probe in "Review queue" "Documents" "Buyers" "Activity" "audit.csv" "Meridian"; do
  if grep -qi "$probe" <<<"$HTML"; then echo "  ✓ contains: $probe"; else echo "  ✗ MISSING: $probe"; fi
done

echo "== BUYER (Crestline — no Restricted access) =="
TH=$(th diligence@crestlinecap.example.com)
rm -f /tmp/buyer.jar
curl -s -c /tmp/buyer.jar -o /dev/null -w "callback: %{http_code} → %{redirect_url}\n" "$APP/auth/callback?token_hash=$TH&type=magiclink"
BHTML=$(curl -s -b /tmp/buyer.jar -L "$APP/room/$DEAL")
echo "room page bytes: ${#BHTML}"
for probe in "Financials" "Corporate" "Commercial"; do
  if grep -qi "$probe" <<<"$BHTML"; then echo "  ✓ sees folder: $probe"; else echo "  ✗ MISSING folder: $probe"; fi
done
for hidden in "Restricted" "Litigation" "Delgado"; do
  if grep -qi "$hidden" <<<"$BHTML"; then echo "  ✗ LEAK — buyer sees: $hidden"; else echo "  ✓ hidden from buyer: $hidden"; fi
done

echo "== BUYER cannot open the seller console =="
curl -s -b /tmp/buyer.jar -o /dev/null -w "GET /deals/<id> as buyer: %{http_code} (final: %{url_effective})\n" -L "$APP/deals/$DEAL"
echo "== Unauthenticated audit CSV =="
curl -s -o /dev/null -w "GET audit.csv anon: %{http_code}\n" "$APP/api/deals/$DEAL/audit.csv"
echo "== Seller audit CSV =="
curl -s -b /tmp/seller.jar -w "\nGET audit.csv seller: %{http_code}\n" "$APP/api/deals/$DEAL/audit.csv" | head -3
echo "DONE"
