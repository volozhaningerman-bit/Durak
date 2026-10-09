import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
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

const suitSymbol: Record<Suit, string> = {
  clubs: "♣",
  diamonds: "♦",
  hearts: "♥",
  spades: "♠"
};

const suitName: Record<Suit, string> = {
  clubs: "треф",
  diamonds: "бубен",
  hearts: "червей",
  spades: "пик"
};

function cardAriaLabel(card: Card): string {
  if (card.kind === "joker") return "Джокер";
  const rank =
    card.rank === "J"
      ? "валет"
      : card.rank === "Q"
        ? "дама"
        : card.rank === "K"
          ? "король"
          : card.rank === "A"
            ? "туз"
            : card.rank;
  return `${rank} ${suitName[card.suit]}`;
}

const rpgClassSigil: Record<RpgClassId, string> = {
  "trump-master": "♠",
  "wild-transfer": "↝",
  "five-limit": "Ⅴ",
  "first-thrower": "✦",
  "reverse-transfer": "↶",
  joker: "★"
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
  privateMatch: boolean;
  qaMatch?: boolean;
  rematchAvailable: boolean;
  rematchReadySeats: number[];
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
  lastRoundOutcome?: "take" | "discard";
  loserSeat?: number;
  draw: boolean;
}

type QaScenarioId = "2p" | "4p" | "6p" | "rpg" | "result";

function qaCard(
  id: string,
  suit: Suit,
  rank: Extract<Card, { kind: "standard" }>["rank"]
): Card {
  return { id, kind: "standard", suit, rank };
}

function qaPlayers(count: number, classes: Array<RpgClassId | undefined> = []): GameViewPlayer[] {
  const names = ["Ты", "Марина", "Антон", "Лис", "Ворон", "Mika"];
  return Array.from({ length: count }, (_, seat) => ({
    seat,
    classId: classes[seat],
    handCount: seat === 0 ? 6 : Math.max(2, 7 - seat),
    finished: false,
    name: names[seat] ?? `Игрок ${seat + 1}`
  }));
}

function buildQaGame(scenario: QaScenarioId): GameView {
  if (scenario === "2p") {
    return {
      id: "qa-2p",
      settings: { ...DEFAULT_CLASSIC_SETTINGS, playerCount: 2, variant: "transfer" },
      phase: "defending",
      privateMatch: true,
      rematchAvailable: false,
      rematchReadySeats: [],
      players: qaPlayers(2),
      self: {
        seat: 0,
        hand: [
          qaCard("qa-2-7c", "clubs", "7"),
          qaCard("qa-2-9h", "hearts", "9"),
          qaCard("qa-2-js", "spades", "J"),
          qaCard("qa-2-qd", "diamonds", "Q"),
          qaCard("qa-2-kc", "clubs", "K"),
          qaCard("qa-2-ah", "hearts", "A")
        ],
        ability: { wildTransfersLeft: 0, jokerAvailable: false },
        finished: false,
        name: "Ты"
      },
      deckCount: 23,
      discardCount: 4,
      trumpSuits: ["hearts"],
      trumpCard: qaCard("qa-2-trump", "hearts", "6"),
      table: [{ attack: qaCard("qa-2-attack", "clubs", "9") }],
      attackerSeat: 1,
      defenderSeat: 0,
      turnSeat: 0,
      direction: 1,
      roundAttackLimit: 6,
      defenderTaking: false,
      draw: false
    };
  }

  if (scenario === "4p") {
    return {
      id: "qa-4p",
      settings: { ...DEFAULT_CLASSIC_SETTINGS, playerCount: 4, variant: "throw-in" },
      phase: "throwing",
      privateMatch: true,
      rematchAvailable: false,
      rematchReadySeats: [],
      players: qaPlayers(4),
      self: {
        seat: 0,
        hand: [
          qaCard("qa-4-6c", "clubs", "6"),
          qaCard("qa-4-8d", "diamonds", "8"),
          qaCard("qa-4-10s", "spades", "10"),
          qaCard("qa-4-qh", "hearts", "Q"),
          qaCard("qa-4-as", "spades", "A")
        ],
        ability: { wildTransfersLeft: 0, jokerAvailable: false },
        finished: false,
        name: "Ты"
      },
      deckCount: 9,
      discardCount: 12,
      trumpSuits: ["diamonds"],
      trumpCard: qaCard("qa-4-trump", "diamonds", "7"),
      table: [
        { attack: qaCard("qa-4-a1", "clubs", "8"), defense: qaCard("qa-4-d1", "clubs", "10") },
        { attack: qaCard("qa-4-a2", "hearts", "8"), defense: qaCard("qa-4-d2", "hearts", "K") },
        { attack: qaCard("qa-4-a3", "spades", "K"), defense: qaCard("qa-4-d3", "diamonds", "9") }
      ],
      attackerSeat: 2,
      defenderSeat: 3,
      turnSeat: 0,
      direction: 1,
      roundAttackLimit: 5,
      defenderTaking: false,
      draw: false
    };
  }

  const classes: RpgClassId[] = [
    "wild-transfer",
    "trump-master",
    "five-limit",
    "first-thrower",
    "reverse-transfer",
    "joker"
  ];

  if (scenario === "result") {
    const players = qaPlayers(6, classes).map((player, index) => ({
      ...player,
      finished: index !== 5,
      place: index !== 5 ? index + 1 : undefined
    }));
    return {
      id: "qa-result",
      settings: { ...DEFAULT_RPG_SETTINGS, playerCount: 6, ranked: true },
      phase: "finished",
      privateMatch: true,
      rematchAvailable: true,
      rematchReadySeats: [1, 3],
      players,
      self: {
        seat: 0,
        hand: [],
        classId: "wild-transfer",
        ability: { wildTransfersLeft: 1, jokerAvailable: false },
        finished: true,
        place: 1,
        name: "Ты"
      },
      deckCount: 0,
      discardCount: 31,
      trumpSuits: ["spades"],
      trumpCard: qaCard("qa-r-trump", "spades", "6"),
      table: [],
      attackerSeat: 4,
      defenderSeat: 5,
      direction: -1,
      roundAttackLimit: 0,
      defenderTaking: false,
      lastRoundOutcome: "discard",
      loserSeat: 5,
      draw: false
    };
  }

  const playerCount = scenario === "6p" ? 6 : 4;
  const players = qaPlayers(playerCount, classes);
  const selfClass: RpgClassId = scenario === "rpg" ? "joker" : "wild-transfer";
  players[0].classId = selfClass;

  return {
    id: `qa-${scenario}`,
    settings: { ...DEFAULT_RPG_SETTINGS, playerCount, ranked: false },
    phase: "defending",
    privateMatch: true,
    rematchAvailable: false,
    rematchReadySeats: [],
    players,
    self: {
      seat: 0,
      hand: [
        qaCard(`qa-${scenario}-6c`, "clubs", "6"),
        qaCard(`qa-${scenario}-8h`, "hearts", "8"),
        qaCard(`qa-${scenario}-10d`, "diamonds", "10"),
        qaCard(`qa-${scenario}-js`, "spades", "J"),
        qaCard(`qa-${scenario}-kh`, "hearts", "K"),
        ...(selfClass === "joker" ? [{ id: `qa-${scenario}-joker`, kind: "joker" as const }] : [])
      ],
      classId: selfClass,
      ability: {
        wildTransfersLeft: selfClass === "wild-transfer" ? 2 : 0,
        jokerAvailable: selfClass === "joker"
      },
      finished: false,
      name: "Ты"
    },
    deckCount: 14,
    discardCount: 8,
    trumpSuits: ["spades"],
    trumpCard: qaCard(`qa-${scenario}-trump`, "spades", "7"),
    table: [
      { attack: qaCard(`qa-${scenario}-a1`, "hearts", "10") },
      { attack: qaCard(`qa-${scenario}-a2`, "clubs", "10"), defense: qaCard(`qa-${scenario}-d2`, "clubs", "Q") }
    ],
    attackerSeat: 2,
    defenderSeat: 0,
    turnSeat: 0,
    direction: scenario === "6p" ? -1 : 1,
    roundAttackLimit: 6,
    defenderTaking: false,
    draw: false
  };
}


type HandMotion = "deal" | "draw" | "take";
type TableMotion = "self" | "opponent";
type OpponentMotion = "deal" | "draw" | "take" | "play" | "finish";

interface ClearedTableMotion {
  token: number;
  kind: "discard" | "take";
  cards: Card[];
  discardedCards: Card[];
  targetSeat: number;
  toSelf: boolean;
}

interface GameMotionState {
  hand: Record<string, HandMotion>;
  attack: Record<string, TableMotion>;
  defense: Record<string, TableMotion>;
  opponents: Record<number, OpponentMotion>;
  cleared?: ClearedTableMotion;
  transfer?: { token: number; reverse: boolean; direction: 1 | -1 };
  deckPulse: boolean;
  discardPulse: boolean;
  takeDeclared: boolean;
  trumpReveal: boolean;
  selfFinished: boolean;
}

