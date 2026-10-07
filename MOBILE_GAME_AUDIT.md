# Durak RPG — Mobile Game Audit

Updated: 2026-10-07

## Audit scale
- ✅ implemented / verified in code
- 🟡 implemented but needs real-device playtest
- ⬜ next product pass

## 1. First-run / time to first interaction
- ✅ Static CDN frontend opens without exposing Render cold-start UI.
- ✅ Branded boot screen appears while backend wakes.
- ✅ Telegram WebApp `ready()` / `expand()` runs before backend authentication completes.
- ✅ Primary game CTA is disabled only while backend is unavailable.
- 🟡 Measure actual first-open latency on iPhone after CDN/browser cache is cold.

## 2. One-handed mobile ergonomics
- ✅ Fixed bottom navigation.
- ✅ Match fits one viewport; no scrolling required during play.
- ✅ Main action rail stays close to the player's hand.
- ✅ Core tap targets are at least 44 px.
- ✅ Range control has a phone-sized thumb.
- ✅ `touch-action: manipulation` and tap-highlight cleanup.
- 🟡 Verify iPhone mini/fullscreen safe areas on several screen heights.

## 3. Core game readability
- ✅ Active phase is shown on the table: attack / defense / throw-in / trump.
- ✅ Active player is named.
- ✅ Attacker/defender/opponent states are visually distinct.
- ✅ Deck, trump, direction and table limit are visible.
- ✅ Contextual hints explain the next legal interaction.
- ✅ Unplayable cards are visually de-emphasized.
- 🟡 Validate five-opponent readability during a real 6-player match.

## 4. Card game feel
- ✅ State-driven deal animation.
- ✅ Hand → table play animation.
- ✅ Defense animation.
- ✅ Throw-in animation.
- ✅ Transfer / reverse feedback.
- ✅ Take animation.
- ✅ Discard animation.
- ✅ Refill animation.
- ✅ Player finish feedback.
- ✅ Restrained Telegram haptics.
- ✅ Controls lock during significant motion.
- ✅ Reduced-motion setting is respected.
- 🟡 Tune animation duration/weight after a real two-device match.

## 5. Playing-card identity
- ✅ Custom Classic face design.
- ✅ Custom RPG face design.
- ✅ Numeric pip layouts for 6–10.
- ✅ Dedicated Jack / Queen / King treatment.
- ✅ Dedicated Ace treatment.
- ✅ Dedicated Joker design.
- ✅ Classic green card back.
- ✅ RPG class-seal card back.
- ✅ Card backs appear in deck, opponent hand, search, lobby and shop.
- ✅ Card visuals are CSS/DOM rather than heavy raster assets.
- ⬜ Future cosmetic card-back inventory and Stars purchase flow.

## 6. End-of-match payoff
- ✅ Dedicated win / loss / draw result panel.
- ✅ Place shown when available.
- ✅ Clear return-to-menu CTA.
- ⬜ Show exact rating delta from authoritative server result.
- ✅ Private rematch CTA with unanimous ready-check and authoritative fresh-game restart.
- ⬜ XP / level progress animation.

## 7. Network / mobile background behavior
- ✅ Authoritative server state.
- ✅ Reconnect grace for active room/match.
- ✅ Reconnect UI.
- ✅ Suppress replay of stale animations after reconnect.
- ✅ Foreground/online recovery.
- ✅ Reconnect backoff instead of fixed reconnect spam.
- ✅ Ping on returning to foreground.
- 🟡 Test 30–120 s Telegram background suspension on iOS.
- ⬜ Decide whether public matchmaking queue should auto-restore after disconnect.

## 8. Performance
- ✅ No large image assets required for playing cards.
- ✅ Motion uses transform/opacity for core card movement.
- ✅ `will-change` limited to animated game elements.
- ✅ Match table uses containment.
- ✅ Static frontend split from backend Docker image.
- ✅ Backend Docker no longer builds Vite/Rollup.
- 🟡 Measure FPS on older iPhone during 12-card table clear.
- ⬜ Add production bundle budget check if frontend starts growing materially.

## 9. Accessibility
- ✅ Reduced-motion support.
- ✅ Focus-visible treatment.
- ✅ Playing cards have Russian screen-reader labels.
- ✅ Selected hand card exposes `aria-pressed`.
- ✅ Buttons have semantic labels where symbols are used.
- ⬜ Full VoiceOver playtest.

## 10. Social / Telegram-native flow
- ✅ Private room codes.
- ✅ Telegram room sharing.
- ✅ Recent-player memory.
- ✅ Direct repeat invitation through bot.
- ✅ Invite cooldown.
- ✅ Post-match private rematch flow; all players opt in before the next game starts.
- ⬜ Optional favorite players.

## 11. Progression / retention
- ✅ Rating and ordered winner reward split.
- ✅ Profile stats.
- ✅ Match history foundation.
- ✅ Win streak.
- ⬜ First-win-of-day reward.
- ⬜ Lightweight quests / achievements.
- ⬜ Cosmetic unlock milestones.
- ⬜ Avoid adding retention systems until core match feel is proven.

## 12. Monetization integrity
- ✅ Gameplay consumables disabled in ranked.
- ✅ Cosmetics/social reactions remain compatible with ranked.
- ✅ Shop has a dedicated deck cosmetic shelf.
- ⬜ Telegram Stars checkout.
- ⬜ Cosmetic inventory.
- ⬜ Keep paid classes/stat boosts out of ranked play.

## Current priority after this audit
1. Real two-device playtest of the complete match.
2. Tune card size, motion duration and table spacing from actual iPhone footage.
3. Verify private rematch across two real Telegram clients, including one player declining/leaving.
4. Only then expand cosmetics / Stars.
