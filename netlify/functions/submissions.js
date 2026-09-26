const { getStore } = require("@netlify/blobs");

exports.handler = async (event) => {
  if (event.httpMethod !== "GET") {
    return { statusCode: 405, body: "Method not allowed" };
  }
  try {
    const store = getStore({ name: "submissions", consistency: "strong" });
    const { blobs } = await store.list();
    const items = await Promise.all(
      blobs.map((b) => store.get(b.key, { type: "json" }))
    );
    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(items.filter(Boolean)),
    };
  } catch (e) {
    return { statusCode: 500, body: JSON.stringify({ error: e.message }) };
  }
};
