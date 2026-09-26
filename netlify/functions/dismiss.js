const { getStore } = require("@netlify/blobs");

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method not allowed" };
  }
  try {
    const { id } = JSON.parse(event.body || "{}");
    if (!id) return { statusCode: 400, body: "Missing id" };
    const store = getStore({ name: "submissions", consistency: "strong" });
    await store.delete(id);
    return { statusCode: 200, body: JSON.stringify({ ok: true }) };
  } catch (e) {
    return { statusCode: 500, body: JSON.stringify({ error: e.message }) };
  }
};
