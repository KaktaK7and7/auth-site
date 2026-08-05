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
const MIN_TARGET_CONFIDENCE = 0.78;
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
const SCREEN_CLICK_REQUEST_RE = /(?:^|[^\p{L}\p{N}_])(?:нажми|нажимай|нажать|кликни|кликай|кликнуть|щёлкни|щелкни|открой|выбери|перейди)(?=$|[^\p{L}\p{N}_])/iu;
const TARGET_IGNORED_TOKENS = new Set([
  "нажми", "нажимай", "нажать", "кликни", "кликай", "кликнуть",
  "открой", "выбери", "перейди", "кнопка", "кнопку", "пункт",
  "экран", "экране", "мой", "моя", "мою", "твой", "твоя",
  "эту", "этот", "туда", "сюда", "покажи", "укажи", "точно",
  "где", "это", "этот", "эта", "находится", "найди", "посмотри",
]);


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


function normalizedConfidence(value) {
  if (value === undefined || value === null) return 1;
  return normalizedNumber(value);
}


function hasRiskyAction(value) {
  const text = cleanSingleLine(value, 1000).toLocaleLowerCase("ru-RU");
  return RISKY_ACTION_MARKERS.some((marker) => text.includes(marker));
}


function targetTokens(value) {
  return cleanSingleLine(value, 1000)
    .toLocaleLowerCase("ru-RU")
    .match(/[a-zа-яё0-9_]+/giu)
    ?.filter((token) => token.length >= 3 && !TARGET_IGNORED_TOKENS.has(token))
    || [];
}


function tokensMatch(left, right) {
  const prefixLength = Math.min(6, left.length, right.length);
  return prefixLength >= 3 && (
    left.slice(0, prefixLength) === right.slice(0, prefixLength)
    || left.includes(right)
    || right.includes(left)
  );
}


function targetScore(query, label) {
  const queryTokens = targetTokens(query);
  const labelTokens = targetTokens(label);
  let score = 0;

  for (const queryToken of queryTokens) {
    if (labelTokens.some((labelToken) => tokensMatch(queryToken, labelToken))) {
      score += 1;
    }
  }

  return score;
}


function lexicalTargetConfidence(query, label) {
  const queryTokens = targetTokens(query);
  const labelTokens = targetTokens(label);
  if (queryTokens.length === 0 || labelTokens.length === 0) return 1;

  const hasStrongMatch = queryTokens.some((queryToken) => (
    labelTokens.some((labelToken) => tokensMatch(queryToken, labelToken))
  ));
  return hasStrongMatch ? 1 : 0;
}


function findUniqueClickTarget(annotations, query) {
  const candidates = annotations.filter(
    (item) => ["target", "step"].includes(item.kind)
      && item.confidence >= MIN_TARGET_CONFIDENCE
      && item.width <= 0.4
      && item.height <= 0.3,
  );
  const ranked = candidates
    .map((item) => ({ item, score: targetScore(query, item.label) }))
    .sort((left, right) => right.score - left.score);

  if (ranked.length === 1) return ranked[0].item;
  if (
    ranked.length > 1
    && ranked[0].score > 0
    && ranked[0].score > ranked[1].score
  ) {
    return ranked[0].item;
  }
  return null;
}


function normalizeAnnotations(value, message = "") {
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
    const upstreamConfidence = normalizedConfidence(raw.confidence);

    if (
      !id
      || ids.has(id)
      || !label
      || !ANNOTATION_KINDS.has(kind)
      || x === null
      || y === null
      || width === null
      || height === null
      || upstreamConfidence === null
    ) {
      continue;
    }

    width = Math.min(width, 1 - x);
    height = Math.min(height, 1 - y);
    if (width < 0.005 || height < 0.005) continue;

    const confidence = ["target", "step"].includes(kind)
      ? Math.min(
        upstreamConfidence,
        lexicalTargetConfidence(message, label),
      )
      : upstreamConfidence;

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
      confidence,
    });
  }

  return result;
}


function normalizeScreenAnalysisResponse(value, context = {}) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  let answer = String(value.answer || "").trim().slice(0, 5000);
  const sessionId = value.session_id;
  const requestedMode = cleanSingleLine(value.mode, 20).toLowerCase();
  const mode = SCREEN_MODES.has(requestedMode) ? requestedMode : "explain";
  const message = cleanSingleLine(context.message, 1200);

  if (!answer || !Number.isInteger(sessionId) || sessionId < 0) {
    return null;
  }

  const annotations = normalizeAnnotations(value.annotations, message);
  const annotationById = new Map(
    annotations.map((item) => [item.id, item]),
  );
  const rawAction = value.action;
  const clickRequested = SCREEN_CLICK_REQUEST_RE.test(message);
  const requestIsRisky = hasRiskyAction(message);
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
    let target = annotationById.get(targetId);
    if (target && target.confidence < MIN_TARGET_CONFIDENCE) {
      target = null;
    }
    if (!target && clickRequested && !requestIsRisky) {
      target = findUniqueClickTarget(
        annotations,
        `${message} ${label}`,
      );
    }
    const risky = hasRiskyAction(
      `${message} ${label} ${target?.label || ""} ${reason}`,
    );
    const upstreamAllowsClick = rawAction.type === "click"
      && rawAction.risk === "safe";
    const repairedExplicitClick = clickRequested
      && !requestIsRisky
      && target;
    const canClick = (upstreamAllowsClick || repairedExplicitClick)
      && target
      && ["target", "step"].includes(target.kind)
      && target.confidence >= MIN_TARGET_CONFIDENCE
      && target.width <= 0.4
      && target.height <= 0.3
      && !risky;

    if (canClick && /(?:не могу|не умею)[^.!?]{0,45}наж/iu.test(answer)) {
      answer = `Вижу цель — нажимаю «${label || target.label}».`;
    }

    action = {
      type: canClick ? "click" : "none",
      target_id: canClick ? target.id : "",
      label: label || target?.label || "",
      risk: canClick ? "safe" : "blocked",
      reason: reason || (
        canClick
          ? "Одно нажатие по явной команде пользователя."
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
  MIN_TARGET_CONFIDENCE,
  normalizeScreenAnalysisResponse,
};