function tableCards(game: GameView): Card[] {
  return game.table.flatMap((pair) =>
    pair.defense ? [pair.attack, pair.defense] : [pair.attack]
  );
}

function initialGameMotion(game: GameView): GameMotionState {
  return {
    hand: Object.fromEntries(game.self.hand.map((card) => [card.id, "deal" as const])),
    attack: {},
    defense: {},
    opponents: Object.fromEntries(
      game.players
        .filter((player) => player.seat !== game.self.seat)
        .map((player) => [player.seat, "deal" as const])
    ),
    deckPulse: true,
    discardPulse: false,
    takeDeclared: false,
    trumpReveal: Boolean(game.trumpCard),
    selfFinished: false
  };
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

interface MatchProgressView {
  result: "win" | "loss" | "draw";
  ranked: boolean;
  ratingBefore: number;
  ratingAfter: number;
  ratingDelta: number;
}

interface TelegramUserView {
  id: number;
  firstName: string;
  lastName?: string;
  username?: string;
  photoUrl?: string;
  isPremium?: boolean;
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
    connected?: boolean;
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
  RECENT_PLAYERS_LOAD_FAILED: "Не удалось загрузить недавних игроков",
  REMATCH_UNAVAILABLE: "Рематч недоступен: один из игроков уже покинул стол",
  REMATCH_RESULT_PENDING: "Сохраняем результат партии — рематч станет доступен сразу после этого",
  QA_BOT_STALLED: "QA-бот не нашёл допустимый ход — состояние сохранено для проверки",
  DATABASE_UNAVAILABLE: "База данных просыпается. Переподключаемся…"
};

function readableError(code?: string): string {
  if (!code) return "Ошибка игры";
  return errorMessages[code] ?? "Не удалось выполнить действие";
}

function playersLabel(count: number): string {
  const mod100 = Math.abs(count) % 100;
  const mod10 = mod100 % 10;
  const word =
    mod100 >= 11 && mod100 <= 14
      ? "игроков"
      : mod10 === 1
        ? "игрок"
        : mod10 >= 2 && mod10 <= 4
          ? "игрока"
          : "игроков";
  return `${count} ${word}`;
}

const backendOrigin = (import.meta.env.VITE_BACKEND_ORIGIN as string | undefined)
  ?.trim()
  .replace(/\/$/, "");

function apiUrl(path: string): string {
  return backendOrigin ? `${backendOrigin}${path}` : path;
}

function websocketUrl(): string {
  if (backendOrigin) {
    const url = new URL(backendOrigin);
    const protocol = url.protocol === "https:" ? "wss:" : "ws:";
    return `${protocol}//${url.host}/ws`;
  }

  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  const host =
    window.location.hostname === "localhost"
      ? `${window.location.hostname}:3001`
      : window.location.host;
  return `${protocol}//${host}/ws`;
}

export function App() {
  const [mode, setMode] = useState<GameMode>("classic");
  const [qaMode, setQaMode] = useState(() => {
    const queryQa = new URLSearchParams(window.location.search).get("qa");
    const startParam = window.Telegram?.WebApp?.initDataUnsafe?.start_param;
    return queryQa === "1" || startParam === "qa";
  });
  const qaTapCountRef = useRef(0);
  const [theme, setTheme] = useState<ThemeId>(() => {
    try {
      const saved = window.localStorage.getItem("durak-theme");
      if (saved === "light" || saved === "dark") return saved;
    } catch {
      // Theme persistence is optional.
    }
    return window.Telegram?.WebApp?.colorScheme === "light" ? "light" : "dark";
  });
  const [classic, setClassic] = useState<GameSettings>({ ...DEFAULT_CLASSIC_SETTINGS });
  const [rpg, setRpg] = useState<GameSettings>({ ...DEFAULT_RPG_SETTINGS });
  const [connection, setConnection] = useState<ConnectionState>("connecting");
  const [initialReady, setInitialReady] = useState(false);
  const [queueing, setQueueing] = useState(false);
  const [profile, setProfile] = useState<PlayerProgress | null>(null);
  const [telegramUser, setTelegramUser] = useState<TelegramUserView | null>(null);
  const [game, setGame] = useState<GameView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedAttackId, setSelectedAttackId] = useState<string | null>(null);
  const [selectedHandId, setSelectedHandId] = useState<string | null>(null);
  const [actionPending, setActionPending] = useState(false);
  const [activeTab, setActiveTab] = useState<LobbyTab>("play");
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([]);
  const [history, setHistory] = useState<MatchHistoryEntry[]>([]);
  const [lastMatchProgress, setLastMatchProgress] = useState<MatchProgressView | null>(null);
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

  useEffect(() => {
    const background = theme === "dark" ? "#101113" : "#f2f0ea";
    const telegram = window.Telegram?.WebApp;

    try {
      window.localStorage.setItem("durak-theme", theme);
    } catch {
      // Theme persistence is optional.
    }

    document.documentElement.style.backgroundColor = background;
    document.documentElement.style.colorScheme = theme;
    document.body.style.backgroundColor = background;
    document.querySelector('meta[name="theme-color"]')?.setAttribute("content", background);

    telegram?.setHeaderColor?.(background);
    telegram?.setBackgroundColor?.(background);
    telegram?.setBottomBarColor?.(background);
  }, [theme]);

  const subtitle = useMemo(
    () =>
      mode === "classic"
        ? "Настрой правила и найди соперников"
        : "Случайный класс. Никаких одинаковых ролей.",
    [mode]
  );

  useEffect(() => {
    const telegram = window.Telegram?.WebApp;
    telegram?.ready();
    telegram?.expand();
    try {
      telegram?.requestFullscreen?.();
    } catch {
      // Fullscreen is optional on older Telegram clients.
    }

    void fetch(apiUrl("/api/config"))
      .then((response) => response.json())
      .then((config: { botUsername?: string }) => {
        if (config.botUsername) setBotUsername(config.botUsername);
      })
      .catch(() => undefined);

    let stopped = false;
    let authBlocked = false;
    let reconnectTimer: number | undefined;
    let reconnectAttempt = 0;

    const connect = () => {
      if (stopped || authBlocked) return;
      const current = socketRef.current;
      if (
        current &&
        (current.readyState === WebSocket.OPEN || current.readyState === WebSocket.CONNECTING)
      ) {
        return;
      }

      setConnection("connecting");
      const socket = new WebSocket(websocketUrl());
      socketRef.current = socket;

      socket.onopen = () => {
        setError(null);

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
          const delay = Math.min(1500 * Math.pow(1.6, reconnectAttempt), 8000);
          reconnectAttempt += 1;
          reconnectTimer = window.setTimeout(connect, delay);
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
            progress?: MatchProgressView;
            user?: TelegramUserView;
            entries?: unknown[];
            name?: string;
            settings?: GameSettings;
            members?: PrivateLobbyView["members"];
            currentPlayers?: number;
            requiredPlayers?: number;
            isHost?: boolean;
            restoredPrivateLobby?: string;
          };

          if (message.type === "auth_ok") {
            reconnectAttempt = 0;
            setInitialReady(true);
            setConnection("online");
            if (message.profile) setProfile(message.profile);
            if (message.user) setTelegramUser(message.user);
            setError(null);

            if (!handledStartParamRef.current) {
              const telegramStartParam = window.Telegram?.WebApp?.initDataUnsafe?.start_param;
              const urlStartParam = new URLSearchParams(window.location.search).get("tgWebAppStartParam");
              const startParam = telegramStartParam ?? urlStartParam;
              const roomMatch = startParam?.match(/^room_([A-Z2-9]{6})$/i);

              handledStartParamRef.current = true;
              if (message.restoredPrivateLobby) {
                setPrivateCodeInput(message.restoredPrivateLobby);
              } else if (roomMatch) {
                const code = roomMatch[1].toUpperCase();
                setPrivateCodeInput(code);
                socket.send(JSON.stringify({ type: "join_private_room", code }));
              }
            }
            return;
          }

          if (message.type === "profile_updated") {
            if (message.profile) setProfile(message.profile);
            if (message.progress) setLastMatchProgress(message.progress);
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
            const transientDatabaseError = message.code === "DATABASE_UNAVAILABLE";
            authBlocked = !transientDatabaseError;
            setInitialReady(!transientDatabaseError);
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
            setMode(message.settings.mode);
            if (message.settings.mode === "classic") {
              setClassic(message.settings);
            } else {
              setRpg(message.settings);
            }
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
              setLastMatchProgress(null);
              window.Telegram?.WebApp?.HapticFeedback?.notificationOccurred("success");
            }
            setActionPending(false);
            setGame(message.state);
            if (!message.state.qaMatch) {
              rememberRecentPlayers(
                message.state.players
                  .filter((player) => player.seat !== message.state!.self.seat)
                  .map((player) => ({
                    name: player.name,
                    username: player.username,
                    photoUrl: player.photoUrl
                  }))
              );
            }
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

    const reconnectNow = () => {
      if (stopped || authBlocked) return;
      window.clearTimeout(reconnectTimer);
      reconnectAttempt = 0;

      const socket = socketRef.current;
      if (socket?.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({ type: "ping" }));
        return;
      }

      if (socket?.readyState === WebSocket.CONNECTING) return;
      reconnectTimer = window.setTimeout(connect, 0);
    };

    const handleVisibility = () => {
      if (document.visibilityState === "visible") reconnectNow();
    };

    connect();
    window.addEventListener("online", reconnectNow);
    document.addEventListener("visibilitychange", handleVisibility);

    return () => {
      stopped = true;
      window.clearTimeout(reconnectTimer);
      window.removeEventListener("online", reconnectNow);
      document.removeEventListener("visibilitychange", handleVisibility);
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

  function startQaBotMatch(scenario: QaScenarioId) {
    const qaSettings: GameSettings =
      scenario === "rpg" || scenario === "result"
        ? {
            ...DEFAULT_RPG_SETTINGS,
            playerCount: scenario === "result" ? 6 : 4,
            ranked: false,
            gameplayItemsEnabled: false
          }
        : {
            ...DEFAULT_CLASSIC_SETTINGS,
            playerCount:
              scenario === "6p" ? 6 : scenario === "4p" ? 4 : 2,
            variant: scenario === "6p" ? "transfer" : "throw-in",
            ranked: false,
            gameplayItemsEnabled: false
          };

    setQaMode(false);
    setError(null);
    send({ type: "start_qa_bot_match", settings: qaSettings });
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
    setLastMatchProgress(null);
    send({ type: "leave_room" });
  }

  function requestRematch() {
    setError(null);
    send({ type: "request_rematch" });
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

  function unlockQaMode() {
    qaTapCountRef.current += 1;
    if (qaTapCountRef.current >= 5) {
      qaTapCountRef.current = 0;
      setQaMode(true);
      window.Telegram?.WebApp?.HapticFeedback?.notificationOccurred("success");
    }
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
      if (game?.phase === "finished" || game?.qaMatch) {
        leaveRoom();
      }
    };

    const shouldShow = game?.phase === "finished" || game?.qaMatch === true;
    if (shouldShow) {
      backButton.show();
      backButton.onClick(handleBack);
    } else {
      backButton.hide();
    }

    return () => {
      backButton.offClick(handleBack);
    };
  }, [activeTab, game?.phase, game?.qaMatch]);

  if (qaMode) {
    return (
      <QaHarness
        theme={theme}
        setTheme={setTheme}
        connection={connection}
        onStartBotMatch={startQaBotMatch}
        onExit={() => setQaMode(false)}
      />
    );
  }

  if (!initialReady) {
    return (
      <BootScreen
        theme={theme}
        connection={connection}
        error={error}
      />
    );
  }

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
        onRematch={requestRematch}
        matchProgress={lastMatchProgress}
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
        onBrandTap={unlockQaMode}
      />

      <section className="screenBody">
        {activeTab === "play" && (
          <section className="tabPage playPage">
            {queueing ? (
              <div className="searchStage">
                <div className="searchCards" aria-hidden="true">
                  <span className="searchCard cardOne">
                    <CardFace card={{ id: "search-6", kind: "standard", suit: "spades", rank: "6" }} mode={mode} />
                  </span>
                  <span className="searchCard cardTwo">
                    <CardBack mode={mode} />
                  </span>
                  <span className="searchCard cardThree">
                    <CardFace card={{ id: "search-a", kind: "standard", suit: "hearts", rank: "A" }} mode={mode} />
                  </span>
                </div>
                <span className="modeEyebrow">
                  {mode === "classic" ? "КЛАССИЧЕСКАЯ ИГРА" : "RPG • СЛУЧАЙНЫЙ КЛАСС"}
                </span>
                <h2>Ищем соперников</h2>
                <p>
                  {playersLabel(settings.playerCount)} · {settings.ranked ? "рейтинг" : "обычная"} ·
                  {" "}{settings.throwInPolicy === "all" ? "подкидывают все" : "подкидывают крайние"}
                </p>
                <div className="searchDots" aria-hidden="true"><i /><i /><i /></div>
                <button className="findGame cancelSearch" onClick={leaveQueue}>
                  ОТМЕНИТЬ ПОИСК
                </button>
              </div>
            ) : privateLobby ? (
              <div className={`privateLobbyStage ${privateLobby.settings.mode}`}>
                <div className="privateLobbyHead">
                  <div className="privateLobbyTitle">
                    <span>ПРИВАТНЫЙ СТОЛ</span>
                    <strong>{privateLobby.settings.mode === "classic" ? "Классика" : "Durak RPG"}</strong>
                    <small>
                      {privateLobby.settings.mode === "classic"
                        ? `${privateLobby.settings.variant === "throw-in" ? "Подкидной" : "Переводной"} · ${privateLobby.settings.throwInPolicy === "all" ? "подкидывают все" : "подкидывают крайние"}`
                        : `Подкидной + переводной · ${privateLobby.settings.throwInPolicy === "all" ? "подкидывают все" : "подкидывают крайние"}`}
                    </small>
                  </div>
                  <div className="privateSeatCounter">
                    <small>ИГРОКИ</small>
                    <b>{privateLobby.currentPlayers}/{privateLobby.requiredPlayers}</b>
                  </div>
                </div>

                <div className="privateCodePanel">
                  <div className="privateCodeLabel">
                    <small>КОД КОМНАТЫ</small>
                    <strong>{privateLobby.code}</strong>
                  </div>
                  <div className="privateCodeActions">
                    <button onClick={copyPrivateCode}>
                      {copyNotice ? "ГОТОВО" : "КОПИРОВАТЬ"}
                    </button>
                    <button className="invitePulse" aria-label="Поделиться комнатой" onClick={sharePrivateRoom}>↗</button>
                  </div>
                </div>

                <div className="waitingTable">
                  <div className="waitingDeck" aria-hidden="true">
                    <CardBack mode={privateLobby.settings.mode} compact />
                    <CardBack mode={privateLobby.settings.mode} compact />
                  </div>
                  <div className={`waitingSeats seats-${privateLobby.requiredPlayers}`}>
                    {Array.from({ length: privateLobby.requiredPlayers }, (_, index) => {
                      const member = privateLobby.members[index];
                      return member ? (
                        <div className={`waitingSeat filled ${member.connected === false ? "reconnecting" : ""}`} key={index}>
                          <div className="avatar">
                            {member.photoUrl ? <img src={member.photoUrl} alt="" /> : index + 1}
                          </div>
                          <b>{member.name}</b>
                          <small>
                            {member.connected === false
                              ? "переподключается"
                              : member.isSelf
                                ? "ты"
                                : member.isHost
                                  ? "хозяин"
                                  : "готов"}
                          </small>
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
                  <div>
                    <b>
                      {privateLobby.members.some((member) => member.connected === false)
                        ? "Ждём переподключение игрока"
                        : privateLobby.requiredPlayers - privateLobby.currentPlayers > 0
                          ? `Ждём ещё ${playersLabel(privateLobby.requiredPlayers - privateLobby.currentPlayers)}`
                          : "Все на месте — запускаем матч"}
                    </b>
                    <small>
                      {privateLobby.members.some((member) => member.connected === false)
                        ? "Место сохранено на короткое время"
                        : "Матч начнётся автоматически, когда стол заполнится"}
                    </small>
                  </div>
                </div>

                <div className="lobbyActions">
                  <button
                    className="secondaryGameButton inviteMain"
                    disabled={
                      privateLobby.members.length >= privateLobby.requiredPlayers &&
                      privateLobby.members.some((member) => member.connected === false)
                    }
                    onClick={sharePrivateRoom}
                  >
                    {privateLobby.members.length >= privateLobby.requiredPlayers &&
                    privateLobby.members.some((member) => member.connected === false)
                      ? "ЖДЁМ ВОЗВРАТ"
                      : "ПРИГЛАСИТЬ"}
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
                  <section className="lobbyIdentityRail">
                    <div className="lobbyAvatar">
                      {telegramUser?.photoUrl
                        ? <img src={telegramUser.photoUrl} alt="" />
                        : <span>{telegramUser?.firstName?.slice(0, 1) ?? "Д"}</span>}
                    </div>
                    <div className="lobbyIdentity">
                      <small>ИГРОК</small>
                      <b>
                        {telegramUser
                          ? [telegramUser.firstName, telegramUser.lastName].filter(Boolean).join(" ")
                          : "Durak RPG"}
                      </b>
                      <span>{telegramUser?.username ? `@${telegramUser.username}` : `уровень ${profile.level}`}</span>
                    </div>
                    <div className="lobbyRating">
                      <small>RP</small>
                      <strong>{Math.round(profile.rating)}</strong>
                    </div>
                    <div className="lobbyMiniStat">
                      <small>W</small>
                      <b>{profile.wins}</b>
                    </div>
                    <div className="lobbyMiniStat">
                      <small>STREAK</small>
                      <b>{profile.currentStreak}</b>
                    </div>
                  </section>
                )}

                <section className="modeSwitch modeChooser" aria-label="Выбор режима">
                  <button
                    className={mode === "classic" ? "active" : ""}
                    aria-pressed={mode === "classic"}
                    onClick={() => setMode("classic")}
                  >
                    <span className="modeChoiceSigil">♠</span>
                    <span className="modeChoiceCopy">
                      <b>Классика</b>
                      <small>знакомые правила</small>
                    </span>
                    <span className="modeChoiceState">{mode === "classic" ? "ВЫБРАНО" : "ВЫБРАТЬ"}</span>
                  </button>
                  <button
                    className={mode === "rpg" ? "active" : ""}
                    aria-pressed={mode === "rpg"}
                    onClick={() => setMode("rpg")}
                  >
                    <span className="modeChoiceSigil">✦</span>
                    <span className="modeChoiceCopy">
                      <b>RPG</b>
                      <small>6 уникальных классов</small>
                    </span>
                    <span className="modeChoiceState">{mode === "rpg" ? "ВЫБРАНО" : "ВЫБРАТЬ"}</span>
                  </button>
                </section>

                <section className={`heroCard modeHero ${mode}`}>
                  <div className="playingCard left">
                    <CardFace
                      card={mode === "classic"
                        ? { id: "hero-left", kind: "standard", suit: "spades", rank: "6" }
                        : { id: "hero-left", kind: "standard", suit: "clubs", rank: "J" }}
                      mode={mode}
                    />
                  </div>
                  <div className="crest">{mode === "classic" ? "♠" : "✦"}</div>
                  <div className="playingCard right">
                    <CardFace
                      card={mode === "classic"
                        ? { id: "hero-right", kind: "standard", suit: "hearts", rank: "A" }
                        : { id: "hero-right", kind: "joker" }}
                      mode={mode}
                    />
                  </div>
                  <span className="modeEyebrow">
                    {mode === "classic" ? "36 КАРТ • ЧИСТЫЕ ПРАВИЛА" : "6 УНИКАЛЬНЫХ КЛАССОВ"}
                  </span>
                  <h1>{mode === "classic" ? "Классический дурак" : "Дурак RPG"}</h1>
                  <p>
                    {mode === "classic"
                      ? "Зелёный стол, привычные правила и ничего лишнего."
                      : "Каждая партия меняется из-за случайной способности."}
                  </p>
                  <div className="heroMarks" aria-hidden="true">
                    {mode === "classic" ? (
                      <>
                        <i>♠</i><i>♣</i><i className="redMark">♥</i><i className="redMark">♦</i>
                      </>
                    ) : (
                      <>
                        <i>♠</i><i>↝</i><i>Ⅴ</i><i>✦</i><i>↶</i><i>★</i>
                      </>
                    )}
                  </div>
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
          <section className="tabPage contentPage profilePage">
            <div className="pageHead">
              <div><span>ПРОФИЛЬ</span><h2>Карточка игрока</h2></div>
              {profile && <strong>{Math.round(profile.rating)} <small>RP</small></strong>}
            </div>
            <div className="playerPassport">
              <div className="passportAvatar">
                {telegramUser?.photoUrl
                  ? <img src={telegramUser.photoUrl} alt="" />
                  : <span>{telegramUser?.firstName?.slice(0, 1) ?? "Д"}</span>}
              </div>
              <div className="passportName">
                <small>ИГРОК</small>
                <b>
                  {telegramUser
                    ? [telegramUser.firstName, telegramUser.lastName].filter(Boolean).join(" ")
                    : "Durak RPG"}
                </b>
                <span>{telegramUser?.username ? `@${telegramUser.username}` : "Telegram player"}</span>
              </div>
              {profile && (
                <div className="passportLevel">
                  <small>УРОВЕНЬ</small>
                  <strong>{profile.level}</strong>
                </div>
              )}
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
          <section className="tabPage contentPage ratingPage">
            <div className="pageHead">
              <div><span>РЕЙТИНГ</span><h2>Таблица игроков</h2></div>
              <strong>±30</strong>
            </div>
            <details className="ratingRuleCard">
              <summary>
                <span>Как начисляется рейтинг</span>
                <b>пул 30 RP</b>
              </summary>
              <div className="ratingRuleBody">
                <span>Дурак теряет 30. Победители делят эти 30 по порядку выхода: первый получает больше всех.</span>
                <div className="ratingExamples">
                  <small>2: +30 / −30</small>
                  <small>3: +20 · +10 / −30</small>
                  <small>4: +15 · +10 · +5 / −30</small>
                  <small>5: +12 · +9 · +6 · +3 / −30</small>
                  <small>6: +10 · +8 · +6 · +4 · +2 / −30</small>
                </div>
              </div>
            </details>
            <div className="leaderboardList innerScroll">
              {leaderboard.length === 0 && <p className="tabMuted">Загружаем таблицу…</p>}
              {leaderboard.map((entry) => (
                <div className={`leaderboardRow ${entry.isSelf ? "self" : ""}`} key={`${entry.rank}-${entry.displayName}`}>
                  <b>#{entry.rank}</b>
                  <span>{entry.displayName}</span>
                  <strong>{Math.round(entry.rating)}</strong>
                </div>
              ))}
              {leaderboard.length > 0 && leaderboard.length < 5 && (
                <div className="ratingSeasonHint">
                  <small>СТАРТ ТАБЛИЦЫ</small>
                  <b>Здесь скоро появятся соперники</b>
                  <span>Сыгранные рейтинговые матчи автоматически заполняют лидерборд.</span>
                </div>
              )}
            </div>
          </section>
        )}

        {activeTab === "shop" && (
          <section className="tabPage contentPage shopPage">
            <div className="pageHead">
              <div><span>МАГАЗИН</span><h2>Stars и эмоции</h2></div>
              <strong>★</strong>
            </div>
            <p className="tabMuted">В рейтинговых матчах игровые преимущества отключены.</p>
            <div className="deckShelf">
              <article>
                <div className="deckPreview"><CardBack mode="classic" /></div>
                <div><small>КОЛОДА</small><strong>Зелёный стол</strong><span>Базовая классическая рубашка</span></div>
                <b>ВКЛЮЧЕНА</b>
              </article>
              <article>
                <div className="deckPreview"><CardBack mode="rpg" /></div>
                <div><small>КОЛОДА</small><strong>Печать классов</strong><span>Базовая рубашка режима RPG</span></div>
                <b>ВКЛЮЧЕНА</b>
              </article>
            </div>
            <div className="shopGrid innerScroll">
              <article className="shopTicket">
                <span className="shopGlyph">↶</span>
                <div><small>РАСХОДНИК</small><strong>Возврат карты</strong><p>Вернуть последнюю карту, пока поверх неё никто не сыграл.</p></div>
                <b>СКОРО</b>
              </article>
              <article className="shopTicket">
                <span className="shopGlyph">◉</span>
                <div><small>РАСХОДНИК</small><strong>Память стола</strong><p>На 5 секунд показать карты, уже вышедшие из игры.</p></div>
                <b>СКОРО</b>
              </article>
              <article className="shopTicket">
                <span className="shopGlyph">✦</span>
                <div><small>ЭМОЦИЯ</small><strong>Насмешки</strong><p>Визуальные реакции на соперников без влияния на правила.</p></div>
                <b>СКОРО</b>
              </article>
            </div>
          </section>
        )}
      </section>

      <nav className="bottomNav">
        <button className={activeTab === "play" ? "active" : ""} onClick={() => openTab("play")}>
          <i aria-hidden="true">⌂</i><span>Играть</span>
        </button>
        <button className={activeTab === "profile" ? "active" : ""} onClick={() => openTab("profile")}>
          <i aria-hidden="true">♙</i><span>Профиль</span>
        </button>
        <button className={activeTab === "rating" ? "active" : ""} onClick={() => openTab("rating")}>
          <i aria-hidden="true">♜</i><span>Рейтинг</span>
        </button>
        <button className={activeTab === "shop" ? "active" : ""} onClick={() => openTab("shop")}>
          <i aria-hidden="true">◇</i><span>Магазин</span>
        </button>
      </nav>
    </main>
  );
}


function BootScreen(props: {
  theme: ThemeId;
  connection: ConnectionState;
  error: string | null;
}) {
  return (
    <main className="bootScreen" data-theme={props.theme}>
      <div className="bootMark" aria-hidden="true">
        <span className="bootCard bootCardLeft">
          <CardFace card={{ id: "boot-6", kind: "standard", suit: "spades", rank: "6" }} mode="classic" />
        </span>
        <span className="bootSeal">Д</span>
        <span className="bootCard bootCardRight">
          <CardFace card={{ id: "boot-a", kind: "standard", suit: "hearts", rank: "A" }} mode="rpg" />
        </span>
      </div>
      <div className="bootWordmark">
        <b>DURAK</b>
        <span>RPG</span>
      </div>
      <div className="bootStatus">
        <div className="bootProgress" aria-hidden="true"><i /><i /><i /></div>
        <strong>
          {props.connection === "connecting"
            ? "Открываем игровой стол"
            : "Поднимаем игровой сервер"}
        </strong>
        <small>
          {props.error
            ? props.error
            : props.connection === "connecting"
              ? "Интерфейс уже загружен. Подключаем правила и игроков…"
              : "Сервер просыпается автоматически — повторяем подключение."}
        </small>
      </div>
    </main>
  );
}

function Header(props: {
  theme: ThemeId;
  setTheme: (theme: ThemeId) => void;
  subtitle: string;
  connection?: ConnectionState;
  onBrandTap?: () => void;
}) {
  return (
    <header className="topbar">
      <div className="headerCopy">
        <strong
          className={`brand ${props.onBrandTap ? "brandInteractive" : ""}`}
          onClick={props.onBrandTap}
        >
          DURAK <span>RPG</span>
        </strong>
        <div className="subtitle">
          <span className="subtitleText">{props.subtitle}</span>
          {props.connection && (
            <span
              className={`connectionDot ${props.connection}`}
              aria-label={
                props.connection === "online"
                  ? "Онлайн"
                  : props.connection === "connecting"
                    ? "Подключение"
                    : "Нет соединения"
              }
              title={
                props.connection === "online"
                  ? "Онлайн"
                  : props.connection === "connecting"
                    ? "Подключение"
                    : "Нет соединения"
              }
            />
          )}
        </div>
      </div>
      <div className="headerActions">
        <button
          className="themeToggle"
          onClick={() => props.setTheme(props.theme === "dark" ? "light" : "dark")}
          aria-label={props.theme === "dark" ? "Включить светлую тему" : "Включить тёмную тему"}
          title={props.theme === "dark" ? "Светлая тема" : "Тёмная тема"}
        >
          <span aria-hidden="true">{props.theme === "dark" ? "☼" : "◐"}</span>
          <b>{props.theme === "dark" ? "Свет" : "Ночь"}</b>
        </button>
      </div>
    </header>
  );
}

function QaHarness(props: {
  theme: ThemeId;
  setTheme: (theme: ThemeId) => void;
  connection: ConnectionState;
  onStartBotMatch: (scenario: QaScenarioId) => void;
  onExit: () => void;
}) {
  const [scenario, setScenario] = useState<QaScenarioId>("2p");
  const [dockOpen, setDockOpen] = useState(true);
  const [selectedAttackId, setSelectedAttackId] = useState<string | null>(null);
  const [selectedHandId, setSelectedHandId] = useState<string | null>(null);
  const game = useMemo(() => buildQaGame(scenario), [scenario]);

  useEffect(() => {
    setSelectedAttackId(null);
    setSelectedHandId(null);
  }, [scenario]);

  return (
    <>
      <GameScreen
        game={game}
        connection="online"
        actionPending={false}
        theme={props.theme}
        setTheme={props.setTheme}
        error={null}
        selectedAttackId={selectedAttackId}
        setSelectedAttackId={setSelectedAttackId}
        selectedHandId={selectedHandId}
        setSelectedHandId={setSelectedHandId}
        onAction={() => {
          window.Telegram?.WebApp?.HapticFeedback?.impactOccurred("light");
        }}
        onLeaveRoom={props.onExit}
        onRematch={() => setScenario("2p")}
        matchProgress={
          scenario === "result"
            ? {
                result: "win",
                ranked: true,
                ratingBefore: 1240,
                ratingAfter: 1250,
                ratingDelta: 10
              }
            : null
        }
      />

      <aside className={`qaDock ${dockOpen ? "open" : ""}`}>
        <button
          className="qaDockToggle"
          onClick={() => setDockOpen((value) => !value)}
          aria-label={dockOpen ? "Скрыть QA-панель" : "Показать QA-панель"}
        >
          QA
        </button>
        {dockOpen && (
          <div className="qaDockPanel">
            <small>ВИЗУАЛЬНЫЙ ТЕСТ</small>
            <div className="qaScenarioButtons">
              {([
                ["2p", "2"],
                ["4p", "4"],
                ["6p", "6"],
                ["rpg", "RPG"],
                ["result", "Финиш"]
              ] as Array<[QaScenarioId, string]>).map(([id, label]) => (
                <button
                  key={id}
                  className={scenario === id ? "active" : ""}
                  onClick={() => setScenario(id)}
                >
                  {label}
                </button>
              ))}
            </div>
            <button
              className="qaLiveStart"
              disabled={props.connection !== "online"}
              onClick={() => props.onStartBotMatch(scenario)}
            >
              {props.connection === "online" ? "ИГРАТЬ С QA" : "ПОДКЛЮЧЕНИЕ…"}
            </button>
            <button className="qaExit" onClick={props.onExit}>ВЫЙТИ</button>
          </div>
        )}
      </aside>
    </>
  );
}

const handSuitOrder: Suit[] = ["spades", "hearts", "clubs", "diamonds"];
const handRankOrder: Record<Extract<Card, { kind: "standard" }>["rank"], number> = {
  "6": 6,
  "7": 7,
  "8": 8,
  "9": 9,
  "10": 10,
  J: 11,
  Q: 12,
  K: 13,
  A: 14
};

function sortHandCards(cards: Card[]): Card[] {
  return [...cards].sort((a, b) => {
    if (a.kind === "joker") return b.kind === "joker" ? 0 : 1;
    if (b.kind === "joker") return -1;

    const suitDifference =
      handSuitOrder.indexOf(a.suit) - handSuitOrder.indexOf(b.suit);
    if (suitDifference !== 0) return suitDifference;
    return handRankOrder[a.rank] - handRankOrder[b.rank];
  });
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
  onRematch: () => void;
  matchProgress: MatchProgressView | null;
}) {
  const { game } = props;
  const isMyTurn = game.turnSeat === game.self.seat;
  const myClass = game.self.classId ? RPG_CLASS_NAMES[game.self.classId] : undefined;
  const myClassDescription = game.self.classId
    ? RPG_CLASS_DESCRIPTIONS[game.self.classId]
    : undefined;
  const [motion, setMotion] = useState<GameMotionState>(() => initialGameMotion(game));
  const previousGameRef = useRef<GameView>(game);
  const motionTimerRef = useRef<number | undefined>(undefined);
  const firstMotionPassRef = useRef(true);
  const suppressNextMotionRef = useRef(false);
  const prefersReducedMotion = useMemo(
    () => window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true,
    []
  );
  const motionBusy =
    Object.keys(motion.hand).length > 0 ||
    Object.keys(motion.attack).length > 0 ||
    Object.keys(motion.defense).length > 0 ||
    Object.keys(motion.opponents).length > 0 ||
    Boolean(motion.cleared) ||
    Boolean(motion.transfer) ||
    motion.takeDeclared ||
    motion.trumpReveal ||
    motion.selfFinished;
  const controlsDisabled =
    props.connection !== "online" ||
    props.actionPending ||
    (motionBusy && !prefersReducedMotion);
  const rematchReadySeats = game.rematchReadySeats ?? [];
  const rematchReady = rematchReadySeats.includes(game.self.seat);
  const rematchReadyCount = rematchReadySeats.length;
  const sortedHand = useMemo(() => sortHandCards(game.self.hand), [game.self.hand]);
  const [dragCard, setDragCard] = useState<{
    cardId: string;
    pointerId: number;
    x: number;
    y: number;
    target: string | null;
  } | null>(null);

  useEffect(() => {
    if (props.connection !== "online") {
      suppressNextMotionRef.current = true;
    }
  }, [props.connection]);

  useEffect(() => () => {
    window.clearTimeout(motionTimerRef.current);
  }, []);

  useLayoutEffect(() => {
    const previous = previousGameRef.current;
    previousGameRef.current = game;

    if (firstMotionPassRef.current) {
      firstMotionPassRef.current = false;
      window.clearTimeout(motionTimerRef.current);
      motionTimerRef.current = window.setTimeout(() => {
        setMotion({
          hand: {},
          attack: {},
          defense: {},
          opponents: {},
          deckPulse: false,
          discardPulse: false,
          takeDeclared: false,
          trumpReveal: false,
          selfFinished: false
        });
      }, 950);
      return;
    }

    if (suppressNextMotionRef.current) {
      suppressNextMotionRef.current = false;
      window.clearTimeout(motionTimerRef.current);
      setMotion({
        hand: {},
        attack: {},
        defense: {},
        opponents: {},
        deckPulse: false,
        discardPulse: false,
        takeDeclared: false,
        trumpReveal: false,
        selfFinished: false
      });
      return;
    }

    if (previous.id !== game.id) {
      setMotion(initialGameMotion(game));
      window.clearTimeout(motionTimerRef.current);
      motionTimerRef.current = window.setTimeout(() => {
        setMotion({
          hand: {},
          attack: {},
          defense: {},
          opponents: {},
          deckPulse: false,
          discardPulse: false,
          takeDeclared: false,
          trumpReveal: false,
          selfFinished: false
        });
      }, 950);
      return;
    }

    const previousSelfIds = new Set(previous.self.hand.map((card) => card.id));
    const previousTable = tableCards(previous);
    const previousTableIds = new Set(previousTable.map((card) => card.id));
    const hand: Record<string, HandMotion> = {};
    const attack: Record<string, TableMotion> = {};
    const defense: Record<string, TableMotion> = {};
    const opponents: Record<number, OpponentMotion> = {};

    for (const card of game.self.hand) {
      if (previousSelfIds.has(card.id)) continue;
      hand[card.id] = previousTableIds.has(card.id) ? "take" : "draw";
    }

    for (const pair of game.table) {
      if (!previousTableIds.has(pair.attack.id)) {
        attack[pair.attack.id] = previousSelfIds.has(pair.attack.id)
          ? "self"
          : "opponent";
      }
      if (pair.defense && !previousTableIds.has(pair.defense.id)) {
        defense[pair.defense.id] = previousSelfIds.has(pair.defense.id)
          ? "self"
          : "opponent";
      }
    }

    for (const player of game.players) {
      if (player.seat === game.self.seat) continue;
      const before = previous.players.find((candidate) => candidate.seat === player.seat);
      if (!before) {
        opponents[player.seat] = "deal";
        continue;
      }
      if (!before.finished && player.finished) {
        opponents[player.seat] = "finish";
      } else if (player.handCount > before.handCount) {
        opponents[player.seat] =
          previous.defenderTaking && previous.defenderSeat === player.seat
            ? "take"
            : "draw";
      } else if (player.handCount < before.handCount) {
        opponents[player.seat] = "play";
      }
    }

    let cleared: ClearedTableMotion | undefined;
    if (previous.table.length > 0 && game.table.length === 0) {
      const outcome =
        game.lastRoundOutcome ??
        (previous.defenderTaking ? "take" : "discard");
      cleared = {
        token: Date.now(),
        kind: outcome,
        cards: previousTable,
        discardedCards: [],
        targetSeat: previous.defenderSeat,
        toSelf: previous.defenderSeat === previous.self.seat
      };
    }

    const defenderChanged = previous.defenderSeat !== game.defenderSeat;
    const directionChanged = previous.direction !== game.direction;
    const transfer =
      defenderChanged && game.table.length > 0
        ? {
            token: Date.now() + 1,
            reverse: directionChanged,
            direction: game.direction
          }
        : undefined;

    if (!prefersReducedMotion) {
      if (!previous.defenderTaking && game.defenderTaking && game.table.length > 0) {
        window.Telegram?.WebApp?.HapticFeedback?.impactOccurred("medium");
      } else if (directionChanged) {
        window.Telegram?.WebApp?.HapticFeedback?.impactOccurred("rigid");
      } else if (!previous.self.finished && game.self.finished) {
        window.Telegram?.WebApp?.HapticFeedback?.notificationOccurred("success");
      } else if (cleared?.kind === "discard") {
        window.Telegram?.WebApp?.HapticFeedback?.impactOccurred("soft");
      }
    }

    setMotion({
      hand,
      attack,
      defense,
      opponents,
      cleared,
      transfer,
      deckPulse: game.deckCount < previous.deckCount,
      discardPulse: game.discardCount > previous.discardCount,
      takeDeclared:
        !previous.defenderTaking &&
        game.defenderTaking &&
        game.table.length > 0,
      trumpReveal:
        previous.trumpSuits.length === 0 &&
        game.trumpSuits.length > 0,
      selfFinished:
        !previous.self.finished &&
        game.self.finished
    });

    window.clearTimeout(motionTimerRef.current);
    motionTimerRef.current = window.setTimeout(() => {
      setMotion({
        hand: {},
        attack: {},
        defense: {},
        opponents: {},
        deckPulse: false,
        discardPulse: false,
        takeDeclared: false,
        trumpReveal: false,
        selfFinished: false
      });
    }, cleared ? 980 : 640);

    return () => window.clearTimeout(motionTimerRef.current);
  }, [game]);

  const handMotionOrder = Object.keys(motion.hand);
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

  function canCardTransfer(card: Card): boolean {
    if (
      !isMyTurn ||
      controlsDisabled ||
      game.phase !== "defending" ||
      game.settings.variant !== "transfer" ||
      !transferStillAllowed ||
      card.kind !== "standard"
    ) {
      return false;
    }

    const matchesRank =
      attackRanks.length > 0 &&
      attackRanks.every((rank) => rank === card.rank);
    const usesWild =
      game.self.classId === "wild-transfer" &&
      game.self.ability.wildTransfersLeft > 0;
    return matchesRank || usesWild;
  }

  const transferDropVisible =
    game.phase === "defending" &&
    isMyTurn &&
    sortedHand.some((card) => canCardTransfer(card));

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

  function dropTargetAt(x: number, y: number): string | null {
    const element = document
      .elementsFromPoint(x, y)
      .find((candidate) => (candidate as HTMLElement).dataset.dropTarget);
    return (element as HTMLElement | undefined)?.dataset.dropTarget ?? null;
  }

  function beginCardDrag(card: Card, event: ReactPointerEvent<HTMLButtonElement>) {
    if (!cardPlayable(card)) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    props.setSelectedHandId(card.id);
    setDragCard({
      cardId: card.id,
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      target: dropTargetAt(event.clientX, event.clientY)
    });
    window.Telegram?.WebApp?.HapticFeedback?.selectionChanged();
  }

  function moveCardDrag(event: ReactPointerEvent<HTMLButtonElement>) {
    if (!dragCard || dragCard.pointerId !== event.pointerId) return;
    event.preventDefault();
    setDragCard((current) =>
      current
        ? {
            ...current,
            x: event.clientX,
            y: event.clientY,
            target: dropTargetAt(event.clientX, event.clientY)
          }
        : current
    );
  }

  function finishCardDrag(event: ReactPointerEvent<HTMLButtonElement>) {
    if (!dragCard || dragCard.pointerId !== event.pointerId) return;
    event.preventDefault();

    const card = game.self.hand.find((entry) => entry.id === dragCard.cardId);
    const target = dropTargetAt(event.clientX, event.clientY) ?? dragCard.target;
    setDragCard(null);
    props.setSelectedHandId(null);
    if (!card || !target) return;

    if (
      target === "attack" &&
      (game.phase === "attacking" || game.phase === "throwing") &&
      cardPlayable(card)
    ) {
      props.onAction({ type: "attack", cardId: card.id });
      window.Telegram?.WebApp?.HapticFeedback?.impactOccurred("light");
      return;
    }

    if (target.startsWith("defend:") && game.phase === "defending") {
      const attackCardId = target.slice("defend:".length);
      const pair = game.table.find(
        (entry) => entry.attack.id === attackCardId && !entry.defense
      );
      if (pair && canBeat(pair.attack, card, game.trumpSuits)) {
        props.onAction({
          type: "defend",
          attackCardId,
          cardId: card.id
        });
        window.Telegram?.WebApp?.HapticFeedback?.impactOccurred("medium");
        return;
      }
    }

    if (
      (target === "transfer" || target === "transfer-reverse") &&
      canCardTransfer(card)
    ) {
      props.onAction({
        type: "transfer",
        cardId: card.id,
        reverse: target === "transfer-reverse"
      });
      window.Telegram?.WebApp?.HapticFeedback?.impactOccurred("rigid");
      return;
    }

    window.Telegram?.WebApp?.HapticFeedback?.notificationOccurred("error");
  }

  function cancelCardDrag(event: ReactPointerEvent<HTMLButtonElement>) {
    if (!dragCard || dragCard.pointerId !== event.pointerId) return;
    setDragCard(null);
    props.setSelectedHandId(null);
  }

  const draggedCard = dragCard
    ? game.self.hand.find((card) => card.id === dragCard.cardId)
    : undefined;

  const turnPlayer = game.players.find((player) => player.seat === game.turnSeat);
  const phaseLabel =
    game.phase === "awaiting-trump"
      ? "ВЫБОР КОЗЫРЯ"
      : game.phase === "attacking"
        ? "АТАКА"
        : game.phase === "defending"
          ? "ЗАЩИТА"
          : game.phase === "throwing"
            ? "ПОДКИД"
            : "КОНЕЦ ПАРТИИ";

  const resultText =
    game.phase === "finished"
      ? game.draw
        ? "Ничья"
        : game.loserSeat === game.self.seat
          ? "Ты остался дураком"
          : `Дурак — игрок #${(game.loserSeat ?? 0) + 1}`
      : null;

  const turnHint =
    game.phase === "finished"
      ? resultText
      : !isMyTurn
        ? `${turnPlayer?.name ?? `Игрок #${(game.turnSeat ?? 0) + 1}`} думает…`
        : game.phase === "awaiting-trump"
          ? "Выбери одну козырную масть"
          : game.phase === "attacking"
            ? "Перетащи карту из руки на стол"
            : game.phase === "throwing"
              ? "Перетащи подходящую карту на стол или нажми «Пас»"
              : transferDropVisible
                ? "Перетащи карту на атаку, чтобы отбиться, или в область перевода"
                : "Перетащи карту на атакующую карту или нажми «Беру»";

  return (
    <main
      className="app gameApp"
      data-theme={props.theme}
      data-mode={game.settings.mode}
      data-motion={motion.cleared?.kind}
    >
      <header className="matchHud">
        <div className="matchHudBrand">
          <strong>DURAK <span>RPG</span></strong>
          <small>
            <i className={`connectionDot ${props.connection}`} />
            {game.settings.mode === "rpg" ? myClass ?? "RPG" : "Классика"}
            <b>•</b>
            козырь {game.trumpSuits[0] ? suitSymbol[game.trumpSuits[0]] : "?"}
          </small>
        </div>
        <div className="matchHudStats">
          <span><small>КОЛОДА</small><b>{game.deckCount}</b></span>
          <span><small>СТОЛ</small><b>{game.table.length}/{game.roundAttackLimit || "—"}</b></span>
        </div>
      </header>

      {game.qaMatch && (
        <button className="qaLiveExit" onClick={props.onLeaveRoom}>
          QA ×
        </button>
      )}

      {props.connection !== "online" && (
        <div className="reconnectNotice">
          Соединение потеряно. Возвращаем тебя за стол…
        </div>
      )}

      {myClassDescription && (
        <div className="classAbilityChip" title={myClassDescription}>
          <i aria-hidden="true">
            {game.self.classId ? rpgClassSigil[game.self.classId] : "✦"}
          </i>
          <span>{myClass}</span>
          {game.self.classId === "wild-transfer" && (
            <b>×{game.self.ability.wildTransfersLeft}</b>
          )}
        </div>
      )}

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
                player.finished ? "finished" : "",
                motion.opponents[player.seat] ? `motion-${motion.opponents[player.seat]}` : ""
              ].join(" ")}
              style={{ "--seat-index": player.seat } as CSSProperties}
            >
              <div className="opponentCards" aria-hidden="true">
                <i><CardBack mode={game.settings.mode} compact /></i>
                <i><CardBack mode={game.settings.mode} compact /></i>
                <i><CardBack mode={game.settings.mode} compact /></i>
              </div>
              <div className="avatar">
                {player.photoUrl ? <img src={player.photoUrl} alt="" /> : player.seat + 1}
              </div>
              <strong>{player.name}</strong>
              <span>{player.handCount} карт</span>
              {player.classId && (
                <small className="opponentClass">
                  <i aria-hidden="true">{rpgClassSigil[player.classId]}</i>
                  {RPG_CLASS_NAMES[player.classId]}
                </small>
              )}
            </div>
          ))}
      </section>

      <section
        className={[
          "tableArea",
          game.defenderTaking ? "defenderTaking" : "",
          dragCard ? "dragActive" : "",
          dragCard?.target === "attack" ? "dropAttackActive" : ""
        ].join(" ")}
        data-drop-target={
          isMyTurn && (game.phase === "attacking" || game.phase === "throwing")
            ? "attack"
            : undefined
        }
      >
        <div className={`tablePhaseBadge ${isMyTurn ? "mine" : ""}`}>
          <small>{phaseLabel}</small>
          <b>
            {game.phase === "finished"
              ? resultText
              : isMyTurn
                ? "ТВОЙ ХОД"
                : turnPlayer?.name ?? `Игрок #${(game.turnSeat ?? 0) + 1}`}
          </b>
        </div>

        {transferDropVisible && (
          <div className="transferDropArea">
            <div
              className={`transferDropTarget ${dragCard?.target === "transfer" ? "active" : ""}`}
              data-drop-target="transfer"
            >
              <span>⇢</span>
              <b>ПЕРЕВЕСТИ</b>
              <small>Положи карту сюда</small>
            </div>
            {game.self.classId === "reverse-transfer" && (
              <div
                className={`transferDropTarget reverse ${dragCard?.target === "transfer-reverse" ? "active" : ""}`}
                data-drop-target="transfer-reverse"
              >
                <span>↶</span>
                <b>РЕВЕРС</b>
              </div>
            )}
          </div>
        )}

        <div className={`deckPile ${motion.deckPulse ? "pulseDraw" : ""}`} aria-label={`Колода: ${game.deckCount}`}>
          <span className="pileCard backOne"><CardBack mode={game.settings.mode} compact /></span>
          <span className="pileCard backTwo"><CardBack mode={game.settings.mode} compact /></span>
          {game.trumpCard && game.deckCount > 0 && (
            <span className={[
              "trumpPeek",
              isRed(game.trumpCard) ? "red" : "",
              motion.trumpReveal ? "revealTrump" : ""
            ].join(" ")}>
              {game.trumpCard.kind === "standard"
                ? `${game.trumpCard.rank}${suitSymbol[game.trumpCard.suit]}`
                : "★"}
            </span>
          )}
          <em>{game.deckCount}</em>
        </div>

        <div className={`discardPile ${motion.discardPulse ? "pulseDiscard" : ""}`} aria-label={`Бито: ${game.discardCount}`}>
          <span className="pileCard discardOne" />
          <span className="pileCard discardTwo" />
          <em>{game.discardCount}</em>
        </div>

        {motion.takeDeclared && (
          <div className="takeAnnounce" aria-hidden="true">ЗАБИРАЕТ</div>
        )}

        {motion.cleared && (
          <div
            key={motion.cleared.token}
            className={[
              "clearMotion",
              motion.cleared.kind === "discard" ? "toDiscard" : "",
              motion.cleared.kind === "take" && motion.cleared.toSelf ? "toSelf" : "",
              motion.cleared.kind === "take" && !motion.cleared.toSelf ? "toOpponent" : ""
            ].join(" ")}
            aria-hidden="true"
          >
            {motion.cleared.cards.map((card, index) => (
              <div
                className="motionGhost"
                key={card.id}
                style={{
                  "--ghost-index": index
                } as CSSProperties}
              >
                <CardFace card={card} mode={game.settings.mode} />
              </div>
            ))}
          </div>
        )}

        {motion.cleared?.discardedCards.length ? (
          <div
            key={`discard-special-${motion.cleared.token}`}
            className="clearMotion toDiscard specialDiscard"
            aria-hidden="true"
          >
            {motion.cleared.discardedCards.map((card, index) => (
              <div
                className="motionGhost"
                key={card.id}
                style={{ "--ghost-index": index } as CSSProperties}
              >
                <CardFace card={card} mode={game.settings.mode} />
              </div>
            ))}
          </div>
        ) : null}

        {motion.transfer && (
          <div
            key={motion.transfer.token}
            className={`transferMotion ${motion.transfer.reverse ? "reverse" : ""}`}
            aria-hidden="true"
          >
            <span>{motion.transfer.reverse ? "↶" : motion.transfer.direction === 1 ? "⇢" : "⇠"}</span>
          </div>
        )}

        {game.phase === "finished" ? (
          <section className={[
            "matchResult",
            game.draw ? "draw" : game.loserSeat === game.self.seat ? "loss" : "win"
          ].join(" ")}>
            <span className="resultSeal" aria-hidden="true">
              {game.draw ? "◆" : game.loserSeat === game.self.seat ? "Д" : "♛"}
            </span>
            <small>{game.settings.mode === "rpg" ? "DURAK RPG" : "КЛАССИКА"}</small>
            <h2>
              {game.draw
                ? "Ничья"
                : game.loserSeat === game.self.seat
                  ? "Ты — дурак"
                  : "Партия выиграна"}
            </h2>
            <p>
              {game.draw
                ? "За столом не осталось проигравшего."
                : game.self.place
                  ? `Твоё место: #${game.self.place}`
                  : resultText}
            </p>
            {props.matchProgress && (
              <div className={[
                "resultRating",
                props.matchProgress.ratingDelta > 0
                  ? "positive"
                  : props.matchProgress.ratingDelta < 0
                    ? "negative"
                    : ""
              ].join(" ")}>
                <small>{props.matchProgress.ranked ? "РЕЙТИНГ" : "ОБЫЧНЫЙ МАТЧ"}</small>
                <strong>
                  {props.matchProgress.ranked
                    ? `${props.matchProgress.ratingDelta > 0 ? "+" : ""}${props.matchProgress.ratingDelta} RP`
                    : "без изменений"}
                </strong>
                {props.matchProgress.ranked && (
                  <span>
                    {Math.round(props.matchProgress.ratingBefore)} → {Math.round(props.matchProgress.ratingAfter)}
                  </span>
                )}
              </div>
            )}
            {game.privateMatch && game.rematchAvailable && (
              <div className="rematchStatus">
                <span>
                  {rematchReadyCount > 0
                    ? `Готовы: ${rematchReadyCount}/${game.players.length}`
                    : "Сыграть тем же составом?"}
                </span>
                <div className="resultActions">
                  <button
                    className="resultButton rematchButton"
                    disabled={rematchReady || props.connection !== "online"}
                    onClick={props.onRematch}
                  >
                    {rematchReady ? "ЖДЁМ ОСТАЛЬНЫХ" : "РЕМАТЧ"}
                  </button>
                  <button className="resultButton menuResultButton" onClick={props.onLeaveRoom}>
                    В МЕНЮ
                  </button>
                </div>
              </div>
            )}
            {(!game.privateMatch || !game.rematchAvailable) && (
              <button className="resultButton" onClick={props.onLeaveRoom}>
                В МЕНЮ
              </button>
            )}
          </section>
        ) : game.phase === "awaiting-trump" && isMyTurn ? (
          <section className="trumpChoice tableTrumpChoice">
            <span className="modeEyebrow">КОЗЫРНИК</span>
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
        ) : game.table.length === 0 ? (
          <div className="emptyTable">
            {isMyTurn ? "Твой ход" : "Ожидаем ход соперника"}
          </div>
        ) : (
          <div className="tablePairs">
            {game.table.map((pair) => (
              <button
                key={pair.attack.id}
                aria-label={pair.defense
                  ? `${cardAriaLabel(pair.attack)}, покрыта картой ${cardAriaLabel(pair.defense)}`
                  : `Атакующая карта ${cardAriaLabel(pair.attack)}`}
                className={[
                  "tablePair",
                  !pair.defense && openAttack?.attack.id === pair.attack.id ? "selected" : "",
                  !pair.defense && dragCard?.target === `defend:${pair.attack.id}` ? "dropDefenseActive" : ""
                ].join(" ")}
                data-drop-target={
                  !pair.defense && game.phase === "defending" && isMyTurn
                    ? `defend:${pair.attack.id}`
                    : undefined
                }
                onClick={() => {
                  if (!pair.defense && game.phase === "defending" && isMyTurn) {
                    props.setSelectedAttackId(pair.attack.id);
                  }
                }}
              >
                <div
                  className={[
                    "attackCardSlot",
                    motion.attack[pair.attack.id]
                      ? `enter-${motion.attack[pair.attack.id]}`
                      : ""
                  ].join(" ")}
                >
                  <CardFace card={pair.attack} mode={game.settings.mode} />
                </div>
                {pair.defense && (
                  <div
                    className={[
                      "defenseCard",
                      motion.defense[pair.defense.id]
                        ? `enter-${motion.defense[pair.defense.id]}`
                        : ""
                    ].join(" ")}
                  >
                    <CardFace card={pair.defense} mode={game.settings.mode} />
                  </div>
                )}
              </button>
            ))}
          </div>
        )}
      </section>

      {props.error && <div className="errorBanner gameError">{props.error}</div>}

      <section className={`turnInfo ${isMyTurn ? "activeHint" : ""}`}>
        {turnHint}
      </section>

      {isMyTurn && (game.phase === "defending" || game.phase === "throwing") && (
        <section className="contextActionDock">
          <button
            className={`contextAction ${game.phase === "defending" ? "take" : "pass"}`}
            disabled={controlsDisabled}
            onClick={() =>
              props.onAction({
                type: game.phase === "defending" ? "take" : "pass_throw_in"
              })
            }
          >
            {game.phase === "defending" ? "Беру" : "Пас"}
          </button>
        </section>
      )}

      <section className={`myHand ${motion.selfFinished ? "motion-finish" : ""}`}>
        {game.self.finished && game.self.place && (
          <div className={`selfFinishBadge ${motion.selfFinished ? "animate" : ""}`}>
            ВЫШЕЛ #{game.self.place}
          </div>
        )}
        <div className="handHeader selfHandHeader">
          <div className="selfHandIdentity">
            <span className="selfHandAvatar">
              {game.self.photoUrl ? <img src={game.self.photoUrl} alt="" /> : game.self.name.slice(0, 1)}
            </span>
            <span>
              <small>ТВОЯ РУКА</small>
              <strong>{game.self.name}</strong>
            </span>
          </div>
          <b>{game.self.hand.length}</b>
          {game.self.classId === "wild-transfer" && (
            <small>↝ {game.self.ability.wildTransfersLeft}</small>
          )}
        </div>
        <div
          className={[
            "handCards",
            sortedHand.length >= 10 ? "dense" : sortedHand.length >= 7 ? "compact" : "spread"
          ].join(" ")}
        >
          {sortedHand.map((card, index) => {
            const previous = sortedHand[index - 1];
            const startsSuit =
              card.kind === "standard" &&
              (!previous ||
                previous.kind === "joker" ||
                previous.suit !== card.suit);

            return (
              <button
                key={card.id}
                aria-label={`${cardAriaLabel(card)}. Перетащи карту на стол`}
                aria-pressed={card.id === props.selectedHandId}
                className={[
                  "handCard",
                  card.id === props.selectedHandId ? "selected" : "",
                  dragCard?.cardId === card.id ? "dragging" : "",
                  startsSuit ? "suitStart" : "",
                  isRed(card) ? "red" : "",
                  motion.hand[card.id] ? `motion-${motion.hand[card.id]}` : ""
                ].join(" ")}
                style={{
                  "--motion-index": Math.max(0, handMotionOrder.indexOf(card.id)),
                  "--hand-index": index
                } as CSSProperties}
                onPointerDown={(event) => beginCardDrag(card, event)}
                onPointerMove={moveCardDrag}
                onPointerUp={finishCardDrag}
                onPointerCancel={cancelCardDrag}
                disabled={
                  game.phase === "finished" ||
                  game.phase === "awaiting-trump" ||
                  !cardPlayable(card)
                }
              >
                <CardFace card={card} mode={game.settings.mode} />
              </button>
            );
          })}
        </div>

        {draggedCard && dragCard && (
          <div
            className="dragCardGhost"
            style={{
              left: dragCard.x,
              top: dragCard.y
            }}
            aria-hidden="true"
          >
            <CardFace card={draggedCard} mode={game.settings.mode} />
          </div>
        )}
      </section>
    </main>
  );
}

