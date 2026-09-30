/**
 * Tests for the Postcard-worlds app.
 *
 * app.js is a plain browser script that also exports via module.exports, so the
 * real implementation is required directly. Anything that touches the DOM or the
 * network is stubbed; the assertions are on the shipping code.
 */
const { readFileSync, existsSync } = require("node:fs");
const { join } = require("node:path");

const ROOT = join(__dirname, "..");
const world = JSON.parse(readFileSync(join(ROOT, "worlds", "demo.json"), "utf8"));
const appSource = readFileSync(join(ROOT, "app.js"), "utf8");
const html = readFileSync(join(ROOT, "index.html"), "utf8");

const failures = [];
const ok = (label, pass, detail) => {
	if (!pass) failures.push(label + (detail ? ` — ${detail}` : ""));
	console.log(`${pass ? "ok  " : "FAIL"}  ${label}${!pass && detail ? ` — ${detail}` : ""}`);
};

/* ---- the demo world ---- */

ok("world has a title", typeof world.title === "string" && world.title.length > 0, world.title);
ok("world names its start view", typeof world.start === "string");
ok("the start view exists", Boolean(world.views[world.start]), world.start);
ok("world has several views", Object.keys(world.views).length >= 5, String(Object.keys(world.views).length));

for (const [id, view] of Object.entries(world.views)) {
	ok(`${id}: image is committed`, existsSync(join(ROOT, view.image)), view.image);
	ok(`${id}: has a prompt`, typeof view.prompt === "string" && view.prompt.length > 10);
	// A view either offers somewhere to go, or is a deliberate dead end.
	ok(`${id}: offers spots, or is a dead end`,
		view.leads_to.length === 0 || (Array.isArray(view.spots) && view.spots.length >= 1),
		`${view.spots && view.spots.length} spots, ${view.leads_to.length} links`);
	ok(`${id}: a dead end has no spots left behind`,
		view.leads_to.length > 0 || (view.spots || []).length === 0,
		String((view.spots || []).length));
	for (const spot of view.spots || []) {
		ok(`${id}/${spot.label}: x is a percentage in range`,
			typeof spot.x === "number" && spot.x >= 0 && spot.x <= 100, String(spot.x));
		ok(`${id}/${spot.label}: y is a percentage in range`,
			typeof spot.y === "number" && spot.y >= 0 && spot.y <= 100, String(spot.y));
		ok(`${id}/${spot.label}: has a label`, typeof spot.label === "string" && spot.label.length > 0);
		// Every clickable spot must name where it goes, or the click does nothing.
		ok(`${id}/${spot.label}: records its destination`,
			typeof spot.to === "string" && spot.to.length > 0, String(spot.to));
		ok(`${id}/${spot.label}: its destination exists`,
			Boolean(world.views[spot.to]), String(spot.to));
	}
	for (const next of view.leads_to) {
		ok(`${id}: leads_to "${next}" exists`, Boolean(world.views[next]), next);
	}
	ok(`${id}: spot count matches authored links`,
		view.leads_to.length === (view.spots || []).length,
		`${(view.spots || []).length} spots vs ${view.leads_to.length} links`);
}

// Every view must be reachable from the start, or it is dead content.
const seen = new Set();
const walk = (id) => {
	if (seen.has(id)) return;
	seen.add(id);
	for (const next of world.views[id].leads_to) walk(next);
};
walk(world.start);
ok("every view is reachable from the start",
	seen.size === Object.keys(world.views).length,
	`reached ${seen.size} of ${Object.keys(world.views).length}`);

// There must be somewhere to go, and an end to reach.
ok("at least one view has a choice of paths",
	Object.values(world.views).some((v) => v.leads_to.length >= 2));
ok("at least one view is a dead end (a place to stop)",
	Object.values(world.views).some((v) => v.leads_to.length === 0));

// A spot's destination must be recorded, not inferred. Matching a vision model's
// label ("track-curves") to a view id ("frozen-tracks") by shared words does not
// work — they share none — and index order is arbitrary, which crossed the paths
// in the first build. The world now records `to` on each spot.
for (const [id, view] of Object.entries(world.views)) {
	for (const spot of view.spots || []) {
		ok(`${id}: "${spot.label}" records where it leads`,
			typeof spot.to === "string" && spot.to.length > 0, String(spot.to));
	}
}
ok('the crossed-path bug stays fixed: "track-curves" leads to the tracks',
	world.views["misty-valley-station"].spots.find((s) => s.label.includes("track")).to === "frozen-tracks");
