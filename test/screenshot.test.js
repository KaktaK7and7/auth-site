const test = require("node:test");
const assert = require("node:assert/strict");

const {
  MAX_SCREENSHOT_BYTES,
  SCREENSHOT_DATA_URL_PREFIX,
  validateScreenshotDataUrl,
} = require("../lib/screenshot");


test("accepts a bounded JPEG data URL", () => {
  const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
  const value = `${SCREENSHOT_DATA_URL_PREFIX}${jpeg.toString("base64")}`;

  assert.equal(validateScreenshotDataUrl(value), value);
});


test("rejects non-JPEG and oversized screenshot payloads", () => {
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
  const oversized = Buffer.concat([
    Buffer.from([0xff, 0xd8, 0xff]),
    Buffer.alloc(MAX_SCREENSHOT_BYTES),
  ]);

  assert.equal(
    validateScreenshotDataUrl(
      `${SCREENSHOT_DATA_URL_PREFIX}${png.toString("base64")}`,
    ),
    null,
  );
  assert.equal(
    validateScreenshotDataUrl(
      `${SCREENSHOT_DATA_URL_PREFIX}${oversized.toString("base64")}`,
    ),
    null,
  );
  assert.equal(validateScreenshotDataUrl("https://example.test/image.jpg"), null);
});
