HOW TO ADD GAMES TO ROKI
========================

Put each game in this folder (Downloads/ROKI/public/games), then open Games in ROKI.

Two ways to add a game:

1. A folder with an index.html inside
     public/games/my-cool-game/index.html   -> shows as "My Cool Game"
   Everything the game needs (scripts, images, sounds) goes in that same folder.
   For a picture on the Games page, add cover.png (or .jpg, .webp, .gif, .svg) to the folder.

2. A single .html file
     public/games/snake.html   -> shows as "Snake"
   For a picture, put snake.png (same name) next to it.

Tips
- Dashes and underscores in names become spaces: retro_racer -> "Retro Racer".
- Names starting with _ or . are hidden, so you can park a game as _old-game.
- Games that load files from other websites (CDNs, ads, online fonts) may not work,
  because ROKI's server blocks most outside files for the proxy to work. Games that
  have all their files in their own folder work best.
- Game saves (high scores, progress) are kept. "Wipe site data" only clears sites
  you visited through the proxy.
- Only add games you made or that you're allowed to share, and that you trust:
  games run on ROKI's own site.
