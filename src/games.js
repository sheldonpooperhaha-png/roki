// ROKI games: anything in public/games shows up on the Games page.
// A game is either a folder with an index.html inside, or a single .html file.
// For a picture, add cover.png / .jpg / .webp / .gif / .svg inside the folder,
// or an image with the same name next to a single file (snake.html + snake.png).
import { readdirSync, existsSync } from "node:fs";
import { join } from "node:path";

const COVER_EXTS = [".png", ".jpg", ".jpeg", ".webp", ".gif", ".svg"];

// "star-catcher" -> "Star Catcher"
export function gameName(s) {
	return String(s)
		.replace(/[-_]+/g, " ")
		.replace(/\s+/g, " ")
		.trim()
		.split(" ")
		.map((w) => (w ? w.charAt(0).toUpperCase() + w.slice(1) : w))
		.join(" ");
}

export function listGames(gamesPath) {
	let entries;
	try {
		entries = readdirSync(gamesPath, { withFileTypes: true });
	} catch {
		return [];
	}
	const games = [];
	for (const e of entries) {
		if (e.name.startsWith(".") || e.name.startsWith("_")) continue;
		if (e.isDirectory()) {
			const dir = join(gamesPath, e.name);
			if (!existsSync(join(dir, "index.html"))) continue;
			const enc = encodeURIComponent(e.name);
			const cover = COVER_EXTS.map((x) => "cover" + x).find((f) => existsSync(join(dir, f)));
			games.push({ id: e.name, name: gameName(e.name), url: `/games/${enc}/`, cover: cover ? `/games/${enc}/${cover}` : null });
		} else if (e.isFile() && /\.html?$/i.test(e.name)) {
			const base = e.name.replace(/\.html?$/i, "");
			if (!base || base.toLowerCase() === "index") continue;
			const cover = COVER_EXTS.map((x) => base + x).find((f) => existsSync(join(gamesPath, f)));
			games.push({
				id: base,
				name: gameName(base),
				url: `/games/${encodeURIComponent(e.name)}`,
				cover: cover ? `/games/${encodeURIComponent(cover)}` : null,
			});
		}
	}
	return games.sort((a, b) => a.name.localeCompare(b.name));
}
