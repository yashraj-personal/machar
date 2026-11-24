mosquito.m4a is the supplied original flight sound.
mosquito-loop.mp3 is the crossfaded, browser-compatible loop used in game.js.
fire.mp3 plays on every shot at 1.12x speed; game-over.mp3 plays on the bite/loss event.

sounds-data.js holds inlined copies of the buzz loop, fire and game-over clips; game.js decodes them with Web Audio for fades, panning and the 1.12x fire speed.
high-score.mp3 (SOUND4) plays on the game-over screen when a new best score is set; it fades out the loss clip underneath it.
