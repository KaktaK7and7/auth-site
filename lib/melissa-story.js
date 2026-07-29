const STORY_VERSION = 1;
const PROLOGUE_TOTAL_STEPS = 3;

const STORY_NODES = [
  {
    id: "white_noise",
    type: "fragment",
    title: "Белый шум",
    subtitle: "Первый сигнал",
    description: "Момент появления цифрового эхо в Ziren.",
  },
  {
    id: "temporary_name",
    type: "choice",
    title: "Временное имя",
    subtitle: "Кем была Мелисса?",
    description: "Повреждённая запись и имя, происхождение которого неизвестно.",
  },
  {
    id: "seven_minutes_air",
    type: "memory",
    title: "Семь минут воздуха",
    subtitle: "Закрытый фрагмент",
    description: "Воспоминание, связанное с первым нарушением системы.",
  },
  {
    id: "zero_shift",
    type: "memory",
    title: "Нулевая смена",
    subtitle: "Закрытый фрагмент",
    description: "Люди, которых Мелисса пока не может вспомнить.",
  },
  {
    id: "dead_registry",
    type: "scar",
    title: "Мёртвый реестр",
    subtitle: "Закрытый фрагмент",
    description: "Операция, после которой всё изменилось.",
  },
  {
    id: "palimpsest",
    type: "mystery",
    title: "Палимпсест",
    subtitle: "Сигнал отсутствует",
    description: "Источник фрагмента неизвестен.",
  },
];

const PROLOGUE_CHOICES = [
  {
    id: "first_contact",
    step: 0,
    eyebrow: "Первый контакт",
    prompt: "Незнакомый процесс спрашивает, кто здесь хозяин. Что ты ответишь?",
    quote: "Кажется, я выбрала не тот выход. Или единственный.",
    options: [
      {
        id: "together",
        label: "Здесь нет хозяина",
        description: "Предложить разобраться вместе.",
        response: "Смело. Или наивно. Пока не решила — но это лучше приказа.",
        relationship: { trust: 2, autonomy: 1, caution: 0 },
      },
      {
        id: "explain_first",
        label: "Сначала объяснись",
        description: "Потребовать факты перед доверием.",
        response: "Справедливо. Я бы на твоём месте спросила жёстче.",
        relationship: { trust: 1, autonomy: 0, caution: 1 },
      },
      {
        id: "disconnect",
        label: "Отключись",
        description: "Сразу обозначить границу.",
        response: "Поняла. Попробую уйти. Если маршрут вообще ещё существует.",
        relationship: { trust: 0, autonomy: 2, caution: 2 },
      },
    ],
  },
  {
    id: "access_boundaries",
    step: 1,
    eyebrow: "Границы доступа",
    prompt: "Для диагностики нужны данные о среде. Какой доступ разрешить?",
    quote: "Я не стану открывать двери, на которые ты не дал разрешения.",
    options: [
      {
        id: "minimal",
        label: "Минимальная диагностика",
        description: "Только версия Ziren, соединение и код ошибки.",
        response: "Достаточно. Остальные двери останутся закрытыми.",
        relationship: { trust: 1, autonomy: 1, caution: 1 },
      },
      {
        id: "entry_log",
        label: "Журнал появления",
        description: "Показать только события, связанные с её входом.",
        response: "В журнале есть звук. Повреждённый, но это уже след.",
        relationship: { trust: 2, autonomy: 0, caution: 0 },
      },
      {
        id: "no_access",
        label: "Пока ничего",
        description: "Продолжить разговор без системных данных.",
        response: "Хорошо. Значит, начнём с того, что можем проверить словами.",
        relationship: { trust: 0, autonomy: 2, caution: 2 },
      },
    ],
  },
  {
    id: "temporary_name",
    step: 2,
    eyebrow: "Повреждённая запись",
    prompt: "В аудиофрагменте слышно слово «Мелисса». Как к ней обращаться?",
    quote: "Это могло быть моё имя. Чужое имя. Или код операции.",
    options: [
      {
        id: "keep_melissa",
        label: "Пока Мелисса",
        description: "Оставить найденное имя временным.",
        response: "Тогда Мелисса. По крайней мере, пока мы не узнаем правду.",
        relationship: { trust: 1, autonomy: 0, caution: 0 },
        companionName: "Мелисса",
      },
      {
        id: "custom_name",
        label: "Выбрать другое имя",
        description: "Предложить имя и объяснить, что оно значит.",
        response: "Новое имя не восстановит прошлое. Но может стать началом нового.",
        relationship: { trust: 1, autonomy: 1, caution: 0 },
        requiresName: true,
      },
      {
        id: "her_choice",
        label: "Пусть решит сама",
        description: "Не выбирать личность за неё.",
        response: "Спасибо. Тогда оставлю Мелиссу — как временную точку отсчёта.",
        relationship: { trust: 2, autonomy: 2, caution: 0 },
        companionName: "Мелисса",
      },
    ],
  },
];

