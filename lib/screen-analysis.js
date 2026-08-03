const SCREEN_MODES = new Set([
  "explain",
  "translate",
  "guide",
  "annotate",
]);
const ANNOTATION_KINDS = new Set([
  "target",
  "step",
  "text",
  "warning",
]);
// JavaScript word boundaries are ASCII-only, so `\b` cannot reliably protect
// Cyrillic action names. Keep an explicit, conservative denylist instead.
const RISKY_ACTION_MARKERS = [
  "удал",
  "стер",
  "оплат",
  "купить",
  "покуп",
  "отправ",
  "опубликов",
  "парол",
  "разрешени",
  "установ",
  "деинсталл",
  "форматир",
  "сброс",
  "безопасност",
  "delete",
  "remove",
  "payment",
  "pay",
  "buy",
  "purchase",
  "send",
  "publish",
  "password",
  "permission",
  "install",
  "uninstall",
  "format",
  "reset",
];


function cleanSingleLine(value, limit) {
  return String(value || "")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, limit);
}


function normalizedNumber(value) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return null;
  }
  return value >= 0 && value <= 1 ? value : null;
}


function hasRiskyAction(value) {
  const text = cleanSingleLine(value, 1000).toLocaleLowerCase("ru-RU");
  return RISKY_ACTION_MARKERS.some((marker) => text.includes(marker));
}


function normalizeAnnotations(value) {
  if (!Array.isArray(value)) return [];

  const result = [];
  const ids = new Set();

  for (const raw of value.slice(0, 8)) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) continue;

    const id = cleanSingleLine(raw.id, 40);
    const label = cleanSingleLine(raw.label, 100);
    const kind = cleanSingleLine(raw.kind, 20).toLowerCase();
    const x = normalizedNumber(raw.x);
    const y = normalizedNumber(raw.y);
    let width = normalizedNumber(raw.width);
    let height = normalizedNumber(raw.height);

    if (
      !id
      || ids.has(id)
      || !label
      || !ANNOTATION_KINDS.has(kind)
      || x === null
      || y === null
      || width === null
      || height === null
    ) {
      continue;
    }

    width = Math.min(width, 1 - x);
    height = Math.min(height, 1 - y);
    if (width < 0.005 || height < 0.005) continue;

    ids.add(id);
    result.push({
      id,
      label,
      kind,
      x,
      y,
      width,
      height,
      step: Number.isInteger(raw.step)
        ? Math.max(0, Math.min(8, raw.step))
        : 0,
    });
  }

  return result;
}


function normalizeScreenAnalysisResponse(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const answer = String(value.answer || "").trim().slice(0, 5000);
  const sessionId = value.session_id;
  const requestedMode = cleanSingleLine(value.mode, 20).toLowerCase();
  const mode = SCREEN_MODES.has(requestedMode) ? requestedMode : "explain";

  if (!answer || !Number.isInteger(sessionId) || sessionId < 0) {
    return null;
  }

  const annotations = normalizeAnnotations(value.annotations);
  const annotationById = new Map(
    annotations.map((item) => [item.id, item]),
  );
  const rawAction = value.action;
  let action = {
    type: "none",
    target_id: "",
    label: "",
    risk: "blocked",
    reason: "Действие не предложено.",
  };

  if (rawAction && typeof rawAction === "object" && !Array.isArray(rawAction)) {
    const targetId = cleanSingleLine(rawAction.target_id, 40);
    const label = cleanSingleLine(rawAction.label, 100);
    const reason = cleanSingleLine(rawAction.reason, 240);
    const target = annotationById.get(targetId);
    const risky = hasRiskyAction(
      `${label} ${target?.label || ""} ${reason}`,
    );
    const canClick = rawAction.type === "click"
      && rawAction.risk === "safe"
      && target
      && ["target", "step"].includes(target.kind)
      && !risky;

    action = {
      type: canClick ? "click" : "none",
      target_id: canClick ? targetId : "",
      label,
      risk: canClick ? "safe" : "blocked",
      reason: reason || (
        canClick
          ? "Одно обратимое нажатие после подтверждения."
          : "Действие не прошло проверку шлюза."
      ),
    };
  }

  return {
    answer,
    session_id: sessionId,
    memory_updated: false,
    summary_updated: false,
    memory_logs: [],
    story_signal: null,
    drawing_request: null,
    mode,
    annotations,
    action,
  };
}


module.exports = {
  normalizeScreenAnalysisResponse,
};
