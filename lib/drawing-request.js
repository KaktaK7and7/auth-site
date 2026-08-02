const DRAWING_KINDS = new Set(["sketch", "technical", "story"]);


function cleanSingleLine(value, limit) {
  return String(value || "")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, limit);
}


function normalizeDrawingRequest(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const requestedKind = cleanSingleLine(value.kind, 20).toLowerCase();
  const kind = DRAWING_KINDS.has(requestedKind)
    ? requestedKind
    : "sketch";
  const title = cleanSingleLine(value.title, 80);
  const prompt = cleanSingleLine(value.prompt, 1600);
  const completionLine = cleanSingleLine(value.completion_line, 240);

  if (!title || prompt.length < 3) {
    return null;
  }

  return {
    kind,
    title,
    prompt,
    story_relevant: Boolean(value.story_relevant) || kind === "story",
    completion_line: completionLine,
  };
}


module.exports = {
  DRAWING_KINDS,
  normalizeDrawingRequest,
};