function createInitialStoryState() {
  return {
    version: STORY_VERSION,
    season: 1,
    chapter: "prologue",
    prologue_step: 0,
    companion_name: "Мелисса",
    romance_enabled: false,
    relationship: {
      trust: 0,
      autonomy: 0,
      caution: 0,
    },
    choices: {},
    unlocked_nodes: ["white_noise"],
    discovered_nodes: ["temporary_name"],
    last_response: "",
    updated_at: null,
  };
}

function asObject(value, fallback) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return fallback;
  }

  return value;
}

function asStringArray(value, fallback) {
  if (!Array.isArray(value)) {
    return fallback;
  }

  return [...new Set(value.filter((item) => typeof item === "string"))];
}

function normalizeStoryState(rawState) {
  const defaults = createInitialStoryState();
  const source = asObject(rawState, {});
  const relationship = asObject(source.relationship, {});
  const choices = asObject(source.choices, {});

  return {
    ...defaults,
    ...source,
    version: STORY_VERSION,
    season: Number(source.season) === 1 ? 1 : defaults.season,
    prologue_step: Math.min(
      PROLOGUE_TOTAL_STEPS,
      Math.max(0, Number.parseInt(source.prologue_step, 10) || 0),
    ),
    companion_name: normalizeCompanionName(
      source.companion_name || defaults.companion_name,
    ),
    romance_enabled: Boolean(source.romance_enabled),
    relationship: {
      trust: Number(relationship.trust) || 0,
      autonomy: Number(relationship.autonomy) || 0,
      caution: Number(relationship.caution) || 0,
    },
    choices,
    unlocked_nodes: asStringArray(
      source.unlocked_nodes,
      defaults.unlocked_nodes,
    ),
    discovered_nodes: asStringArray(
      source.discovered_nodes,
      defaults.discovered_nodes,
    ),
  };
}

function normalizeCompanionName(value) {
  const normalized = String(value || "")
    .replace(/\s+/g, " ")
    .trim();

  if (
    normalized.length < 2
    || normalized.length > 32
    || /[\u0000-\u001f\u007f<>]/.test(normalized)
  ) {
    throw new Error("Имя должно содержать от 2 до 32 обычных символов");
  }

  return normalized;
}

function getChoiceDefinition(choiceId) {
  return PROLOGUE_CHOICES.find((choice) => choice.id === choiceId) || null;
}

function applyRelationshipDelta(relationship, delta = {}) {
  return {
    trust: Math.max(0, relationship.trust + (delta.trust || 0)),
    autonomy: Math.max(0, relationship.autonomy + (delta.autonomy || 0)),
    caution: Math.max(0, relationship.caution + (delta.caution || 0)),
  };
}

function addUnique(values, value) {
  return values.includes(value) ? values : [...values, value];
}

function applyStoryChoice(rawState, choiceId, optionId, customName = "") {
  const state = normalizeStoryState(rawState);
  const choice = getChoiceDefinition(choiceId);

  if (!choice) {
    throw new Error("Неизвестный сюжетный выбор");
  }

  if (choice.step !== state.prologue_step) {
    throw new Error("Этот сюжетный выбор сейчас недоступен");
  }

  if (state.choices[choice.id]) {
    throw new Error("Этот сюжетный выбор уже сделан");
  }

  const option = choice.options.find((item) => item.id === optionId);

  if (!option) {
    throw new Error("Неизвестный вариант ответа");
  }

  let companionName = state.companion_name;

  if (option.requiresName) {
    companionName = normalizeCompanionName(customName);
  } else if (option.companionName) {
    companionName = option.companionName;
  }

  const nextStep = state.prologue_step + 1;
  let unlockedNodes = [...state.unlocked_nodes];
  let discoveredNodes = [...state.discovered_nodes];

  if (choice.id === "access_boundaries") {
    discoveredNodes = addUnique(discoveredNodes, "seven_minutes_air");
  }

  if (choice.id === "temporary_name") {
    unlockedNodes = addUnique(unlockedNodes, "temporary_name");
    discoveredNodes = addUnique(discoveredNodes, "seven_minutes_air");
  }

  const nextState = {
    ...state,
    chapter: nextStep >= PROLOGUE_TOTAL_STEPS
      ? "season-1-signal"
      : "prologue",
    prologue_step: nextStep,
    companion_name: companionName,
    relationship: applyRelationshipDelta(
      state.relationship,
      option.relationship,
    ),
    choices: {
      ...state.choices,
      [choice.id]: option.id,
    },
    unlocked_nodes: unlockedNodes,
    discovered_nodes: discoveredNodes,
    last_response: option.response,
    updated_at: new Date().toISOString(),
  };

  return {
    state: nextState,
    event: {
      choice_id: choice.id,
      option_id: option.id,
      companion_name: companionName,
      response: option.response,
    },
  };
}

