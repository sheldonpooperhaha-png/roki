// The owner's accounts tool (run through deploy/accounts.sh on the server):
//   list            everyone's username and when they joined
//   reset NAME      asks for a new password for NAME (logs them out everywhere)
//   delete NAME     removes NAME's account
// ROKI notices the change within a few seconds; no restart needed.
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { createAccounts } from "./accounts.js";

const dataDir = process.env.ROKI_DATA_DIR || fileURLToPath(new URL("../data/", import.meta.url));
const accounts = createAccounts({ file: join(dataDir, "accounts.json"), secret: "accounts-tool" });
const [cmd, name] = process.argv.slice(2);

// When the answers are piped in instead of typed, read them all once and hand them out a line at a time
let piped = null;
function pipedLines() {
	if (!piped) {
		piped = new Promise((resolve) => {
			let buf = "";
			process.stdin.setEncoding("utf8");
			process.stdin.on("data", (d) => (buf += d));
			process.stdin.on("end", () => resolve(buf.split(/\r?\n/)));
		});
	}
	return piped;
}

// Reads a line without showing what's typed
function askHidden(question) {
	return new Promise((resolve) => {
		const stdin = process.stdin;
		process.stdout.write(question);
		if (!stdin.isTTY) {
			pipedLines().then((lines) => {
				process.stdout.write("\n");
				resolve(lines.shift() || "");
			});
			return;
		}
		stdin.setRawMode(true);
		stdin.resume();
		stdin.setEncoding("utf8");
		let value = "";
		const onData = (ch) => {
			if (ch === "\r" || ch === "\n") {
				stdin.setRawMode(false);
				stdin.pause();
				stdin.off("data", onData);
				process.stdout.write("\n");
				resolve(value);
			} else if (ch === "\u0003") {
				process.stdout.write("\n");
				process.exit(1);
			} else if (ch === "\u007f" || ch === "\b") {
				value = value.slice(0, -1);
			} else {
				value += ch;
			}
		};
		stdin.on("data", onData);
	});
}

if (cmd === "list") {
	const list = accounts.list();
	if (!list.length) console.log("No accounts yet.");
	for (const u of list) console.log(`${u.name.padEnd(22)} joined ${new Date(u.created).toLocaleString()}`);
	console.log(`${list.length} account${list.length === 1 ? "" : "s"}`);
} else if (cmd === "reset" && name) {
	const pw = await askHidden(`New password for ${name}: `);
	const again = await askHidden("Type it again: ");
	if (pw !== again) {
		console.log("Those don't match. Nothing changed.");
		process.exit(1);
	}
	const r = await accounts.resetPassword(name, pw);
	console.log(r.ok ? `Done. ${name} can log in with the new password.` : r.error);
	process.exit(r.ok ? 0 : 1);
} else if (cmd === "delete" && name) {
	console.log(accounts.remove(name) ? `Deleted ${name}.` : "No account with that username.");
} else {
	console.log("Usage: list | reset NAME | delete NAME");
	process.exit(1);
}