function isRed(card: Card): boolean {
  return card.kind === "standard" && (card.suit === "hearts" || card.suit === "diamonds");
}

const pipCountByRank: Partial<Record<"6" | "7" | "8" | "9" | "10" | "J" | "Q" | "K" | "A", number>> = {
  "6": 6,
  "7": 7,
  "8": 8,
  "9": 9,
  "10": 10
};

function CardFace({ card, mode = "classic" }: { card: Card; mode?: GameMode }) {
  if (card.kind === "joker") {
    return (
      <span className={`cardFace jokerFace cardStyle-${mode}`}>
        <span className="cardCorner top">
          <b>★</b>
          <i>J</i>
        </span>
        <span className="jokerMedallion" aria-hidden="true">
          <i>♠</i><i>↝</i><strong>★</strong><i>↶</i><i>✦</i>
        </span>
        <small>JOKER</small>
        <span className="cardCorner bottom">
          <b>★</b>
          <i>J</i>
        </span>
      </span>
    );
  }

  const symbol = suitSymbol[card.suit];
  const pipCount = pipCountByRank[card.rank];
  const faceLetter = card.rank === "J" ? "В" : card.rank === "Q" ? "Д" : card.rank === "K" ? "К" : null;

  return (
    <span className={`cardFace cardStyle-${mode} suit-${card.suit} ${isRed(card) ? "red" : ""}`}>
      <span className="cardCorner top">
        <b>{card.rank}</b>
        <i>{symbol}</i>
      </span>

      {pipCount ? (
        <span className={`pipField pips-${pipCount}`} aria-hidden="true">
          {Array.from({ length: pipCount }, (_, index) => (
            <i key={index}>{symbol}</i>
          ))}
        </span>
      ) : faceLetter ? (
        <span className="courtFace" aria-hidden="true">
          <span className="courtCrown">{card.rank === "K" ? "♜" : card.rank === "Q" ? "✦" : "◆"}</span>
          <strong>{faceLetter}</strong>
          <i>{symbol}</i>
          <small>{card.rank === "K" ? "КОРОЛЬ" : card.rank === "Q" ? "ДАМА" : "ВАЛЕТ"}</small>
        </span>
      ) : (
        <span className="aceFace" aria-hidden="true">
          <i>{symbol}</i>
          <small>ДУРАК</small>
        </span>
      )}

      <span className="cardCorner bottom">
        <b>{card.rank}</b>
        <i>{symbol}</i>
      </span>
    </span>
  );
}

function CardBack({ mode = "classic", compact = false }: { mode?: GameMode; compact?: boolean }) {
  return (
    <span className={`cardBack cardBack-${mode} ${compact ? "compact" : ""}`} aria-hidden="true">
      <span className="backFrame">
        {mode === "classic" ? (
          <span className="classicBackMark">
            <i>♠</i><i>♣</i><strong>Д</strong><i>♥</i><i>♦</i>
          </span>
        ) : (
          <span className="rpgBackSeal">
            <i>♠</i><i>↝</i><i>Ⅴ</i>
            <strong>Д</strong>
            <i>✦</i><i>↶</i><i>★</i>
          </span>
        )}
      </span>
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
