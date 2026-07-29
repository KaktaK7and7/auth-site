const test = require("node:test");
const assert = require("node:assert/strict");

const { sendApiNotFound } = require("../lib/api-response");


test("unknown API routes always return a JSON 404", () => {
  const result = {};
  const response = {
    status(code) {
      result.status = code;
      return this;
    },
    json(payload) {
      result.payload = payload;
      return this;
    },
  };

  sendApiNotFound({}, response);

  assert.equal(result.status, 404);
  assert.deepEqual(result.payload, {
    ok: false,
    error: "API route not found",
  });
});