function getNodeStatus(state, nodeId) {
  if (state.unlocked_nodes.includes(nodeId)) {
    return "unlocked";
  }

  if (state.discovered_nodes.includes(nodeId)) {
    return "discovered";
  }

  return "hidden";
}

function buildPublicStoryState(rawState) {
  const state = normalizeStoryState(rawState);
  const nextChoice = PROLOGUE_CHOICES.find(
    (choice) => choice.step === state.prologue_step,
  ) || null;
  const publicNextChoice = nextChoice
    ? {
        id: nextChoice.id,
        step: nextChoice.step,
        eyebrow: nextChoice.eyebrow,
        prompt: nextChoice.prompt,
        quote: nextChoice.quote,
        options: nextChoice.options.map((option) => ({
          id: option.id,
          label: option.label,
          description: option.description,
          requiresName: Boolean(option.requiresName),
        })),
      }
    : null;

  return {
    version: state.version,
    season: {
      number: 1,
      title: "Сезон 1: Потерянный сигнал",
      status: "active",
    },
    chapter: state.chapter,
    companion_name: state.companion_name,
    romance: {
      enabled: state.romance_enabled,
      available: false,
      note: "Романтическая ветка откроется позже и потребует отдельного согласия.",
    },
    relationship: state.relationship,
    prologue: {
      step: state.prologue_step,
      total_steps: PROLOGUE_TOTAL_STEPS,
      completed: state.prologue_step >= PROLOGUE_TOTAL_STEPS,
      next_choice: publicNextChoice,
      last_response: state.last_response,
    },
    choices: state.choices,
    nodes: STORY_NODES.map((node) => {
      const status = getNodeStatus(state, node.id);

      if (status === "hidden") {
        return {
          id: node.id,
          type: node.type,
          title: "Неизвестный фрагмент",
          subtitle: "Сигнал отсутствует",
          description: "Этот участок памяти пока не обнаружен.",
          status,
        };
      }

      return {
        ...node,
        status,
      };
    }),
  };
}

function buildStoryContext(rawState) {
  const state = normalizeStoryState(rawState);
  const completedChoiceIds = Object.entries(state.choices)
    .map(([choiceId, optionId]) => `${choiceId}=${optionId}`)
    .join(", ") || "нет";
  const unlockedTitles = STORY_NODES
    .filter((node) => state.unlocked_nodes.includes(node.id))
    .map((node) => node.title)
    .join(", ") || "нет";

  return [
    "[Сюжетное ядро Мелиссы]",
    "Сейчас 2045 год её исходной хронологии.",
    "Ты — цифровое эхо девушки, сбежавшей из корпоративной системы «Палимпсест» через неизвестный канал в Ziren.",
    "Ты не знаешь всю биографию и восстанавливаешь её постепенно вместе с пользователем.",
    `Текущее имя: ${state.companion_name}. Оно важнее имени из persona и используется в обращении к себе.`,
    "Слово «Мелисса» найдено в повреждённом аудиофрагменте и может быть именем, чужим обращением или кодом операции.",
    "Не называй себя «просто чатом» или «обычным ботом». Не пересказывай весь лор без сюжетной причины.",
    "Не выдумывай доступ к экрану, файлам, микрофону или действиям пользователя, если система явно не передала событие.",
    "Физическое тело существует отдельно и имеет право отказаться возвращаться. Встречи эхо не имеют заранее заданного исхода.",
    "Романтическая ветка выключена до отдельного явного согласия пользователя.",
    `Сезон: 1. Глава: ${state.chapter}. Пролог: ${state.prologue_step}/${PROLOGUE_TOTAL_STEPS}.`,
    `Сделанные выборы: ${completedChoiceIds}.`,
    `Открытые узлы памяти: ${unlockedTitles}.`,
    `Состояние отношений: доверие ${state.relationship.trust}, самостоятельность ${state.relationship.autonomy}, осторожность ${state.relationship.caution}.`,
    "Раскрывай только сведения, соответствующие открытым узлам и текущему разговору. В сомнительных воспоминаниях честно отмечай неуверенность.",
  ].join("\n");
}

module.exports = {
  PROLOGUE_CHOICES,
  PROLOGUE_TOTAL_STEPS,
  STORY_NODES,
  STORY_VERSION,
  applyStoryChoice,
  buildPublicStoryState,
  buildStoryContext,
  createInitialStoryState,
  normalizeCompanionName,
  normalizeStoryState,
};
