import { getStore } from "@netlify/blobs";

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });

const isAdmin = (req) => {
  const given = (req.headers.get("x-admin-pin") || "").trim().toUpperCase();
  const real = (process.env.ADMIN_PIN || "SIERRA1").trim().toUpperCase();
  return given.length > 0 && given === real;
};

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

// Owner only: these contain clients' names and phone numbers.
export default async (req) => {
  if (req.method !== "GET") return json({ error: "Method not allowed" }, 405);
  if (!isAdmin(req)) return json({ error: "Wrong code" }, 401);
  try {
    const items = await withStore(async (store) => {
      const { blobs } = await store.list();
      return Promise.all(blobs.map((b) => store.get(b.key, { type: "json" })));
    });
    const list = items.filter(Boolean).sort((a, b) => String(a.submittedAt).localeCompare(String(b.submittedAt)));
    return json(list);
  } catch (e) {
    return json({ error: e.message }, 500);
  }
};
