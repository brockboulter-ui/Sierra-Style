import { getStore } from "@netlify/blobs";

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });

async function withStore(fn) {
  try {
    return await fn(getStore({ name: "submissions", consistency: "strong" }));
  } catch (e) {
    if (String((e && e.message) || "").includes("uncachedEdgeURL")) {
      return await fn(getStore("submissions"));
    }
    throw e;
  }
}

const str = (v, max) => (typeof v === "string" ? v.trim().slice(0, max) : "");

// Public: anyone with the link can send availability. No login needed.
export default async (req) => {
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  try {
    const raw = await req.text();
    if (raw.length > 50_000) return json({ error: "Too large" }, 413);
    const data = JSON.parse(raw || "{}");

    const ranges = (Array.isArray(data.ranges) ? data.ranges : []).slice(0, 100).map((r) => ({
      start: Number(r && r.start) || 0,
      end: Number(r && r.end) || 0,
      label: str(r && r.label, 60),
    }));
    if (!str(data.client, 100) || ranges.length === 0) return json({ error: "Missing name or times" }, 400);

    const id = crypto.randomUUID();
    const record = {
      id,
      client: str(data.client, 100),
      phone: str(data.phone, 30),
      note: str(data.note, 1000),
      dateKey: str(data.dateKey, 40),
      dateLabel: str(data.dateLabel, 60),
      serviceIds: (Array.isArray(data.serviceIds) ? data.serviceIds : []).slice(0, 20).map((x) => str(x, 80)),
      serviceNames: (Array.isArray(data.serviceNames) ? data.serviceNames : []).slice(0, 20).map((x) => str(x, 120)),
      ranges,
      submittedAt: new Date().toISOString(),
    };
    await withStore((store) => store.setJSON(id, record));
    return json({ ok: true, id });
  } catch (e) {
    return json({ error: e.message }, 500);
  }
};
