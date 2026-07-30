const MAX_ACTIVITY_ITEMS = 8;
const DEFAULT_CAPABILITIES = [
  {
    feature_id: "system.app_launcher",
    display_name: "Запуск приложений",
    actions: ["Запустить приложение или игру"],
  },
  {
    feature_id: "system.media_control",
    display_name: "Управление музыкой",
    actions: [
      "Пауза",
      "Продолжить",
      "Следующий трек",
      "Предыдущий трек",
      "Остановить музыку",
      "Открыть музыкальный сценарий",
    ],
  },
  {
    feature_id: "system.volume",
    display_name: "Управление громкостью",
    actions: [
      "Громче",
      "Тише",
      "Выключить или включить звук",
      "Установить уровень громкости",
    ],
  },
  {
    feature_id: "system.window_control",
    display_name: "Управление окнами",
    actions: [
      "Закрыть",
      "Свернуть",
      "Развернуть",
      "Показать окно",
      "Показать рабочий стол",
    ],
  },
];

function cleanText(value, maxLength) {
  return String(value || "")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
}

function normalizeCapabilities(rawCapabilities) {
  if (!Array.isArray(rawCapabilities)) {
    return [];
  }

  return rawCapabilities
    .slice(0, 24)
    .map((capability) => ({
      feature_id: cleanText(capability?.feature_id, 100).toLowerCase(),
      display_name: cleanText(capability?.display_name, 100),
      actions: Array.isArray(capability?.actions)
        ? capability.actions
            .slice(0, 16)
            .map((action) => cleanText(action, 100))
            .filter(Boolean)
        : [],
    }))
    .filter(
      (capability) => capability.feature_id && capability.display_name,
    );
}

function buildCapabilityContext(rawCapabilities) {
  const normalized = normalizeCapabilities(rawCapabilities);
  const capabilities = normalized.length
    ? normalized
    : DEFAULT_CAPABILITIES;

  return [
    "[Локальные функции Ziren]",
    "Я знаю, что эти функции доступны на компьютере. Выполняет их локальное ядро после явной команды пользователя.",
    ...capabilities.map((capability) => {
      const actions = capability.actions.length
        ? `: ${capability.actions.join(", ")}`
        : "";
      return `- ${capability.display_name} (${capability.feature_id})${actions}`;
    }),
    "Я не утверждаю, что выполнила действие, если локальное ядро не передало подтверждение.",
  ].join("\n");
}

function buildActivityContext(rawEvents) {
  if (!Array.isArray(rawEvents) || !rawEvents.length) {
    return "Недавние разрешённые события отсутствуют.";
  }

  const events = rawEvents.slice(0, MAX_ACTIVITY_ITEMS);
  const lines = [
    "[Недавние действия, которые пользователь разрешил учитывать]",
  ];

  for (const event of events) {
    const featureId = cleanText(event?.feature_id, 100);
    const subject = cleanText(event?.subject_label, 120);
    const eventType = cleanText(event?.event_type, 64);
    const occurredAt = event?.occurred_at
      ? new Date(event.occurred_at).toISOString()
      : "";

    if (!featureId || !eventType) {
      continue;
    }

    lines.push(
      `- ${eventType}; функция=${featureId}`
      + `${subject ? `; контекст=${subject}` : ""}`
      + `${occurredAt ? `; время=${occurredAt}` : ""}`,
    );
  }

  if (lines.length === 1) {
    return "Недавние разрешённые события отсутствуют.";
  }

  lines.push(
    "Используй это только как повод для естественной реплики. Не говори, что ведёшь учёт, читаешь статистику или наблюдаешь за экраном.",
  );

  return lines.join("\n");
}

module.exports = {
  DEFAULT_CAPABILITIES,
  MAX_ACTIVITY_ITEMS,
  buildActivityContext,
  buildCapabilityContext,
  cleanText,
  normalizeCapabilities,
};
