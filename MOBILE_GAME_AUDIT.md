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


## Screenshot + architecture audit — 2026-10-07, second pass

Reviewed the full Oct 7 mobile screenshot sequence against the current `main` branch.

### Fixed in this pass
- ✅ Matchmaking search no longer inherits the late 90–150 px top-padding regression; its ceremony is centered and compact again.
- ✅ Lobby uses Telegram's stable viewport CSS variable with browser fallback; fixed navigation also respects Telegram content-safe bottom inset.
- ✅ Short phones can scroll the lobby rather than clipping the primary CTA. The active match remains a one-screen, non-scrolling surface.
- ✅ Light/dark choice persists locally and updates Telegram header/background/bottom-bar colors when supported.
- ✅ Telegram WebApp bridge updated to the current official script revision used by Telegram documentation.
- ✅ Private lobby seats survive transient mobile/WebSocket disconnects for the reconnect grace period.
- ✅ A disconnected private-lobby member is shown as reconnecting; the reserved seat cannot accidentally start a match with a dead socket.
- ✅ Deep-link reconnect does not issue a duplicate `join_private_room` after restoring the reserved seat.
- ✅ Public matchmaking is FIFO by queue-entry time rather than WebSocket connection age.
- ✅ Static Mini App URL and authoritative backend URL are now distinct. Telegram webhook targets the backend, while menu/deep links target the static Mini App.
- ✅ Telegram API configuration has a request timeout and no longer blocks the backend from beginning to listen after the database is ready.

### Verified / no change required
- ✅ Telegram initData is HMAC-validated server-side with freshness checks.
- ✅ Production WebSocket origin is restricted to the configured Mini App origin.
- ✅ WebSocket payload and per-session message rate are bounded.
- ✅ SQL queries use parameters; match progression is transactional and idempotent by match id.
- ✅ Ranked play disables gameplay-item advantages.
- ✅ Core game actions are server-authoritative and the six RPG classes have direct rules/tests.
- ✅ Transfer capacity uses the target defender's actual hand count, capped by the class/round limit.

### Still requires real-device evidence
- 🟡 In-match table/card spacing for 2, 4 and 6 players: no in-match screenshot was included in the recovered screenshot set.
- 🟡 30–120 second iOS background suspension during an active match.
- 🟡 Private-lobby reconnect while the host opens Telegram sharing and returns.
- 🟡 Rematch acceptance/decline across two real Telegram accounts.
- 🟡 VoiceOver pass and animation/FPS tuning on an older iPhone.

### Rule variant to decide explicitly
- 🟡 In a chain of transfers, current engine state treats the most recent transferring player as the current attacker for round ordering/refill. Durak rule sets differ on how refill priority is described after transfers. Keep the current behavior until the product rule is explicitly chosen and documented; do not silently change a live rule during UI polishing.

### Code-health debt
- 🟡 `apps/web/src/styles.css` still contains many historical screenshot-correction layers. The cascade is stable after this pass, but it should be consolidated after the next real-device visual approval rather than during active visual iteration.
- 🟡 `apps/server/src/index.ts` remains monolithic. Split matchmaking/private-lobby/Telegram integration after the real two-device flow is proven, to avoid refactoring unvalidated behavior.


## Full production audit — 2026-10-09

Reviewed the current mobile UI, the live Render workspace, the authoritative engine, WebSocket smoke path and production deploy configuration.

### Fixed in this audit
- ✅ Live Render frontend/backend mismatch removed. The static app and backend now both use `durak-rpg-test.onrender.com` for the authoritative API/WebSocket endpoint.
- ✅ The backend was upgraded from the Oct 7 deploy to current `main`; database initialization and Telegram bot setup complete successfully in fresh production logs.
- ✅ Render blueprint now matches the actual live Node service instead of describing a Docker runtime.
- ✅ Node is pinned to the 22 LTS line instead of an open-ended `>=22` range.
- ✅ Duplicate Telegram top-safe-area reservation removed from the lobby shell; the header is now the only owner of the top content inset.
- ✅ Bottom navigation legacy translation bug fixed; all four tabs remain on-screen.
- ✅ Play/profile/rating/shop/private-room screens have explicit iPhone scroll containers while the Telegram root remains locked.
- ✅ The covered/taken table stays visible through the attack limit and is settled only after explicit `Pass`.
- ✅ Defense drag now enables only cards that can legally defend or transfer.
- ✅ Transfer drop zones account for direction, reverse transfer, target hand capacity and the five-card defender class limit before being shown.
- ✅ Result and trump-selection states were brought into the same rounded green/gold visual system as the match table.
- ✅ Empty action-row space is collapsed in attack/result/trump phases so the table gains vertical room.
- ✅ Server QA-bot matches are production-gated and restricted to an explicit Telegram username allow-list.
- ✅ Live QA smoke was made deterministic after it correctly exposed an invalid test-client transfer attempt.

### Production evidence
- ✅ Fresh backend log contains `Database ready`.
- ✅ Fresh backend log contains `Durak RPG server listening on :10000`.
- ✅ Fresh backend log contains `Telegram bot configured @DurakRPG_bot`.
- ✅ Production dependency audit used by CI (`npm audit --omit=dev --audit-level=high`) passes. Render's remaining audit warnings are in the development toolchain rather than runtime dependencies.

### Remaining real-device checks
- 🟡 Final match layout with 2, 4 and 6 players after the new full-screen table redesign.
- 🟡 Drag/drop feel on a physical iPhone: finger offset, drop-target size and accidental-scroll resistance.
- 🟡 Long hands (10–15 cards) after suit/rank sorting and density compression.
- 🟡 Light-theme contrast in an actual match, especially gold controls over the green table.
- 🟡 30–120 second background/foreground restore on iOS.
- 🟡 Private lobby reconnect/rematch with two real Telegram accounts.

### Code-health follow-up
- 🟡 `apps/web/src/styles.css` has grown to more than 8k lines and contains many historical override layers. This has already caused real regressions (bottom-nav transform, duplicate safe-area padding). Once the new layout is visually approved on-device, consolidate the authoritative lobby/match styles into a clean stylesheet instead of adding more override layers.
- 🟡 `apps/web/src/App.tsx` and `apps/server/src/index.ts` are still too large for comfortable maintenance. Split them only after the current gameplay/UI behavior is visually signed off so the refactor does not obscure product regressions.
