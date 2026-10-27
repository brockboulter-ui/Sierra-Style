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

// Owner only.
export default async (req) => {
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  if (!isAdmin(req)) return json({ error: "Wrong code" }, 401);
  try {
    const { id } = JSON.parse((await req.text()) || "{}");
    if (!id || typeof id !== "string") return json({ error: "Missing id" }, 400);
    await withStore((store) => store.delete(id));
    return json({ ok: true });
  } catch (e) {
    return json({ error: e.message }, 500);
  }
};
