const { getStore } = require("@netlify/blobs");
const crypto = require("node:crypto");

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method not allowed" };
  }
  try {
    const data = JSON.parse(event.body || "{}");
    const id = crypto.randomUUID();
    const store = getStore({ name: "submissions", consistency: "strong" });
    await store.setJSON(id, {
      ...data,
      id,
      submittedAt: new Date().toISOString(),
    });
    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ok: true, id }),
    };
  } catch (e) {
    return { statusCode: 500, body: JSON.stringify({ error: e.message }) };
  }
};
