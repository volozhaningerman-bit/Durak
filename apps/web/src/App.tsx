import { useMemo, useState } from "react";
import {
  DEFAULT_CLASSIC_SETTINGS,
  DEFAULT_RPG_SETTINGS,
  type GameMode,
  type GameSettings,
  type ThemeId
} from "@durak/game-core";

const themes: { id: ThemeId; label: string }[] = [
  { id: "classic", label: "Классика" },
  { id: "casino", label: "Казино" },
  { id: "dark", label: "Тёмная" },
  { id: "rus-fantasy", label: "Русь" }
];

export function App() {
  const [mode, setMode] = useState<GameMode>("classic");
  const [theme, setTheme] = useState<ThemeId>("dark");
  const [classic, setClassic] = useState<GameSettings>({ ...DEFAULT_CLASSIC_SETTINGS });
  const [rpg, setRpg] = useState<GameSettings>({ ...DEFAULT_RPG_SETTINGS });
  const settings = mode === "classic" ? classic : rpg;

  const subtitle = useMemo(
    () => mode === "classic" ? "Настрой правила и найди соперников" : "Случайный класс. Никаких одинаковых ролей.",
    [mode]
  );

  function updateSettings(patch: Partial<GameSettings>) {
    if (mode === "classic") setClassic((s) => ({ ...s, ...patch }));
    else setRpg((s) => ({ ...s, ...patch, mode: "rpg", variant: "transfer" }));
  }

  return (
    <main className="app" data-theme={theme}>
      <header className="topbar">
        <div>
          <strong className="brand">DURAK <span>RPG</span></strong>
          <div className="subtitle">{subtitle}</div>
        </div>
        <select
          className="themeSelect"
          value={theme}
          onChange={(e) => setTheme(e.target.value as ThemeId)}
          aria-label="Стиль"
        >
          {themes.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
        </select>
      </header>

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
        <p>{mode === "classic" ? "Подкидной или переводной — правила выбираешь ты." : "Шесть классов меняют привычную партию."}</p>
      </section>

      <section className="settings">
        <SettingRow label="Игроков" value={String(settings.playerCount)}>
          <input
            type="range"
            min="2"
            max="6"
            step="1"
            value={settings.playerCount}
            onChange={(e) => updateSettings({ playerCount: Number(e.target.value) as GameSettings["playerCount"] })}
          />
        </SettingRow>

        {mode === "classic" && (
          <SettingRow label="Режим" value={settings.variant === "throw-in" ? "Подкидной" : "Переводной"}>
            <div className="segmented">
              <button className={settings.variant === "throw-in" ? "active" : ""} onClick={() => updateSettings({ variant: "throw-in" })}>Подкидной</button>
              <button className={settings.variant === "transfer" ? "active" : ""} onClick={() => updateSettings({ variant: "transfer" })}>Переводной</button>
            </div>
          </SettingRow>
        )}

        <SettingRow label="Подкидывают" value={settings.throwInPolicy === "all" ? "Все" : "Крайние"}>
          <div className="segmented">
            <button className={settings.throwInPolicy === "all" ? "active" : ""} onClick={() => updateSettings({ throwInPolicy: "all" })}>Все</button>
            <button className={settings.throwInPolicy === "neighbors" ? "active" : ""} onClick={() => updateSettings({ throwInPolicy: "neighbors" })}>Крайние</button>
          </div>
        </SettingRow>

        <button className="findGame">НАЙТИ ИГРУ</button>
      </section>

      <nav className="bottomNav">
        <button className="active">Играть</button>
        <button>Профиль</button>
        <button>Рейтинг</button>
        <button>Магазин</button>
      </nav>
    </main>
  );
}

function SettingRow(props: { label: string; value: string; children: React.ReactNode }) {
  return (
    <div className="settingRow">
      <div className="settingTitle"><span>{props.label}</span><b>{props.value}</b></div>
      {props.children}
    </div>
  );
}
