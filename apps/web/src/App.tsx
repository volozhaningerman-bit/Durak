import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  DEFAULT_CLASSIC_SETTINGS,
  DEFAULT_RPG_SETTINGS,
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
  { id: "classic", label: "Классика" },
  { id: "casino", label: "Казино" },
  { id: "dark", label: "Тёмная" },
  { id: "rus-fantasy", label: "Русь" }
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
  PRIVATE_ROOM_EXPIRED: "Комната закрыта из-за долгого ожидания"
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
  const [theme, setTheme] = useState<ThemeId>("dark");
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
  const [botUsername, setBotUsername] = useState<string | null>(null);
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
      ? `https://t.me/${botUsername}?startapp=room_${privateLobby.code}`
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


  useEffect(() => {
    const backButton = window.Telegram?.WebApp?.BackButton;
    if (!backButton) return;

    const handleBack = () => {
      if (activeTab !== "play") {
        setActiveTab("play");
        return;
      }

      if (game?.phase === "finished") {
        leaveRoom();
      }
    };

    const shouldShow = activeTab !== "play" || game?.phase === "finished";
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
    <main className="app" data-theme={theme}>
      <Header
        theme={theme}
        setTheme={setTheme}
        subtitle={subtitle}
        connection={connection}
      />

      {profile && (
        <section className="profileStrip">
          <div><span>Рейтинг</span><b>{Math.round(profile.rating)}</b></div>
          <div><span>Уровень</span><b>{profile.level}</b></div>
          <div><span>Победы</span><b>{profile.wins}</b></div>
          <div><span>Поражения</span><b>{profile.losses}</b></div>
          <div><span>Серия</span><b>{profile.currentStreak}</b></div>
        </section>
      )}

      <section className="modeSwitch">
        <button className={mode === "classic" ? "active" : ""} onClick={() => setMode("classic")}>
          Классический
        </button>
        <button className={mode === "rpg" ? "active" : ""} onClick={() => setMode("rpg")}>
          RPG
        </button>
      </section>

      <section className="heroCard">
        <div className="playingCard left">6♠</div>
        <div className="crest">Д</div>
        <div className="playingCard right">A♥</div>
        <h1>{mode === "classic" ? "Классический дурак" : "Дурак с классами"}</h1>
        <p>
          {mode === "classic"
            ? "Подкидной или переводной — правила выбираешь ты."
            : "Шесть классов меняют привычную партию."}
        </p>
      </section>

      <section className="settings">
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

        {mode === "classic" && (
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

        <SettingRow
          label="Очередь"
          value={settings.ranked ? "Рейтинговая" : "Обычная"}
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
              Обычная
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
              ? "Рейтинг меняется. Игровые расходники отключены."
              : "Рейтинг не меняется, прогресс и статистика сохраняются."}
          </div>
        </SettingRow>

        {mode === "rpg" && (
          <div className="rpgNote">
            Класс выдаётся случайно перед партией. RPG всегда подкидной + переводной.
          </div>
        )}

        {error && <div className="errorBanner">{error}</div>}

        <button
          className="findGame"
          disabled={connection !== "online"}
          onClick={queueing ? leaveQueue : joinQueue}
        >
          {connection === "connecting"
            ? "ПОДКЛЮЧЕНИЕ..."
            : connection === "offline"
              ? "СЕРВЕР НЕДОСТУПЕН"
              : queueing
                ? "ОТМЕНИТЬ ПОИСК"
                : "НАЙТИ ИГРУ"}
        </button>

        {queueing && <div className="searchingPulse">Ищем игроков с такими же настройками…</div>}

        {!queueing && !privateLobby && (
          <div className="privateRoomTools">
            <div className="settingHint">Приватные комнаты всегда без изменения рейтинга.</div>
            <button
              className="secondaryGameButton"
              disabled={connection !== "online"}
              onClick={createPrivateRoom}
            >
              Создать комнату
            </button>
            <div className="joinPrivateRow">
              <input
                value={privateCodeInput}
                maxLength={6}
                placeholder="КОД"
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
          </div>
        )}

        {privateLobby && (
          <div className="privateLobbyCard">
            <div className="privateLobbyHead">
              <div>
                <span>Приватная комната</span>
                <strong>{privateLobby.currentPlayers}/{privateLobby.requiredPlayers}</strong>
              </div>
              <div className="privateCodeActions">
                <button onClick={copyPrivateCode}>
                  {copyNotice ? "Скопировано" : privateLobby.code}
                </button>
                <button aria-label="Поделиться комнатой" onClick={sharePrivateRoom}>↗</button>
              </div>
            </div>
            <div className="privateMembers">
              {privateLobby.members.map((member) => (
                <div className="privateMember" key={`${member.index}-${member.name}`}>
                  <div className="avatar">
                    {member.photoUrl ? <img src={member.photoUrl} alt="" /> : member.index + 1}
                  </div>
                  <span>
                    {member.name}
                    {member.isHost ? <small> хозяин</small> : null}
                    {member.isSelf ? <small> · ты</small> : null}
                  </span>
                </div>
              ))}
            </div>
            <div className="searchingPulse">
              Ждём ещё {Math.max(0, privateLobby.requiredPlayers - privateLobby.currentPlayers)} игрок(а)…
            </div>
            <button className="secondaryGameButton dangerOutline" onClick={leavePrivateRoom}>
              Выйти из комнаты
            </button>
          </div>
        )}
      </section>

      <nav className="bottomNav">
        <button className={activeTab === "play" ? "active" : ""} onClick={() => openTab("play")}>Играть</button>
        <button className={activeTab === "profile" ? "active" : ""} onClick={() => openTab("profile")}>Профиль</button>
        <button className={activeTab === "rating" ? "active" : ""} onClick={() => openTab("rating")}>Рейтинг</button>
        <button className={activeTab === "shop" ? "active" : ""} onClick={() => openTab("shop")}>Магазин</button>
      </nav>

      {activeTab !== "play" && (
        <section className="tabOverlay">
          <button className="tabClose" onClick={() => openTab("play")}>×</button>

          {activeTab === "profile" && (
            <>
              <h2>Профиль</h2>
              {profile ? (
                <div className="profileGrid">
                  <div><span>Рейтинг</span><b>{Math.round(profile.rating)}</b></div>
                  <div><span>Уровень</span><b>{profile.level}</b></div>
                  <div><span>Игр</span><b>{profile.games}</b></div>
                  <div><span>Побед</span><b>{profile.wins}</b></div>
                  <div><span>Поражений</span><b>{profile.losses}</b></div>
                  <div><span>Лучшая серия</span><b>{profile.bestStreak}</b></div>
                </div>
              ) : <p className="tabMuted">Профиль загружается…</p>}

              <h3>Последние матчи</h3>
              <div className="historyList">
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
                        : "без изменения рейтинга"}
                    </span>
                  </div>
                ))}
              </div>
            </>
          )}

          {activeTab === "rating" && (
            <>
              <h2>Рейтинг</h2>
              <div className="leaderboardList">
                {leaderboard.length === 0 && <p className="tabMuted">Загружаем таблицу…</p>}
                {leaderboard.map((entry) => (
                  <div className={`leaderboardRow ${entry.isSelf ? "self" : ""}`} key={`${entry.rank}-${entry.displayName}`}>
                    <b>#{entry.rank}</b>
                    <span>{entry.displayName}</span>
                    <strong>{Math.round(entry.rating)}</strong>
                  </div>
                ))}
              </div>
            </>
          )}

          {activeTab === "shop" && (
            <>
              <h2>Магазин</h2>
              <p className="tabMuted">Здесь будут покупки за Telegram Stars. В рейтинговых матчах игровые преимущества отключены.</p>
              <div className="shopGrid">
                <article>
                  <strong>↩ Возврат карты</strong>
                  <span>Вернуть свою последнюю карту, если сверху ещё ничего не положили.</span>
                </article>
                <article>
                  <strong>👁 Память стола</strong>
                  <span>На 5 секунд посмотреть уже вышедшие карты.</span>
                </article>
                <article>
                  <strong>🍅 Насмешки</strong>
                  <span>Помидоры, эмоции и другие визуальные реакции на соперников.</span>
                </article>
              </div>
            </>
          )}
        </section>
      )}
    </main>
  );
}

function Header(props: {
  theme: ThemeId;
  setTheme: (theme: ThemeId) => void;
  subtitle: string;
  connection?: ConnectionState;
}) {
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
      <select
        className="themeSelect"
        value={props.theme}
        onChange={(event) => props.setTheme(event.target.value as ThemeId)}
        aria-label="Стиль"
      >
        {themes.map((item) => (
          <option key={item.id} value={item.id}>{item.label}</option>
        ))}
      </select>
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
