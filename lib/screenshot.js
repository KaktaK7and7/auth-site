const SCREENSHOT_DATA_URL_PREFIX = "data:image/jpeg;base64,";
const MAX_SCREENSHOT_BYTES = 1_250_000;


function validateScreenshotDataUrl(value) {
  if (
    typeof value !== "string"
    || !value.startsWith(SCREENSHOT_DATA_URL_PREFIX)
  ) {
    return null;
  }

  const encoded = value.slice(SCREENSHOT_DATA_URL_PREFIX.length);

  if (!encoded || !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) {
    return null;
  }

  const bytes = Buffer.from(encoded, "base64");

  if (
    bytes.length < 4
    || bytes.length > MAX_SCREENSHOT_BYTES
    || bytes[0] !== 0xff
    || bytes[1] !== 0xd8
    || bytes[2] !== 0xff
  ) {
    return null;
  }

  return value;
}


module.exports = {
  MAX_SCREENSHOT_BYTES,
  SCREENSHOT_DATA_URL_PREFIX,
  validateScreenshotDataUrl,
};