ok('the crossed-path bug stays fixed: "shed-door" leads to the shelter',
	world.views["misty-valley-station"].spots.find((s) => s.label.includes("shed")).to === "platform-shelter");
ok("app.js follows the recorded destination",
	/spot\.to/.test(appSource), "the app reads spot.to");
ok("app.js does not fall back to word matching",
	!/spotWords/.test(appSource), "word matching was removed");

/* ---- the app's own logic, loaded for real ---- */

// Minimal stubs so the module can be evaluated outside a browser.
const stubElement = () => ({
	style: {}, classList: { add() {}, remove() {} }, dataset: {},
	set innerHTML(_v) {}, get innerHTML() { return ""; },
	set textContent(_v) {}, get textContent() { return ""; },
	append() {}, appendChild() {}, addEventListener() {}, hidden: false, disabled: false,
	value: "", title: "",
});
const document = {
	getElementById: () => stubElement(),
	createElement: () => stubElement(),
};
const window = { location: { origin: "https://example.test", pathname: "/", search: "" }, history: { replaceState() {} } };
const module_ = { exports: {} };
new Function("module", "document", "window", "localStorage", "sessionStorage", "fetch", "navigator", "crypto", "btoa", "TextEncoder", "URLSearchParams", appSource)(
	module_, document, window, { getItem: () => null, setItem() {}, removeItem() {} },
	{ getItem: () => null, setItem() {}, removeItem() {} }, async () => ({ ok: false, status: 500 }),
	{}, {}, (s) => Buffer.from(s, "binary").toString("base64"), TextEncoder, URLSearchParams,
);
const app = module_.exports;

ok("app.js exports its helpers", Boolean(app.replayLink && app.STYLE && app.SPOT_PROMPT));

// The locked style must be a real descriptor, since it is what holds the look.
ok("the style descriptor is substantial", app.STYLE.length > 80, String(app.STYLE.length));
ok("the style descriptor names the medium", /film|photo/i.test(app.STYLE), app.STYLE.slice(0, 40));
ok("the style descriptor says photorealistic", /photorealistic/i.test(app.STYLE));

// The spot prompt must ask for the JSON shape the parser expects.
const spotPrompt = app.SPOT_PROMPT(3);
ok("the spot prompt asks for minified JSON", /ONLY minified JSON/i.test(spotPrompt));
ok("the spot prompt asks for percentage coordinates", /percentage/i.test(spotPrompt));
ok("the spot prompt asks for the x/y keys the parser reads",
	spotPrompt.includes('"x"') && spotPrompt.includes('"y"'), spotPrompt.slice(0, 60));
ok("the spot prompt asks for the count it is given", spotPrompt.includes("3"));
ok("the spot prompt asks for a label and a hint",
	spotPrompt.includes('"label"') && spotPrompt.includes('"hint"'));

// The replay link carries the path, so a walk can be shared.
app.state.trail = ["misty-valley-station", "frozen-tracks", "culvert-mouth"];
const link = app.replayLink();
ok("the replay link encodes the path", link.includes("path=misty-valley-station%2Cfrozen-tracks%2Cculvert-mouth"), link);
ok("the replay link is absolute", link.startsWith("https://"), link);
ok("an empty trail still produces a link", (() => {
	app.state.trail = [];
	return typeof app.replayLink() === "string";
})());

/* ---- wiring ---- */

ok("index.html loads app.js", html.includes('src="app.js"'));
ok("index.html has the stage", html.includes('id="stage"'));
ok("index.html has the trail", html.includes('id="trail"'));
ok("index.html has the scene input", html.includes('id="scene"'));
ok("index.html has the demo button", html.includes('id="demo"'));
ok("index.html mentions the demo world needs no sign-in", /no sign-in/i.test(html));
ok("index.html credits Pollinations", html.includes("gen.pollinations.ai"));
ok("index.html has no stray non-ASCII in CSS",
	!/#[0-9a-fA-F]{3,6}[^\s;{}]*[\u4e00-\u9fff]/.test(html), "no CJK characters inside colour values");

console.log(failures.length ? `\n${failures.length} FAILED\n${failures.join("\n")}` : "\nall checks passed");
process.exit(failures.length ? 1 : 0);
