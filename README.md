# Mosquito Slayer

A tiny bedtime arcade game: a sleepy stickman, one very rude mosquito and a whole lot of aim.

No build step or dependencies. Open `index.html` in a browser.

## How to play

- Hold and drag anywhere on the stage to aim; release to zap.
- Both hands move vertically along the fixed rod, and each shot emits small white sparks.
- The mosquito gets faster and dives for the sleeper's face. Its buzz follows its distance and fades smoothly as it comes and goes.
- Keep landing hits less than 4.2 seconds apart. The third and later hits in a streak earn two points; a miss breaks the combo.
- Every 5 kills is a new level, with a banner and a burst of confetti. Kills trigger a quick slow-mo.
- The game-over card shows your rank, kills, accuracy and best combo.
- **P / Esc** pauses, **M** mutes, **R** restarts, and **Space** starts or replays.

Sound starts after the first tap because mobile browsers block autoplay until then.

## Included face and sound assets

- `assets/faces/main.png` is the regular face shown during play.
- `assets/faces/bite.png` replaces it as soon as the mosquito bites. `assets/faces/alternate.png` contains IMG2 as an optional spare; IMG1 remains the only normal face. The cutouts are drawn whole and tilted left to match the reclined reference pose.
- `assets/sounds/mosquito-loop.mp3` is a crossfaded MP3 loop prepared from the supplied mosquito sound for broad browser support. Its volume fades with distance and its playback pitch rises as it approaches.
- `assets/sounds/fire.mp3` plays on every shot at 1.12× speed.
- `assets/sounds/game-over.mp3` plays at the bite/loss event, before the game-over screen.

The menu sound and audio-file fallbacks are synthesized by the game. Audio files preload at page start; the loss clip is primed on the Start tap, while the shot clip plays directly from the firing gesture.

## Deploy on GitHub Pages

1. Put **the contents of this folder at the root of a repo** (so `index.html` sits next to `game.js`; not inside a subfolder).
2. Repo **Settings → Pages → Build and deployment → Deploy from a branch → `main` / `(root)`** and save.
3. After a minute the game is live at `https://<user>.github.io/<repo>/`.

Everything uses relative paths, there is no build step, and the sounds are inlined, so it also works from `file://`. The service worker and "Install app" button need https, which GitHub Pages provides. When you change any asset, bump `V` in `sw.js` so phones pick up the new files. `.nojekyll` is included so Pages serves the files untouched.

## Install as an app + offline play

The game is a PWA. Once it is hosted on https (GitHub Pages is), it can be installed and played with no internet:

- **Android / Chrome / Edge (desktop too):** open the game and tap **Install app** on the menu (or the browser's install icon).
- **iPhone / iPad:** open it in **Safari**, tap Share, then **Add to Home Screen**.
- The first visit downloads everything (about 3 MB). A "Ready to play offline" message confirms it. After that it launches instantly with no connection, and quietly updates itself when you are online.
- **Releasing an update:** edit your files, then bump `V` in `sw.js` (e.g. `ms-v14`). Installed copies refresh on their next launch while online.

## Swapping the pictures

- Mosquito: `assets/mosquito.png`. It is pre-rotated so the nose points right and the wings point up. Tune `CONFIG.MOSQUITO` (`length` = size, `pivotX/Y` = body centre).

## Tuning

Everything is in the `CONFIG` block at the top of [game.js](game.js):

| Setting | What it does |
| --- | --- |
| `START_SPEED` | Mosquito speed at score 0, in screen-widths per second |
| `SPEED_PER_SCORE` / `MAX_SPEED` | How quickly it speeds up |
| `DIVE_AFTER` | Seconds before it dives at the sleeper's face |
| `COOLDOWN` | Seconds between zaps |
| `RESPAWN` | Seconds before the next mosquito |
| `AIM_ASSIST` | Hit generosity (bigger = easier) |
| `VOLUME` | Master volume for the game sounds |
| `KILLS_PER_LEVEL` | Kills needed for each level-up |
| `MOSQUITO.length` | Size of the mosquito sprite |

## Files

```
index.html            UI + screens
styles.css            visual design
game.js               canvas game, audio, config
assets/mosquito.png   mosquito sprite
assets/faces/         face cutouts
assets/sounds/        game audio
```

The layout is made for portrait phones, with a framed phone view on desktop. Landscape phones show a rotate prompt.
