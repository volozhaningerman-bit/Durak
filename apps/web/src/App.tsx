import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  DEFAULT_CLASSIC_SETTINGS,
  DEFAULT_RPG_SETTINGS,
  RANKED_RATING_POOL,
  canBeat,
  RPG_CLASS_DESCRIPTIONS,
  RPG_CLASS_NAMES,
  type Card,
  type GameMode,
  type GameSettings,
  type PlayerProgress,
  type RpgClassId,
  type Suit,
  type ThemeId
} from "@durak/game-core";

const themes: { id: ThemeId; label: string }[] = [
  { id: "light", label: "Светлая" },
  { id: "dark", label: "Тёмная" }
];

const suitSymbol: Record<Suit, string> = {
  clubs: "♣",
  diamonds: "♦",
  hearts: "♥",
  spades: "♠"
};

interface GameViewPlayer {
  seat: number;
  classId?: RpgClassId;
  handCount: number;
  finished: boolean;
  place?: number;
  name: string;
  username?: string;
  photoUrl?: string;
}

interface GameView {
  id: string;
  settings: GameSettings;
  phase: "awaiting-trump" | "attacking" | "defending" | "throwing" | "finished";
  players: GameViewPlayer[];
  self: {
    seat: number;
    hand: Card[];
    classId?: RpgClassId;
    ability: {
      wildTransfersLeft: number;
      jokerAvailable: boolean;
    };
    finished: boolean;
    place?: number;
    name: string;
    username?: string;
    photoUrl?: string;
  };
  deckCount: number;
  discardCount: number;
  trumpSuits: Suit[];
  trumpCard?: Card;
  table: Array<{ attack: Card; defense?: Card }>;
  attackerSeat: number;
  defenderSeat: number;
  turnSeat?: number;
  direction: 1 | -1;
  roundAttackLimit: number;
  defenderTaking: boolean;
  loserSeat?: number;
  draw: boolean;
}

type ConnectionState = "connecting" | "online" | "offline";
type LobbyTab = "play" | "profile" | "rating" | "shop";

interface LeaderboardEntry {
  rank: number;
  rating: number;
  games: number;
  wins: number;
  losses: number;
  draws: number;
  currentStreak: number;
  bestStreak: number;
  level: number;
  displayName: string;
  username?: string;
  photoUrl?: string;
  isSelf: boolean;
}

interface MatchHistoryEntry {
  matchId: string;
  result: "win" | "loss" | "draw";
  ratingBefore: number;
  ratingAfter: number;
  ranked: boolean;
  createdAt: string;
}

interface RecentPlayer {
  key: string;
  contactId?: string;
  name: string;
  username?: string;
  photoUrl?: string;
  lastSeen: number;
}

interface PrivateLobbyView {
  code: string;
  settings: GameSettings;
  members: Array<{
    index: number;
    name: string;
    username?: string;
    photoUrl?: string;
    isSelf: boolean;
    isHost: boolean;
  }>;
  currentPlayers: number;
  requiredPlayers: number;
  isHost: boolean;
}

const errorMessages: Record<string, string> = {
  BAD_MESSAGE: "Некорректная команда",
  INVALID_SETTINGS: "Некорректные настройки игры",
  ALREADY_IN_ROOM: "Ты уже находишься в партии",
  NOT_IN_ROOM: "Ты не находишься в партии",
  ROOM_NOT_FOUND: "Комната больше не существует",
  GAME_NOT_FINISHED: "Сначала закончи текущую партию",
  NOT_YOUR_TURN: "Сейчас не твой ход",
  CARD_NOT_IN_HAND: "Этой карты уже нет в руке",
  JOKER_DEFENSE_ONLY: "Джокером можно только отбиваться",
  CARD_CANNOT_BEAT: "Этой картой нельзя отбить",
  ATTACK_NOT_ALLOWED: "Сейчас нельзя ходить",
  DEFENSE_NOT_ALLOWED: "Сейчас нельзя отбиваться",
  TRANSFER_NOT_ALLOWED: "Сейчас нельзя переводить",
  TAKE_NOT_ALLOWED: "Сейчас нельзя взять",
  PASS_NOT_ALLOWED: "Сейчас нельзя пасовать",
  THROW_IN_RANK_MISMATCH: "Подкинуть можно только подходящее достоинство",
  ATTACK_LIMIT_REACHED: "На стол уже положено максимум карт",
  RANK_MISMATCH: "Этой картой нельзя перевести",
  ALREADY_DEFENDED: "После начала отбоя переводить уже нельзя",
  NEXT_PLAYER_NOT_ENOUGH_CARDS: "Следующему игроку нельзя перевести столько карт",
  GAME_FINISHED: "Партия уже закончена",
  NOT_WAITING_FOR_TRUMP: "Сейчас нельзя выбирать козырь",
  AUTH_REQUIRED: "Открой игру через Telegram",
  AUTH_INVALID: "Telegram не подтвердил авторизацию",
  AUTH_EXPIRED: "Сессия Telegram устарела — переоткрой игру",
  AUTH_HASH_MISSING: "Telegram не передал данные авторизации",
  AUTH_DATE_INVALID: "Некорректная дата авторизации",
  AUTH_USER_MISSING: "Telegram не передал профиль пользователя",
  AUTH_USER_INVALID: "Не удалось прочитать профиль Telegram",
  ALREADY_CONNECTED: "Этот Telegram-аккаунт уже открыт в другой игровой сессии",
  RATE_LIMITED: "Слишком много команд подряд. Переподключаемся…",
  SERVER_MISCONFIGURED: "Игровой сервер временно настроен неправильно",
  PRIVATE_ROOM_NOT_FOUND: "Комната с таким кодом не найдена",
  PRIVATE_ROOM_FULL: "Комната уже заполнена",
  ALREADY_IN_PRIVATE_ROOM: "Ты уже находишься в приватной комнате",
  NOT_IN_PRIVATE_ROOM: "Ты не находишься в приватной комнате",
  PRIVATE_ROOM_EXPIRED: "Комната закрыта из-за долгого ожидания",
  INVITE_CONTACT_NOT_FOUND: "Игрок больше не доступен в недавних",
  INVITE_COOLDOWN: "Этому игроку уже отправлено приглашение — подожди немного",
  INVITE_UNAVAILABLE: "Сейчас этому игроку нельзя отправить приглашение",
  INVITE_FAILED: "Не удалось отправить приглашение",
  RECENT_PLAYERS_LOAD_FAILED: "Не удалось загрузить недавних игроков"
};

