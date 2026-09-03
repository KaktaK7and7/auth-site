const assert = require("node:assert/strict");
const express = require("express");
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const test = require("node:test");

const {
  createSocialRouter,
  listFriends,
} = require("../lib/social-router");

function makeMessagePool(friendshipStatus) {
  const state = { insertCalls: 0 };
  const pool = {
    state,
    async query(sql) {
      const text = String(sql);
      if (text.includes("FROM friendships") && text.includes("WHERE user_low_id")) {
        if (!friendshipStatus) return { rows: [] };
        return {
          rows: [{
            id: 90,
            user_low_id: 1,
            user_high_id: 2,
            requested_by: 1,
            status: friendshipStatus,
          }],
        };
      }

      if (text.includes("INSERT INTO direct_messages")) {
        state.insertCalls += 1;
        return {
          rows: [{
            id: 101,
            sender_id: 1,
            recipient_id: 2,
            kind: "text",
            body: "привет",
            created_at: "2026-08-24T00:00:00Z",
            read_at: null,
            attachment_public_id: null,
            attachment_format: null,
          }],
        };
      }

      throw new Error(`Unexpected SQL in social release test: ${text}`);
    },
  };
  return pool;
}

async function withSocialServer(pool, callback) {
  const app = express();
  app.use(express.json());
  app.use(
    "/api/social",
    createSocialRouter({
      pool,
      cloudinary: { uploader: {} },
      resolveUser: async () => ({ id: 1, username: "Sender" }),
    }),
  );

  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const baseUrl = `http://127.0.0.1:${address.port}`;

  try {
    return await callback(baseUrl);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

async function postText(baseUrl) {
  return fetch(`${baseUrl}/api/social/messages`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      recipient_id: 2,
      kind: "text",
      body: "привет",
    }),
  });
}


test("pending friendship is rejected before direct-message INSERT", async () => {
  const pool = makeMessagePool("pending");

  const response = await withSocialServer(pool, postText);
  const body = await response.json();

  assert.equal(response.status, 403);
  assert.match(body.error, /не находится.*в друзьях/i);
  assert.equal(pool.state.insertCalls, 0);
});


test("missing friendship is rejected before direct-message INSERT", async () => {
  const pool = makeMessagePool(null);

  const response = await withSocialServer(pool, postText);

  assert.equal(response.status, 403);
  assert.equal(pool.state.insertCalls, 0);
});


test("accepted friendship is required for direct text and clipboard message route", async () => {
  const pool = makeMessagePool("accepted");

  const response = await withSocialServer(pool, postText);
  const body = await response.json();

  assert.equal(response.status, 201);
  assert.equal(body.ok, true);
  assert.equal(body.message.recipient_id, 2);
  assert.equal(pool.state.insertCalls, 1);
});


test("friends list SQL exposes accepted relations only", async () => {
  let seenSql = "";
  const pool = {
    async query(sql) {
      seenSql = String(sql);
      return { rows: [] };
    },
  };

  const friends = await listFriends(pool, 1);

  assert.deepEqual(friends, []);
  assert.match(seenSql, /WHERE relation\.status = 'accepted'/);
});


test("binary screenshot route verifies accepted friendship before cloud upload", () => {
  const source = fs.readFileSync(
    path.join(__dirname, "..", "lib", "api-response.js"),
    "utf8",
  );
  const start = source.indexOf("async function sendSocialScreenshot");
  const end = source.indexOf("async function sendSafeAnnouncements", start);
  assert.ok(start >= 0 && end > start);

  const screenshotFunction = source.slice(start, end);
  const friendshipCheck = screenshotFunction.indexOf("requireSocialFriend");
  const cloudUpload = screenshotFunction.indexOf("uploadMessageScreenshot");

  assert.ok(friendshipCheck >= 0, "screenshot route must verify friendship");
  assert.ok(cloudUpload > friendshipCheck, "cloud upload must happen only after friendship check");

  const friendGuardStart = source.indexOf("async function requireSocialFriend");
  const friendGuardEnd = source.indexOf("async function sendSocialScreenshot", friendGuardStart);
  const friendGuard = source.slice(friendGuardStart, friendGuardEnd);
  assert.match(friendGuard, /status = 'accepted'/);
});
