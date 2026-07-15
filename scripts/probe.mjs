// Pure reachability probe — no credentials sent, nothing printed but host + status.
async function probe(label, url) {
  try {
    const res = await fetch(url, { method: "GET" });
    const text = (await res.text()).slice(0, 60).replace(/\s+/g, " ");
    console.log(`${label}: HTTP ${res.status} · body[0:60]="${text}"`);
  } catch (e) {
    console.log(`${label}: NETWORK ERROR ${e.cause?.code || e.message}`);
  }
}
await probe("supabase", "https://tdpwcblukcxevyerfiyh.supabase.co/auth/v1/health");
await probe("anthropic", "https://api.anthropic.com/v1/models");
await probe("openai", "https://api.openai.com/v1/models");
await probe("llamacloud", "https://api.cloud.llamaindex.ai/api/parsing/health");
