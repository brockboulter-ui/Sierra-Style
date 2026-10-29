import { getStore } from "@netlify/blobs";

const STORE = "sierra-state";
const KEY = "state";

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });

// Set ADMIN_PIN in Netlify (Project configuration > Environment variables) to
// choose your own code. Until you do, the code below is used.
const isAdmin = (req) => {
  const given = (req.headers.get("x-admin-pin") || "").trim().toUpperCase();
  const real = (process.env.ADMIN_PIN || "SIERRA1").trim().toUpperCase();
  return given.length > 0 && given === real;
};

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

// Read/write with strong consistency when this environment supports it, so a
// change Sierra saves is what everyone reads next. Falls back if it doesn't.
async function withStore(fn) {
  try {
    return await fn(getStore({ name: STORE, consistency: "strong" }));
  } catch (e) {
    if (String((e && e.message) || "").includes("uncachedEdgeURL")) {
      return await fn(getStore(STORE));
    }
    throw e;
  }
}

// Answers clients gave by tapping the link in Sierra's confirmation text.
async function readConfirmations() {
  const out = {};
  try {
    await withNamedStore("confirmations", async (store) => {
      const { blobs } = await store.list();
      for (const b of blobs) {
        const v = await store.get(b.key, { type: "json" });
        if (v) out[b.key] = v;
      }
    });
  } catch (e) {
    /* none yet */
  }
  return out;
}

const str = (v, max) => (typeof v === "string" ? v.slice(0, max) : "");
const isObj = (v) => v && typeof v === "object" && !Array.isArray(v);

// What a client (no login) is allowed to see: open days, hours, services,
// and the times Sierra has blocked off. Never names, phones or appointments.
function publicView(s) {
  const blocksByDay = {};
  for (const [day, items] of Object.entries(s.itemsByDay || {})) {
    const blocks = (Array.isArray(items) ? items : [])
      .filter((i) => i && i.type === "block")
      .map((i) => ({ start: i.start, end: i.end }));
    if (blocks.length) blocksByDay[day] = blocks;
  }
  const releasedDays = {};
  for (const [day, on] of Object.entries(s.releasedDays || {})) {
    if (on) releasedDays[day] = true;
  }
  // Announcements clients can see: not expired yet, newest first.
  const todayStr = new Date().toISOString().slice(0, 10);
  const announcements = (Array.isArray(s.announcements) ? s.announcements : [])
    .filter((a) => a && (a.title || a.body) && !(a.expires && a.expires < todayStr))
    .map((a) => ({ id: a.id, title: a.title || "", body: a.body || "", createdAt: a.createdAt || "" }))
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
    .slice(0, 20);
  return {
    initialized: true,
    announcements,
    services: (s.services || []).map((x) => ({ id: x.id, name: x.name, price: x.price })),
    hours: s.hours,
    hourOverrides: s.hourOverrides || {},
    releasedDays,
    blocksByDay,
  };
}

export default async (req) => {
  try {
    const url = new URL(req.url);

    if (req.method === "GET") {
      const wantsAdmin = url.searchParams.get("admin") === "1";
      if (wantsAdmin && !isAdmin(req)) return json({ error: "Wrong code" }, 401);

      const saved = await withStore((store) => store.get(KEY, { type: "json" }));
      if (!saved) return json({ initialized: false, rev: 0 });
      if (wantsAdmin) return json({ ...saved, initialized: true, confirmations: await readConfirmations() });
      return json(publicView(saved));
    }

    if (req.method === "POST") {
      if (!isAdmin(req)) return json({ error: "Wrong code" }, 401);

      const raw = await req.text();
      if (raw.length > 4_000_000) return json({ error: "Too large" }, 413);
      let body;
      try {
        body = JSON.parse(raw);
      } catch {
        return json({ error: "Bad JSON" }, 400);
      }

      const services = Array.isArray(body.services) ? body.services : null;
      const hours = Array.isArray(body.hours) && body.hours.length === 7 ? body.hours : null;
      if (!services || !hours || !isObj(body.hourOverrides) || !isObj(body.releasedDays) || !isObj(body.itemsByDay) || !Array.isArray(body.clients)) {
        return json({ error: "Missing fields" }, 400);
      }

      const next = {
        services: services.slice(0, 50).map((s) => ({
          id: str(s && s.id, 80),
          name: str(s && s.name, 120),
          price: str(s && s.price, 40),
        })),
        hours,
        hourOverrides: body.hourOverrides,
        releasedDays: body.releasedDays,
        itemsByDay: body.itemsByDay,
        clients: body.clients,
        announcements: [],
        updatedAt: new Date().toISOString(),
      };

      const rev = await withStore(async (store) => {
        const prev = await store.get(KEY, { type: "json" });
        const newRev = ((prev && prev.rev) || 0) + 1;
        // An older copy of the page (opened before this update) doesn't send
        // announcements — keep what's saved rather than wiping them.
        const announcements = Array.isArray(body.announcements)
          ? body.announcements.slice(0, 50).map((a) => ({
              id: str(a && a.id, 80),
              title: str(a && a.title, 100),
              body: str(a && a.body, 1000),
              createdAt: str(a && a.createdAt, 40),
              expires: str(a && a.expires, 10),
            }))
          : (prev && prev.announcements) || [];
        await store.setJSON(KEY, { ...next, announcements, rev: newRev });
        return newRev;
      });
      return json({ ok: true, rev });
    }

    return json({ error: "Method not allowed" }, 405);
  } catch (e) {
    return json({ error: e.message }, 500);
  }
};
