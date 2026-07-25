const test = require("node:test");
const assert = require("node:assert/strict");

const {
  buildProfileSummary,
  buildUserPayload,
} = require("../lib/profile");
const { renderProfilePage } = require("../lib/profile-page");


const baseUser = {
  id: 7,
  username: "Vlad",
  email: "vlad@example.com",
  avatar_url: "/images/Ziren.png",
  created_at: "2026-07-01T00:00:00.000Z",
  last_login_at: "2026-07-25T08:00:00.000Z",
  bio: "Создаю Ziren",
  status_text: "В разработке",
  public_profile_enabled: true,
  show_in_community: true,
  activity_tracking_enabled: false,
  ai_context_enabled: false,
};


test("profile summary derives levels and achievements from real command counts", () => {
  const summary = buildProfileSummary(
    baseUser,
    {
      total_commands: 25,
      distinct_commands: 5,
    },
    new Date("2026-07-25T00:00:00.000Z"),
  );

  assert.equal(summary.level, 2);
  assert.equal(summary.level_progress_percent, 0);
  assert.equal(summary.commands_to_next_level, 25);
  assert.equal(summary.member_days, 24);
  assert.equal(summary.achievements_unlocked, 4);
  assert.equal(summary.achievements_total, 5);
});


test("desktop profile payload keeps consent settings explicit", () => {
  const payload = buildUserPayload(baseUser, {
    total_commands: 0,
    distinct_commands: 0,
  });

  assert.equal(payload.id, "7");
  assert.equal(payload.public_profile_url, "/community/7");
  assert.equal(payload.show_in_community, true);
  assert.equal(payload.activity_tracking_enabled, false);
  assert.equal(payload.ai_context_enabled, false);
  assert.equal(payload.stats.level, 1);
});


test("profile page escapes user-controlled fields and hides private email publicly", () => {
  const maliciousUser = {
    ...baseUser,
    username: `<script>alert("x")</script>`,
    email: "private@example.com",
    bio: `<img src=x onerror="alert(1)">`,
  };
  const summary = buildProfileSummary(maliciousUser, {});
  const html = renderProfilePage({
    user: maliciousUser,
    summary,
    publicView: true,
  });

  assert.equal(html.includes(`<script>alert("x")</script>`), false);
  assert.equal(html.includes(`<img src=x onerror="alert(1)">`), false);
  assert.equal(html.includes("private@example.com"), false);
  assert.match(html, /&lt;script&gt;alert\(&quot;x&quot;\)&lt;\/script&gt;/);
});
