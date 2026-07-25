const COMMANDS_PER_LEVEL = 25;


const ACHIEVEMENT_DEFINITIONS = [
  {
    id: "first_contact",
    icon: "◇",
    title: "Первый контакт",
    description: "Создать аккаунт Ziren.",
    isUnlocked: () => true,
  },
  {
    id: "first_command",
    icon: "⌁",
    title: "Голос системы",
    description: "Выполнить первую учтённую команду.",
    isUnlocked: (stats) => stats.totalCommands >= 1,
  },
  {
    id: "five_features",
    icon: "✦",
    title: "Исследователь",
    description: "Использовать пять разных функций.",
    isUnlocked: (stats) => stats.distinctCommands >= 5,
  },
  {
    id: "operator",
    icon: "⬡",
    title: "Оператор",
    description: "Выполнить 25 учтённых команд.",
    isUnlocked: (stats) => stats.totalCommands >= 25,
  },
  {
    id: "centurion",
    icon: "◈",
    title: "Сотня",
    description: "Выполнить 100 учтённых команд.",
    isUnlocked: (stats) => stats.totalCommands >= 100,
  },
];


function toNonNegativeInteger(value) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}


function calculateMemberDays(createdAt, now = new Date()) {
  const createdDate = new Date(createdAt);

  if (Number.isNaN(createdDate.getTime())) {
    return 0;
  }

  const elapsed = Math.max(0, now.getTime() - createdDate.getTime());
  return Math.max(1, Math.ceil(elapsed / (24 * 60 * 60 * 1000)));
}


function buildProfileSummary(user, rawStats = {}, now = new Date()) {
  const totalCommands = toNonNegativeInteger(rawStats.total_commands);
  const distinctCommands = toNonNegativeInteger(rawStats.distinct_commands);
  const level = Math.floor(totalCommands / COMMANDS_PER_LEVEL) + 1;
  const commandsInLevel = totalCommands % COMMANDS_PER_LEVEL;
  const achievements = ACHIEVEMENT_DEFINITIONS.map((definition) => ({
    id: definition.id,
    icon: definition.icon,
    title: definition.title,
    description: definition.description,
    unlocked: definition.isUnlocked({
      totalCommands,
      distinctCommands,
    }),
  }));
  const unlockedAchievements = achievements.filter(
    (achievement) => achievement.unlocked,
  ).length;

  return {
    total_commands: totalCommands,
    distinct_commands: distinctCommands,
    member_days: calculateMemberDays(user.created_at, now),
    level,
    commands_in_level: commandsInLevel,
    commands_to_next_level: COMMANDS_PER_LEVEL - commandsInLevel,
    level_progress_percent: Math.round(
      (commandsInLevel / COMMANDS_PER_LEVEL) * 100,
    ),
    achievements_unlocked: unlockedAchievements,
    achievements_total: achievements.length,
    achievements,
  };
}


function buildUserPayload(user, rawStats = {}, now = new Date()) {
  const summary = buildProfileSummary(user, rawStats, now);

  return {
    id: String(user.id),
    username: user.username,
    email: user.email,
    avatar_url: user.avatar_url || "/images/Ziren.png",
    created_at: user.created_at,
    last_login_at: user.last_login_at,
    bio: user.bio || "",
    status_text: user.status_text || "",
    public_profile_enabled: Boolean(user.public_profile_enabled),
    show_in_community: Boolean(user.show_in_community),
    activity_tracking_enabled: Boolean(user.activity_tracking_enabled),
    ai_context_enabled: Boolean(user.ai_context_enabled),
    public_profile_url: user.public_profile_enabled
      ? `/community/${user.id}`
      : null,
    stats: {
      total_commands: summary.total_commands,
      distinct_commands: summary.distinct_commands,
      member_days: summary.member_days,
      level: summary.level,
      commands_in_level: summary.commands_in_level,
      commands_to_next_level: summary.commands_to_next_level,
      level_progress_percent: summary.level_progress_percent,
      achievements_unlocked: summary.achievements_unlocked,
      achievements_total: summary.achievements_total,
    },
    achievements: summary.achievements,
  };
}


module.exports = {
  ACHIEVEMENT_DEFINITIONS,
  COMMANDS_PER_LEVEL,
  buildProfileSummary,
  buildUserPayload,
  calculateMemberDays,
};
