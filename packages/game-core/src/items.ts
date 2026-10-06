export type GameplayItemId = "undo-card" | "peek-discard";
export type SocialItemId = "tomato" | "laugh" | "taunt";

export interface InventoryItem {
  id: GameplayItemId | SocialItemId;
  quantity: number;
}

export const GAMEPLAY_ITEMS: Record<GameplayItemId, { title: string; rankedAllowed: boolean }> = {
  "undo-card": {
    title: "Возврат карты",
    rankedAllowed: false
  },
  "peek-discard": {
    title: "Вспомнить вышедшие карты на 5 секунд",
    rankedAllowed: false
  }
};

export const SOCIAL_ITEMS: Record<SocialItemId, { title: string }> = {
  tomato: { title: "Помидор" },
  laugh: { title: "Смех" },
  taunt: { title: "Насмешка" }
};