function readableError(code?: string): string {
  if (!code) return "Ошибка игры";
  return errorMessages[code] ?? "Не удалось выполнить действие";
}

function websocketUrl(): string {
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  const host =
    window.location.hostname === "localhost"
      ? `${window.location.hostname}:3001`
      : window.location.host;
  return `${protocol}//${host}/ws`;
}

export function App() {
  const [mode, setMode] = useState<GameMode>("classic");
  const [theme, setTheme] = useState<ThemeId>(() =>
    window.Telegram?.WebApp?.colorScheme === "light" ? "light" : "dark"
  );
  const [classic, setClassic] = useState<GameSettings>({ ...DEFAULT_CLASSIC_SETTINGS });
  const [rpg, setRpg] = useState<GameSettings>({ ...DEFAULT_RPG_SETTINGS });
  const [connection, setConnection] = useState<ConnectionState>("connecting");
  const [queueing, setQueueing] = useState(false);
  const [profile, setProfile] = useState<PlayerProgress | null>(null);
  const [game, setGame] = useState<GameView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedAttackId, setSelectedAttackId] = useState<string | null>(null);
  const [selectedHandId, setSelectedHandId] = useState<string | null>(null);
  const [actionPending, setActionPending] = useState(false);
  const [activeTab, setActiveTab] = useState<LobbyTab>("play");
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([]);
  const [history, setHistory] = useState<MatchHistoryEntry[]>([]);
  const [privateLobby, setPrivateLobby] = useState<PrivateLobbyView | null>(null);
  const [privateCodeInput, setPrivateCodeInput] = useState("");
  const [copyNotice, setCopyNotice] = useState(false);
  const [inviteSentName, setInviteSentName] = useState<string | null>(null);
  const [botUsername, setBotUsername] = useState<string | null>(null);
  const [recentPlayers, setRecentPlayers] = useState<RecentPlayer[]>(() => {
    try {
      const raw = window.localStorage.getItem("durak-recent-players");
      return raw ? (JSON.parse(raw) as RecentPlayer[]).slice(0, 8) : [];
    } catch {
      return [];
    }
  });
  const socketRef = useRef<WebSocket | null>(null);
  const handledStartParamRef = useRef(false);

  const settings = mode === "classic" ? classic : rpg;

  const subtitle = useMemo(
    () =>
      mode === "classic"
        ? "Настрой правила и найди соперников"
        : "Случайный класс. Никаких одинаковых ролей.",
    [mode]
  );

  useEffect(() => {
    void fetch("/api/config")
      .then((response) => response.json())
      .then((config: { botUsername?: string }) => {
        if (config.botUsername) setBotUsername(config.botUsername);
      })
      .catch(() => undefined);

    let stopped = false;
    let authBlocked = false;
    let reconnectTimer: number | undefined;

    const connect = () => {
      if (stopped) return;

      setConnection("connecting");
      const socket = new WebSocket(websocketUrl());
      socketRef.current = socket;

      socket.onopen = () => {
        setError(null);

        const telegram = window.Telegram?.WebApp;
        telegram?.ready();
        telegram?.expand();
        try {
          telegram?.requestFullscreen?.();
        } catch {
          // Older Telegram clients may not support fullscreen.
        }

        socket.send(JSON.stringify({
          type: "auth",
          initData: telegram?.initData ?? ""
        }));
      };

      socket.onclose = (event) => {
        if (socketRef.current === socket) {
          socketRef.current = null;
        }
        setConnection("offline");
        setQueueing(false);

        if (event.code === 4001) {
          authBlocked = true;
          setError("Игра открыта в другой сессии Telegram");
          return;
        }

        if (!stopped && !authBlocked) {
          window.clearTimeout(reconnectTimer);
          reconnectTimer = window.setTimeout(connect, 1500);
        }
      };

      socket.onerror = () => {
        setError("Соединение потеряно. Переподключаемся…");
      };

      socket.onmessage = (event) => {
        try {
          const message = JSON.parse(String(event.data)) as {
            type: string;
            code?: string;
            state?: GameView;
            profile?: PlayerProgress;
            entries?: unknown[];
            name?: string;
            settings?: GameSettings;
            members?: PrivateLobbyView["members"];
            currentPlayers?: number;
            requiredPlayers?: number;
            isHost?: boolean;
          };

          if (message.type === "auth_ok") {
            setConnection("online");
            if (message.profile) setProfile(message.profile);
            setError(null);

            if (!handledStartParamRef.current) {
              const telegramStartParam = window.Telegram?.WebApp?.initDataUnsafe?.start_param;
              const urlStartParam = new URLSearchParams(window.location.search).get("tgWebAppStartParam");
              const startParam = telegramStartParam ?? urlStartParam;
              const roomMatch = startParam?.match(/^room_([A-Z2-9]{6})$/i);

              handledStartParamRef.current = true;
              if (roomMatch) {
                const code = roomMatch[1].toUpperCase();
                setPrivateCodeInput(code);
                socket.send(JSON.stringify({ type: "join_private_room", code }));
              }
            }
            return;
          }

          if (message.type === "profile_updated") {
            if (message.profile) setProfile(message.profile);
            return;
          }

          if (message.type === "recent_players") {
            rememberRecentPlayers(
              ((message.entries ?? []) as Array<{
                contactId: string;
                name: string;
                username?: string;
                photoUrl?: string;
                lastSeen?: string;
              }>).map((entry) => ({
                contactId: entry.contactId,
                name: entry.name,
                username: entry.username,
                photoUrl: entry.photoUrl,
                lastSeen: entry.lastSeen ? new Date(entry.lastSeen).getTime() : Date.now()
              }))
            );
            return;
          }

          if (message.type === "invite_sent") {
            setInviteSentName(message.name ?? "игроку");
            window.Telegram?.WebApp?.HapticFeedback?.notificationOccurred("success");
            window.setTimeout(() => setInviteSentName(null), 1800);
            return;
          }

          if (message.type === "leaderboard") {
            setLeaderboard((message.entries ?? []) as LeaderboardEntry[]);
            return;
          }

          if (message.type === "match_history") {
            setHistory((message.entries ?? []) as MatchHistoryEntry[]);
            return;
          }

          if (message.type === "progress_error") {
            setError("Партия закончена, но прогресс временно не сохранился");
            return;
          }

          if (message.type === "auth_error") {
            authBlocked = true;
            setConnection("offline");
            setError(readableError(message.code));
            socket.close();
            return;
          }

          if (message.type === "queue_joined") {
            setQueueing(true);
            return;
          }

          if (message.type === "queue_left") {
            setQueueing(false);
            return;
          }

          if (
            message.type === "private_room" &&
            message.code &&
            message.settings &&
            message.members &&
            typeof message.currentPlayers === "number" &&
            typeof message.requiredPlayers === "number"
          ) {
            setQueueing(false);
            setPrivateLobby({
              code: message.code,
              settings: message.settings,
              members: message.members,
              currentPlayers: message.currentPlayers,
              requiredPlayers: message.requiredPlayers,
              isHost: message.isHost === true
            });
            rememberRecentPlayers(
              message.members
                .filter((member) => !member.isSelf)
                .map((member) => ({
                  name: member.name,
                  username: member.username,
                  photoUrl: member.photoUrl
                }))
            );
            setError(null);
            return;
          }

          if (message.type === "private_room_left") {
            setPrivateLobby(null);
            return;
          }

          if (message.type === "room_left") {
            setGame(null);
            setSelectedAttackId(null);
            setSelectedHandId(null);
            setError(null);
            return;
          }

          if ((message.type === "match_found" || message.type === "game_state") && message.state) {
            if (message.type === "match_found") {
              window.Telegram?.WebApp?.HapticFeedback?.notificationOccurred("success");
            }
            setActionPending(false);
            setGame(message.state);
            rememberRecentPlayers(
              message.state.players
                .filter((player) => player.seat !== message.state!.self.seat)
                .map((player) => ({
                  name: player.name,
                  username: player.username,
                  photoUrl: player.photoUrl
                }))
            );
            setQueueing(false);
            setPrivateLobby(null);
            setSelectedAttackId(null);
            setSelectedHandId(null);
            setError(null);
            return;
          }

          if (message.type === "game_error" || message.type === "error") {
            window.Telegram?.WebApp?.HapticFeedback?.notificationOccurred("error");
            setActionPending(false);
            setError(readableError(message.code));
          }
        } catch {
          setError("Сервер прислал некорректный ответ");
        }
      };
    };

    connect();

    return () => {
      stopped = true;
      window.clearTimeout(reconnectTimer);
      socketRef.current?.close();
      socketRef.current = null;
    };
  }, []);

  function send(payload: unknown) {
    const socket = socketRef.current;
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      setError("Сервер ещё не подключён");
      return;
    }
    socket.send(JSON.stringify(payload));
  }

  function updateSettings(patch: Partial<GameSettings>) {
    if (mode === "classic") {
      setClassic((current) => ({ ...current, ...patch }));
    } else {
      setRpg((current) => ({
        ...current,
        ...patch,
        mode: "rpg",
        variant: "transfer"
      }));
    }
  }

  function joinQueue() {
    setError(null);
    send({ type: "join_queue", settings });
  }

  function leaveQueue() {
    send({ type: "leave_queue" });
  }


  function createPrivateRoom() {
    setError(null);
    setQueueing(false);
    send({ type: "create_private_room", settings });
  }

  function joinPrivateRoom() {
    const code = privateCodeInput.trim().toUpperCase();
    if (!code) {
      setError("Введи код комнаты");
      return;
    }
    setError(null);
    setQueueing(false);
    send({ type: "join_private_room", code });
  }

  function leavePrivateRoom() {
    setError(null);
    send({ type: "leave_private_room" });
  }

  async function copyPrivateCode() {
    if (!privateLobby) return;
    try {
      await navigator.clipboard.writeText(privateLobby.code);
      setCopyNotice(true);
      window.setTimeout(() => setCopyNotice(false), 1400);
      window.Telegram?.WebApp?.HapticFeedback?.notificationOccurred("success");
    } catch {
      setError(`Код комнаты: ${privateLobby.code}`);
    }
  }


  async function sharePrivateRoom() {
    if (!privateLobby) return;

    const inviteUrl = botUsername
      ? `https://t.me/${botUsername}?startapp=room_${privateLobby.code}&mode=fullscreen`
      : undefined;
    const text = inviteUrl
      ? `Durak RPG — заходи в приватную комнату: ${inviteUrl}`
      : `Durak RPG — заходи в приватную комнату. Код: ${privateLobby.code}`;

    if (navigator.share) {
      try {
        await navigator.share({
          title: "Durak RPG",
          text,
          url: inviteUrl
        });
        return;
      } catch {
        // User may cancel the native share sheet; fall back to Telegram share or clipboard.
      }
    }

    if (inviteUrl && window.Telegram?.WebApp?.openTelegramLink) {
      const shareUrl =
        `https://t.me/share/url?url=${encodeURIComponent(inviteUrl)}&text=${encodeURIComponent("Заходи в Durak RPG")}`;
      window.Telegram.WebApp.openTelegramLink(shareUrl);
      return;
    }

    await copyPrivateCode();
  }

  function gameAction(action: Record<string, unknown>) {
    if (actionPending) return;
    window.Telegram?.WebApp?.HapticFeedback?.impactOccurred("light");
    setActionPending(true);
    setError(null);

    const socket = socketRef.current;
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      setActionPending(false);
      setError("Сервер ещё не подключён");
      return;
    }

    socket.send(JSON.stringify({ type: "game_action", action }));
  }

  function leaveRoom() {
    send({ type: "leave_room" });
  }

  function openTab(tab: LobbyTab) {
    setActiveTab(tab);
    setError(null);
    if (tab === "rating") send({ type: "get_leaderboard", limit: 50 });
    if (tab === "profile") send({ type: "get_history", limit: 20 });
  }

  function rememberRecentPlayers(
    players: Array<{
      contactId?: string;
      name: string;
      username?: string;
      photoUrl?: string;
      lastSeen?: number;
    }>
  ) {
    if (players.length === 0) return;

    setRecentPlayers((current) => {
      const byKey = new Map(current.map((player) => [player.key, player]));
      for (const player of players) {
        const key = player.contactId ?? (
          player.username
            ? `@${player.username.toLowerCase()}`
            : player.name.toLowerCase()
        );
        const previous = byKey.get(key);
        byKey.set(key, {
          key,
          contactId: player.contactId ?? previous?.contactId,
          name: player.name,
          username: player.username ?? previous?.username,
          photoUrl: player.photoUrl ?? previous?.photoUrl,
          lastSeen: player.lastSeen ?? Date.now()
        });
      }
      const next = [...byKey.values()]
        .sort((a, b) => b.lastSeen - a.lastSeen)
        .slice(0, 8);
      try {
        window.localStorage.setItem("durak-recent-players", JSON.stringify(next));
      } catch {
        // Local persistence is optional.
      }
      return next;
    });
  }

  function inviteRecentPlayer(player: RecentPlayer) {
    if (!privateLobby) {
      setError("Сначала создай приватную комнату — после этого можно отправить приглашение.");
      return;
    }

    if (player.contactId) {
      send({
        type: "invite_recent_player",
        contactId: player.contactId,
        code: privateLobby.code
      });
      return;
    }

    void sharePrivateRoom();
  }


  useEffect(() => {
    const backButton = window.Telegram?.WebApp?.BackButton;
    if (!backButton) return;

    const handleBack = () => {
      if (game?.phase === "finished") {
        leaveRoom();
      }
    };

    const shouldShow = game?.phase === "finished";
    if (shouldShow) {
      backButton.show();
      backButton.onClick(handleBack);
    } else {
      backButton.hide();
    }

    return () => {
      backButton.offClick(handleBack);
    };
  }, [activeTab, game?.phase]);

  if (game) {
    return (
      <GameScreen
        game={game}
        connection={connection}
        actionPending={actionPending}
        theme={theme}
        setTheme={setTheme}
        error={error}
        selectedAttackId={selectedAttackId}
        setSelectedAttackId={setSelectedAttackId}
        selectedHandId={selectedHandId}
        setSelectedHandId={setSelectedHandId}
        onAction={gameAction}
        onLeaveRoom={leaveRoom}
      />
    );
  }

  return (
    <main className="app lobbyApp" data-theme={theme} data-mode={mode}>
      <Header
        theme={theme}
        setTheme={setTheme}
        subtitle={
          activeTab === "play"
            ? subtitle
            : activeTab === "profile"
              ? "Статистика и история матчей"
              : activeTab === "rating"
                ? "Лидерборд рейтинговых матчей"
                : "Косметика, эмоции и расходники"
        }
        connection={connection}
      />

      <section className="screenBody">
        {activeTab === "play" && (
          <section className="tabPage playPage">
            {queueing ? (
              <div className="searchStage">
                <div className="searchCards" aria-hidden="true">
                  <span className="searchCard cardOne">6♠</span>
                  <span className="searchCard cardTwo">A♥</span>
                  <span className="searchCard cardThree">Д</span>
                </div>
                <span className="modeEyebrow">
                  {mode === "classic" ? "КЛАССИЧЕСКАЯ ИГРА" : "RPG • СЛУЧАЙНЫЙ КЛАСС"}
                </span>
                <h2>Ищем соперников</h2>
                <p>
                  {settings.playerCount} игрока · {settings.ranked ? "рейтинг" : "обычная"} ·
                  {" "}{settings.throwInPolicy === "all" ? "подкидывают все" : "подкидывают крайние"}
                </p>
                <div className="searchDots" aria-hidden="true"><i /><i /><i /></div>
                <button className="findGame cancelSearch" onClick={leaveQueue}>
                  ОТМЕНИТЬ ПОИСК
                </button>
              </div>
            ) : privateLobby ? (
              <div className="privateLobbyStage">
                <div className="privateLobbyHead">
                  <div>
                    <span>Комната</span>
                    <strong>{privateLobby.currentPlayers}/{privateLobby.requiredPlayers}</strong>
                  </div>
                  <div className="privateCodeActions">
                    <button onClick={copyPrivateCode}>
                      {copyNotice ? "Скопировано" : privateLobby.code}
                    </button>
                    <button className="invitePulse" aria-label="Поделиться комнатой" onClick={sharePrivateRoom}>↗</button>
                  </div>
                </div>

                <div className="waitingTable">
                  <div className="waitingDeck" aria-hidden="true">
                    <span />
                    <span />
                  </div>
                  <div className="waitingSeats">
                    {Array.from({ length: privateLobby.requiredPlayers }, (_, index) => {
                      const member = privateLobby.members[index];
                      return member ? (
                        <div className="waitingSeat filled" key={index}>
                          <div className="avatar">
                            {member.photoUrl ? <img src={member.photoUrl} alt="" /> : index + 1}
                          </div>
                          <b>{member.name}</b>
                          <small>{member.isSelf ? "ты" : member.isHost ? "хозяин" : "готов"}</small>
                        </div>
                      ) : (
                        <div className="waitingSeat empty" key={index}>
                          <div className="emptySeatPulse">+</div>
                          <b>Ждём игрока</b>
                          <small>место свободно</small>
                        </div>
                      );
                    })}
                  </div>
                </div>

                {inviteSentName && (
                  <div className="inviteToast">Приглашение отправлено: {inviteSentName}</div>
                )}

                <div className="waitingCaption">
                  <span className="waitingDot" />
                  Ждём ещё {Math.max(0, privateLobby.requiredPlayers - privateLobby.currentPlayers)} игрок(а)
                </div>

                <div className="lobbyActions">
                  <button className="secondaryGameButton inviteMain" onClick={sharePrivateRoom}>
                    ПРИГЛАСИТЬ
                  </button>
                  <button className="secondaryGameButton dangerOutline" onClick={leavePrivateRoom}>
                    ВЫЙТИ
                  </button>
                </div>

                {recentPlayers.length > 0 && (
                  <div className="recentBlock compact">
                    <div className="recentHead"><span>Недавние игроки</span><small>сохраняются автоматически</small></div>
                    <div className="recentPlayers">
                      {recentPlayers.slice(0, 5).map((player) => (
                        <button className="recentPlayer" key={player.key} onClick={() => inviteRecentPlayer(player)}>
                          <span className="avatar">
                            {player.photoUrl ? <img src={player.photoUrl} alt="" /> : player.name.slice(0, 1)}
                          </span>
                          <span>{player.name}</span>
                          <small>позвать</small>
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <>
                {profile && (
                  <section className="profileStrip compactStats">
                    <div><span>Рейтинг</span><b>{Math.round(profile.rating)}</b></div>
                    <div><span>Уровень</span><b>{profile.level}</b></div>
                    <div><span>Победы</span><b>{profile.wins}</b></div>
                    <div><span>Серия</span><b>{profile.currentStreak}</b></div>
                  </section>
                )}

                <section className="modeSwitch">
                  <button className={mode === "classic" ? "active" : ""} onClick={() => setMode("classic")}>
                    Классика
                  </button>
                  <button className={mode === "rpg" ? "active" : ""} onClick={() => setMode("rpg")}>
                    RPG
                  </button>
                </section>

                <section className={`heroCard modeHero ${mode}`}>
                  <div className="playingCard left">{mode === "classic" ? "6♠" : "J♣"}</div>
                  <div className="crest">{mode === "classic" ? "♠" : "✦"}</div>
                  <div className="playingCard right">{mode === "classic" ? "A♥" : "A♦"}</div>
                  <span className="modeEyebrow">
                    {mode === "classic" ? "36 КАРТ • ЧИСТЫЕ ПРАВИЛА" : "6 УНИКАЛЬНЫХ КЛАССОВ"}
                  </span>
                  <h1>{mode === "classic" ? "Классический дурак" : "Дурак RPG"}</h1>
                  <p>
                    {mode === "classic"
                      ? "Зелёный стол, привычные правила и ничего лишнего."
                      : "Каждая партия меняется из-за случайной способности."}
                  </p>
                </section>

                <section className="settings compactSettings">
                  <SettingRow label="Игроков" value={String(settings.playerCount)}>
                    <input
                      type="range"
                      min="2"
                      max="6"
                      step="1"
                      value={settings.playerCount}
                      onChange={(event) =>
                        updateSettings({
                          playerCount: Number(event.target.value) as GameSettings["playerCount"]
                        })
                      }
                    />
                    <div className="rangeLabels"><span>2</span><span>3</span><span>4</span><span>5</span><span>6</span></div>
                  </SettingRow>

                  <div className="settingsGrid">
                    {mode === "classic" ? (
                      <SettingRow
                        label="Режим"
                        value={settings.variant === "throw-in" ? "Подкидной" : "Переводной"}
                      >
                        <div className="segmented">
                          <button
                            className={settings.variant === "throw-in" ? "active" : ""}
                            onClick={() => updateSettings({ variant: "throw-in" })}
                          >
                            Подкидной
                          </button>
                          <button
                            className={settings.variant === "transfer" ? "active" : ""}
                            onClick={() => updateSettings({ variant: "transfer" })}
                          >
                            Переводной
                          </button>
                        </div>
                      </SettingRow>
                    ) : (
                      <div className="rpgRuleCard">
                        <span>Правила RPG</span>
                        <b>Подкидной + переводной</b>
                        <small>Класс выпадет перед раздачей</small>
                      </div>
                    )}

                    <SettingRow
                      label="Подкидывают"
                      value={settings.throwInPolicy === "all" ? "Все" : "Крайние"}
                    >
                      <div className="segmented">
                        <button
                          className={settings.throwInPolicy === "all" ? "active" : ""}
                          onClick={() => updateSettings({ throwInPolicy: "all" })}
                        >
                          Все
                        </button>
                        <button
                          className={settings.throwInPolicy === "neighbors" ? "active" : ""}
                          onClick={() => updateSettings({ throwInPolicy: "neighbors" })}
                        >
                          Крайние
                        </button>
                      </div>
                    </SettingRow>
                  </div>

                  <SettingRow
                    label="Матч"
                    value={settings.ranked ? "Рейтинговый" : "Обычный"}
                  >
                    <div className="segmented">
                      <button
                        className={!settings.ranked ? "active" : ""}
                        onClick={() =>
                          updateSettings({
                            ranked: false,
                            gameplayItemsEnabled: mode === "rpg"
                          })
                        }
                      >
                        Обычный
                      </button>
                      <button
                        className={settings.ranked ? "active" : ""}
                        onClick={() =>
                          updateSettings({
                            ranked: true,
                            gameplayItemsEnabled: false
                          })
                        }
                      >
                        Рейтинг
                      </button>
                    </div>
                    <div className="settingHint">
                      {settings.ranked
                        ? `Пул ${RANKED_RATING_POOL}: дурак −30, победители делят +30. Кто вышел раньше — получает больше.`
                        : "Без изменения рейтинга."}
                    </div>
                  </SettingRow>

                  {error && <div className="errorBanner">{error}</div>}

                  <div className="primaryActions">
                    <button
                      className="findGame"
                      disabled={connection !== "online"}
                      onClick={joinQueue}
                    >
                      {connection === "connecting"
                        ? "ПОДКЛЮЧЕНИЕ..."
                        : connection === "offline"
                          ? "СЕРВЕР НЕДОСТУПЕН"
                          : "НАЙТИ ИГРУ"}
                    </button>
                    <button
                      className="secondaryGameButton createRoomCompact"
                      disabled={connection !== "online"}
                      onClick={createPrivateRoom}
                    >
                      + КОМНАТА
                    </button>
                  </div>

                  <div className="joinPrivateRow compactJoin">
                    <input
                      value={privateCodeInput}
                      maxLength={6}
                      placeholder="КОД КОМНАТЫ"
                      aria-label="Код приватной комнаты"
                      onChange={(event) =>
                        setPrivateCodeInput(
                          event.target.value
                            .toUpperCase()
                            .replace(/[^A-Z2-9]/g, "")
                            .slice(0, 6)
                        )
                      }
                    />
                    <button
                      className="secondaryGameButton"
                      disabled={connection !== "online" || privateCodeInput.length !== 6}
                      onClick={joinPrivateRoom}
                    >
                      Войти
                    </button>
                  </div>
                </section>

                {recentPlayers.length > 0 && (
                  <div className="recentBlock">
                    <div className="recentHead"><span>Недавние</span><small>игроки, которых ты уже встречал</small></div>
                    <div className="recentPlayers">
                      {recentPlayers.slice(0, 5).map((player) => (
                        <div className="recentPlayer passive" key={player.key}>
                          <span className="avatar">
                            {player.photoUrl ? <img src={player.photoUrl} alt="" /> : player.name.slice(0, 1)}
                          </span>
                          <span>{player.name}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </>
            )}
          </section>
        )}

        {activeTab === "profile" && (
          <section className="tabPage contentPage">
            <div className="pageHead">
              <div><span>ПРОФИЛЬ</span><h2>{profile ? `Уровень ${profile.level}` : "Загрузка…"}</h2></div>
              {profile && <strong>{Math.round(profile.rating)} <small>RP</small></strong>}
            </div>
            {profile && (
              <div className="profileGrid">
                <div><span>Игр</span><b>{profile.games}</b></div>
                <div><span>Побед</span><b>{profile.wins}</b></div>
                <div><span>Поражений</span><b>{profile.losses}</b></div>
                <div><span>Лучшая серия</span><b>{profile.bestStreak}</b></div>
              </div>
            )}
            <h3>Последние матчи</h3>
            <div className="historyList innerScroll">
              {history.length === 0 && <p className="tabMuted">История пока пустая.</p>}
              {history.map((entry) => (
                <div className="historyRow" key={entry.matchId}>
                  <div>
                    <b>{entry.result === "win" ? "Победа" : entry.result === "loss" ? "Поражение" : "Ничья"}</b>
                    <small>{entry.ranked ? "Рейтинг" : "Обычная"}</small>
                  </div>
                  <span>
                    {entry.ranked
                      ? `${Math.round(entry.ratingBefore)} → ${Math.round(entry.ratingAfter)}`
                      : "без рейтинга"}
                  </span>
                </div>
              ))}
            </div>
          </section>
        )}

        {activeTab === "rating" && (
          <section className="tabPage contentPage">
            <div className="pageHead">
              <div><span>РЕЙТИНГ</span><h2>Таблица игроков</h2></div>
              <strong>±30</strong>
            </div>
            <div className="ratingRuleCard">
              <b>Один матч = пул 30 рейтинга</b>
              <span>Дурак теряет 30. Победители делят эти 30 по порядку выхода: первый получает больше всех.</span>
              <div className="ratingExamples">
                <small>2: +30 / −30</small>
                <small>3: +20 · +10 / −30</small>
                <small>4: +15 · +10 · +5 / −30</small>
              </div>
            </div>
            <div className="leaderboardList innerScroll">
              {leaderboard.length === 0 && <p className="tabMuted">Загружаем таблицу…</p>}
              {leaderboard.map((entry) => (
                <div className={`leaderboardRow ${entry.isSelf ? "self" : ""}`} key={`${entry.rank}-${entry.displayName}`}>
                  <b>#{entry.rank}</b>
                  <span>{entry.displayName}</span>
                  <strong>{Math.round(entry.rating)}</strong>
                </div>
              ))}
            </div>
          </section>
        )}

        {activeTab === "shop" && (
          <section className="tabPage contentPage">
            <div className="pageHead">
              <div><span>МАГАЗИН</span><h2>Stars и эмоции</h2></div>
              <strong>★</strong>
            </div>
            <p className="tabMuted">В рейтинговых матчах игровые преимущества отключены.</p>
            <div className="shopGrid innerScroll">
              <article>
                <strong>↩ Возврат карты</strong>
                <span>Вернуть последнюю карту, пока поверх неё никто не сыграл.</span>
              </article>
              <article>
                <strong>👁 Память стола</strong>
                <span>На 5 секунд показать карты, уже вышедшие из игры.</span>
              </article>
              <article>
                <strong>🍅 Насмешки</strong>
                <span>Помидоры, эмоции и визуальные реакции без влияния на правила.</span>
              </article>
            </div>
          </section>
        )}
      </section>

      <nav className="bottomNav">
        <button className={activeTab === "play" ? "active" : ""} onClick={() => openTab("play")}>Играть</button>
        <button className={activeTab === "profile" ? "active" : ""} onClick={() => openTab("profile")}>Профиль</button>
        <button className={activeTab === "rating" ? "active" : ""} onClick={() => openTab("rating")}>Рейтинг</button>
        <button className={activeTab === "shop" ? "active" : ""} onClick={() => openTab("shop")}>Магазин</button>
      </nav>
    </main>
  );
}

function Header(props: {
  theme: ThemeId;
  setTheme: (theme: ThemeId) => void;
  subtitle: string;
  connection?: ConnectionState;
}) {
  const [isFullscreen, setIsFullscreen] = useState(
    window.Telegram?.WebApp?.isFullscreen === true
  );

  useEffect(() => {
    const webApp = window.Telegram?.WebApp;
    if (!webApp?.onEvent || !webApp?.offEvent) return;

    const syncFullscreen = () => setIsFullscreen(webApp.isFullscreen === true);
    webApp.onEvent("fullscreenChanged", syncFullscreen);
    return () => webApp.offEvent?.("fullscreenChanged", syncFullscreen);
  }, []);

  function toggleFullscreen() {
    const webApp = window.Telegram?.WebApp;
    if (!webApp) return;

    try {
      if (webApp.isFullscreen) {
        webApp.exitFullscreen?.();
      } else {
        webApp.requestFullscreen?.();
      }
      window.setTimeout(
        () => setIsFullscreen(window.Telegram?.WebApp?.isFullscreen === true),
        150
      );
    } catch {
      // Fullscreen is optional on older Telegram clients.
    }
  }

  return (
    <header className="topbar">
      <div>
        <strong className="brand">DURAK <span>RPG</span></strong>
        <div className="subtitle">
          {props.subtitle}
          {props.connection && (
            <span className={`connectionDot ${props.connection}`}>
              {props.connection === "online" ? " online" : ""}
            </span>
          )}
        </div>
      </div>
      <div className="headerActions">
        <button
          className="fullscreenButton"
          onClick={toggleFullscreen}
          aria-label={isFullscreen ? "Выйти из полного экрана" : "На весь экран"}
          title={isFullscreen ? "Выйти из полного экрана" : "На весь экран"}
        >
          {isFullscreen ? "↙" : "⛶"}
        </button>
        <select
          className="themeSelect"
          value={props.theme}
          onChange={(event) => props.setTheme(event.target.value as ThemeId)}
          aria-label="Тема"
        >
          {themes.map((item) => (
            <option key={item.id} value={item.id}>{item.label}</option>
          ))}
        </select>
      </div>
    </header>
  );
}

function GameScreen(props: {
  game: GameView;
  connection: ConnectionState;
  actionPending: boolean;
  theme: ThemeId;
  setTheme: (theme: ThemeId) => void;
  error: string | null;
  selectedAttackId: string | null;
  setSelectedAttackId: (value: string | null) => void;
  selectedHandId: string | null;
  setSelectedHandId: (value: string | null) => void;
  onAction: (action: Record<string, unknown>) => void;
  onLeaveRoom: () => void;
}) {
  const { game } = props;
  const isMyTurn = game.turnSeat === game.self.seat;
  const myClass = game.self.classId ? RPG_CLASS_NAMES[game.self.classId] : undefined;
  const myClassDescription = game.self.classId
    ? RPG_CLASS_DESCRIPTIONS[game.self.classId]
    : undefined;
  const controlsDisabled = props.connection !== "online" || props.actionPending;
  const openAttack =
    game.table.find((pair) => !pair.defense && pair.attack.id === props.selectedAttackId) ??
    game.table.find((pair) => !pair.defense);
  const selectedCard = game.self.hand.find((card) => card.id === props.selectedHandId);
  const tableRanks = new Set(
    game.table.flatMap((pair) => {
      const ranks: string[] = [];
      if (pair.attack.kind === "standard") ranks.push(pair.attack.rank);
      if (pair.defense?.kind === "standard") ranks.push(pair.defense.rank);
      return ranks;
    })
  );
  const attackRanks = game.table
    .map((pair) => pair.attack)
    .filter((card): card is Extract<Card, { kind: "standard" }> => card.kind === "standard")
    .map((card) => card.rank);
  const transferStillAllowed = game.table.every((pair) => !pair.defense);
  const standardTransfer =
    selectedCard?.kind === "standard" &&
    attackRanks.length > 0 &&
    attackRanks.every((rank) => rank === selectedCard.rank);
  const wildTransfer =
    selectedCard?.kind === "standard" &&
    game.self.classId === "wild-transfer" &&
    game.self.ability.wildTransfersLeft > 0;
  const canSelectedTransfer = transferStillAllowed && (standardTransfer || wildTransfer);
  const canSelectedDefend =
    Boolean(selectedCard && openAttack) &&
    canBeat(openAttack!.attack, selectedCard!, game.trumpSuits);

  function cardPlayable(card: Card): boolean {
    if (!isMyTurn || controlsDisabled) return false;
    if (game.phase === "attacking") return card.kind === "standard";
    if (game.phase === "throwing") {
      return (
        card.kind === "standard" &&
        tableRanks.has(card.rank) &&
        game.table.length < game.roundAttackLimit
      );
    }
    if (game.phase === "defending") return true;
    return false;
  }

  function clickHandCard(card: Card) {
    if (!isMyTurn) return;

    if (game.phase === "attacking" || game.phase === "throwing") {
      props.onAction({ type: "attack", cardId: card.id });
      return;
    }

    if (game.phase === "defending") {
      props.setSelectedHandId(card.id);
    }
  }

  function defend() {
    if (!props.selectedHandId || !openAttack) return;
    props.onAction({
      type: "defend",
      attackCardId: openAttack.attack.id,
      cardId: props.selectedHandId
    });
  }

  function transfer(reverse = false) {
    if (!props.selectedHandId) return;
    props.onAction({
      type: "transfer",
      cardId: props.selectedHandId,
      reverse
    });
  }

  const resultText =
    game.phase === "finished"
      ? game.draw
        ? "Ничья"
        : game.loserSeat === game.self.seat
          ? "Ты остался дураком"
          : `Дурак — игрок #${(game.loserSeat ?? 0) + 1}`
      : null;

  return (
    <main className="app gameApp" data-theme={props.theme}>
      <Header
        theme={props.theme}
        setTheme={props.setTheme}
        subtitle={myClass ? `Твой класс: ${myClass}` : "Классическая партия"}
        connection={props.connection}
      />

      {props.connection !== "online" && (
        <div className="reconnectNotice">
          Соединение потеряно. Пытаемся вернуть тебя в эту же партию…
        </div>
      )}

      {myClassDescription && (
        <section className="classAbilityBar">
          <b>{myClass}</b>
          <span>{myClassDescription}</span>
          {game.self.classId === "wild-transfer" && (
            <em>Осталось особых переводов: {game.self.ability.wildTransfersLeft}</em>
          )}
        </section>
      )}

      <section className="gameMeta">
        <span>Колода <b>{game.deckCount}</b></span>
        <span>
          Козырь <b>{game.trumpSuits[0] ? suitSymbol[game.trumpSuits[0]] : "?"}</b>
        </span>
        <span>Ход <b>{game.direction === 1 ? "→" : "←"}</b></span>
        <span>На столе <b>{game.table.length}/{game.roundAttackLimit || "—"}</b></span>
      </section>

      <section className="opponents">
        {game.players
          .filter((player) => player.seat !== game.self.seat)
          .map((player) => (
            <div
              key={player.seat}
              className={[
                "opponent",
                player.seat === game.turnSeat ? "turn" : "",
                player.seat === game.defenderSeat ? "defender" : "",
                player.finished ? "finished" : ""
              ].join(" ")}
            >
              <div className="avatar">
                {player.photoUrl ? <img src={player.photoUrl} alt="" /> : player.seat + 1}
              </div>
              <strong>{player.name}</strong>
              <span>{player.handCount} карт</span>
              {player.classId && <small>{RPG_CLASS_NAMES[player.classId]}</small>}
            </div>
          ))}
      </section>

      {game.phase === "awaiting-trump" && isMyTurn && (
        <section className="trumpChoice">
          <h2>Выбери козырь</h2>
          <div className="suitButtons">
            {(["clubs", "diamonds", "hearts", "spades"] as Suit[]).map((suit) => (
              <button
                key={suit}
                className={suit === "hearts" || suit === "diamonds" ? "redSuit" : ""}
                disabled={controlsDisabled}
                onClick={() => props.onAction({ type: "choose_trump", suit })}
              >
                {suitSymbol[suit]}
              </button>
            ))}
          </div>
        </section>
      )}

      <section className="tableArea">
        {game.table.length === 0 ? (
          <div className="emptyTable">
            {game.phase === "finished"
              ? resultText
              : isMyTurn
                ? "Твой ход"
                : "Ожидаем ход соперника"}
          </div>
        ) : (
          <div className="tablePairs">
            {game.table.map((pair) => (
              <button
                key={pair.attack.id}
                className={[
                  "tablePair",
                  !pair.defense && openAttack?.attack.id === pair.attack.id ? "selected" : ""
                ].join(" ")}
                onClick={() => {
                  if (!pair.defense && game.phase === "defending" && isMyTurn) {
                    props.setSelectedAttackId(pair.attack.id);
                  }
                }}
              >
                <CardFace card={pair.attack} />
                {pair.defense && <div className="defenseCard"><CardFace card={pair.defense} /></div>}
              </button>
            ))}
          </div>
        )}
      </section>

      {props.error && <div className="errorBanner gameError">{props.error}</div>}

      <section className="turnInfo">
        {resultText ?? (
          isMyTurn
            ? game.phase === "defending"
              ? "Отбей, переведи или возьми"
              : game.phase === "throwing"
                ? "Подкинь карту или пас"
                : game.phase === "attacking"
                  ? "Выбери карту для хода"
                  : "Выбери козырную масть"
            : `Ход игрока #${(game.turnSeat ?? 0) + 1}`
        )}
      </section>

      {game.phase === "defending" && isMyTurn && (
        <section className="gameActions">
          <button disabled={controlsDisabled || !canSelectedDefend} onClick={defend}>
            Отбить
          </button>
          {game.settings.variant === "transfer" && (
            <button disabled={controlsDisabled || !canSelectedTransfer} onClick={() => transfer(false)}>
              Перевести
            </button>
          )}
          {game.self.classId === "reverse-transfer" && (
            <button disabled={controlsDisabled || !canSelectedTransfer} onClick={() => transfer(true)}>
              Развернуть
            </button>
          )}
          <button className="dangerAction" disabled={controlsDisabled} onClick={() => props.onAction({ type: "take" })}>
            Взять
          </button>
        </section>
      )}

      {game.phase === "throwing" && isMyTurn && (
        <section className="gameActions single">
          <button disabled={controlsDisabled} onClick={() => props.onAction({ type: "pass_throw_in" })}>Пас</button>
        </section>
      )}

      {game.phase === "finished" && (
        <section className="gameActions single">
          <button onClick={props.onLeaveRoom}>В меню</button>
        </section>
      )}

      <section className="myHand">
        <div className="handHeader">
          <span>Твои карты</span>
          <b>{game.self.hand.length}</b>
          {game.self.classId === "wild-transfer" && (
            <small>особых переводов: {game.self.ability.wildTransfersLeft}</small>
          )}
        </div>
        <div className="handCards">
          {game.self.hand.map((card) => (
            <button
              key={card.id}
              className={[
                "handCard",
                card.id === props.selectedHandId ? "selected" : "",
                isRed(card) ? "red" : ""
              ].join(" ")}
              onClick={() => clickHandCard(card)}
              disabled={
                game.phase === "finished" ||
                game.phase === "awaiting-trump" ||
                !cardPlayable(card)
              }
            >
              <CardFace card={card} />
            </button>
          ))}
        </div>
      </section>
    </main>
  );
}

function isRed(card: Card): boolean {
  return card.kind === "standard" && (card.suit === "hearts" || card.suit === "diamonds");
}

function CardFace({ card }: { card: Card }) {
  if (card.kind === "joker") {
    return <span className="cardFace jokerFace"><b>★</b><small>JOKER</small></span>;
  }

  return (
    <span className={`cardFace ${isRed(card) ? "red" : ""}`}>
      <b>{card.rank}</b>
      <strong>{suitSymbol[card.suit]}</strong>
    </span>
  );
}

function SettingRow(props: { label: string; value: string; children: ReactNode }) {
  return (
    <div className="settingRow">
      <div className="settingTitle"><span>{props.label}</span><b>{props.value}</b></div>
      {props.children}
    </div>
  );
}
