import { getStore } from "@netlify/blobs";

// Public. A client taps the link in Sierra's text (…/?c=TOKEN) and the page
// calls this. GET looks the appointment up by its secret token; POST records
// the client's answer. Answers live in their own store (one entry per token),
// so they can never be overwritten by Sierra saving her calendar.

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });

async function withNamedStore(name, fn) {
  try {
    return await fn(getStore({ name, consistency: "strong" }));
  } catch (e) {
    if (String((e && e.message) || "").includes("uncachedEdgeURL")) {
      return await fn(getStore(name));
    }
    throw e;
  }
}

const validToken = (t) => typeof t === "string" && /^[a-f0-9]{16,64}$/.test(t);

async function findBooking(token) {
  const state = await withNamedStore("sierra-state", (s) => s.get("state", { type: "json" }));
  if (!state) return null;
  for (const [dayKey, list] of Object.entries(state.itemsByDay || {})) {
    for (const item of Array.isArray(list) ? list : []) {
      if (item && item.type === "booking" && item.token === token) {
        const names = (item.serviceIds || [])
          .map((id) => ((state.services || []).find((s) => s.id === id) || {}).name)
          .filter(Boolean);
        return {
          dayKey,
          start: item.start,
          end: item.end,
          firstName: String(item.client || "").split(" ")[0] || "",
          serviceNames: names,
        };
      }
    }
  }
  return null;
}

export default async (req) => {
  try {
    const url = new URL(req.url);

    if (req.method === "GET") {
      const token = url.searchParams.get("t");
      if (!validToken(token)) return json({ found: false });
      const b = await findBooking(token);
      if (!b) return json({ found: false });
      const prev = await withNamedStore("confirmations", (s) => s.get(token, { type: "json" }));
      const answered = prev && prev.date === b.dayKey && prev.start === b.start ? prev.response : null;
      return json({ found: true, ...b, answered });
    }

    if (req.method === "POST") {
      const raw = await req.text();
      if (raw.length > 2000) return json({ error: "Too large" }, 413);
      let body;
      try {
        body = JSON.parse(raw);
      } catch {
        return json({ error: "Bad JSON" }, 400);
      }
      const token = body.t;
      const response = body.response === "change" ? "change" : "confirm";
      if (!validToken(token)) return json({ error: "Not found" }, 404);
      const b = await findBooking(token);
      if (!b) return json({ error: "Not found" }, 404);
      await withNamedStore("confirmations", (s) =>
        s.setJSON(token, { response, at: new Date().toISOString(), date: b.dayKey, start: b.start })
      );
      return json({ ok: true, response });
    }

    return json({ error: "Method not allowed" }, 405);
  } catch (e) {
    return json({ error: e.message }, 500);
  }
};
