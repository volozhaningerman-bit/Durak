# Durak RPG — visual system

## Brand idea

Durak RPG is a physical card-table game first, not a generic dashboard.

The visual language combines:
- card-room felt and ivory paper;
- ink, brass and restrained red accents;
- cut/chamfered panel corners instead of endless rounded SaaS cards;
- real playing-card geometry;
- minimal glow and no decorative neon;
- clear hierarchy that reads instantly on a phone.

The interface should feel authored, tactile and game-like.

## Core palette

### Dark
- background: `#0B1210`
- panel: `#121B17`
- strong panel: `#19231E`
- border: `#344039`
- text: `#F0EADF`
- muted: `#8D968F`
- classic green: `#4F9265`
- classic light: `#79AD88`
- RPG brass: `#BD8A3A`
- RPG light brass: `#D4AD64`
- danger: `#C85F55`
- card paper: `#EFE7D5`
- card ink: `#191D1A`

### Light
- background: `#E8E4D8`
- panel: `#F3EEE3`
- strong panel: `#FBF7EE`
- border: `#C8C4B8`
- text: `#1D231F`
- muted: `#73776F`
- classic green: `#397A50`
- classic light: `#5F9B70`
- RPG brass: `#AD7926`
- RPG light brass: `#C99845`
- danger: `#B94D45`
- card paper: `#FFFAF0`
- card ink: `#1B201D`

## Classic mode

Mood:
- card club;
- green felt;
- clean traditional rules;
- practical, fast, familiar.

Use:
- green as the only primary accent;
- spade/club symbols;
- subtle table grid/felt texture;
- simpler panels and fewer ornaments.

Avoid:
- gold fantasy decoration;
- mystical glows;
- RPG sigils.

## RPG mode

Mood:
- card tavern;
- character roles;
- brass seals;
- unusual rules without high-fantasy clutter.

Use:
- brass/gold as primary accent;
- small class seals and medallions;
- dark umber / paper textures;
- slightly richer framing than Classic.

Avoid:
- neon purple/blue;
- sci-fi HUD;
- excessive particles;
- medieval cliché ornaments.

## Shape language

Major surfaces:
- 8–12 px chamfered/cut corners;
- thin 1 px borders;
- almost no large soft shadows.

Small controls:
- 2–5 px radius;
- physical printed-control feel;
- active state is shown by color or bottom rule, not huge glow.

Cards:
- 7 px radius;
- ivory paper;
- Georgia/serif only inside playing cards and seals.

Avatars:
- circles are allowed because they represent people.

## Typography

Interface:
- system UI / Inter-like sans-serif;
- bold, condensed hierarchy;
- small uppercase labels with tracking for section names.

Cards / seals:
- Georgia or another serif already available on device.

Do not introduce decorative display fonts until a licensed font is intentionally selected.

## Navigation

Bottom navigation is a HUD rail:
- fixed;
- almost square;
- active tab gets a thin accent underline;
- no floating glass pill.

Tabs change pages; they never open modal overlays over Play.

## Loading

Frontend must always load from the static CDN.

If backend is sleeping:
- show Durak RPG branded boot screen;
- never expose Render infrastructure;
- reconnect automatically;
- do not block Telegram WebApp `ready()` on backend availability.

## Match table

Priority:
1. player cards;
2. table cards;
3. opponent state;
4. action controls;
5. secondary metadata.

Never make the user scroll during a match.

Animations:
- state-driven, server-confirmed;
- cards visibly move hand → table → discard/hand;
- no fake optimistic card plays;
- controls lock during significant motion;
- reduced-motion preference is respected.

## Anti-patterns

Do not use:
- generic glassmorphism;
- random glow behind every block;
- pill-shaped everything;
- giant empty cards with one number;
- stock emoji as the main product icon language;
- gradients with no semantic reason;
- decorative UI that competes with cards.
