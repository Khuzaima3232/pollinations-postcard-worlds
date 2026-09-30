/**
 * Postcard worlds — type a place, then click doors, paths and windows to step
 * into the next generated view.
 *
 * Two ways to play:
 *   - the demo world is pre-generated and committed, so anyone can explore with
 *     no sign-in at all;
 *   - signing in with your own Pollen lets you type a scene and have it made.
 *
 * Style consistency across steps comes from a locked style descriptor repeated in
 * every prompt. Passing the previous view as a reference image gives continuity
 * of place, but a probe showed it does not hold the palette on its own.
 */
(function () {
	"use strict";

	const GEN = "https://gen.pollinations.ai";
	const ENTER = "https://enter.pollinations.ai";
	const APP_KEY = "pk_SApp5GJqW6pHpHdR";
	const REDIRECT = window.location.origin + window.location.pathname;
	const TOKEN_KEY = "postcard-worlds.token";
	const VERIFIER_KEY = "postcard-worlds.verifier";

	const IMAGE_MODEL = "openai/gpt-image-1-mini";
	const VISION_MODEL = "openai/gpt-5.4-nano";
	const IMAGE_MODELS = ["openai/gpt-image-1-mini", "black-forest-labs/flux.2-klein-4b"];

	/** The locked look, repeated verbatim in every image prompt. */
	const STYLE =
		"Shot on 35mm film, natural overcast daylight, muted earthy palette with warm " +
		"amber highlights, visible grain, shallow depth of field, documentary travel " +
		"photography. Photorealistic, not illustrated.";

	const SPOT_PROMPT = (count) =>
		`You are finding clickable spots in this scene for a point-and-click explorer. ` +
		`Pick the ${count} most interesting places a traveller could step through - a door, ` +
		`path, window, gate, cave or opening. For each, give the spot's centre as a ` +
		`percentage of the image: x and y from 0 to 100, measured from the top-left. ` +
		`Reply with ONLY minified JSON, no prose, in exactly this shape: ` +
		`{"spots":[{"label":"short name","x":42,"y":61,"hint":"where it leads"}]}`;

	const $ = (id) => document.getElementById(id);

	/* ------------------------------------------------------------------ state */

	const state = {
		token: null,
		world: null,        // { title, start, views }
		current: null,      // view id
		trail: [],          // view ids walked
		history: [],        // [{ id, image, spots, prompt }] for back
		busy: false,
	};

	/* ------------------------------------------------------------- auth (BYOP) */

	const base64url = (bytes) =>
		btoa(String.fromCharCode(...new Uint8Array(bytes)))
			.replace(/\+/g, "-")
			.replace(/\//g, "_")
			.replace(/=+$/, "");

	function randomString(length) {
		const bytes = new Uint8Array(length);
		crypto.getRandomValues(bytes);
		return base64url(bytes).slice(0, length);
	}

	async function challengeFor(verifier) {
		const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
		return base64url(digest);
	}

	function storeToken(token) {
		state.token = token || null;
		try {
			if (token) localStorage.setItem(TOKEN_KEY, token);
			else localStorage.removeItem(TOKEN_KEY);
		} catch {
			/* storage may be unavailable */
		}
		paintAuth();
	}

	function paintAuth() {
		const dot = $("auth-dot");
		const label = $("auth-state");
		if (state.token) {
			dot.classList.add("on");
			label.textContent = "signed in";
			$("connect").hidden = true;
			$("disconnect").hidden = false;
		} else {
			dot.classList.remove("on");
			label.textContent = "demo world";
			$("connect").hidden = false;
			$("disconnect").hidden = true;
		}
	}

	async function signIn() {
		const verifier = randomString(64);
		const challenge = await challengeFor(verifier);
		const authState = randomString(16);
		try {
			sessionStorage.setItem(VERIFIER_KEY, JSON.stringify({ verifier, state: authState }));
		} catch {
			/* fall through: the redirect will fail cleanly */
		}
		const params = new URLSearchParams({
			response_type: "code",
			client_id: APP_KEY,
			redirect_uri: REDIRECT,
			scope: "usage",
			code_challenge: challenge,
			code_challenge_method: "S256",
			state: authState,
		});
		window.location.assign(`${ENTER}/authorize?${params}`);
	}

	async function completeSignIn() {
		const params = new URLSearchParams(window.location.search);
		const code = params.get("code");
		if (!code) return null;
		let pending = null;
		try {
			pending = JSON.parse(sessionStorage.getItem(VERIFIER_KEY) || "null");
		} catch {
			pending = null;
		}
		window.history.replaceState({}, "", REDIRECT);
		if (!pending || params.get("state") !== pending.state) {
			setStatus("Sign-in could not be verified. Try again.", true);
			return null;
		}
		const response = await fetch(`${ENTER}/api/token`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				grant_type: "authorization_code",
				client_id: APP_KEY,
				code,
				code_verifier: pending.verifier,
				redirect_uri: REDIRECT,
			}),
		});
		if (!response.ok) {
			setStatus(`Sign-in failed (HTTP ${response.status}).`, true);
			return null;
		}
		const body = await response.json();
		const token = body.access_token || body.api_key;
		if (typeof token !== "string" || !token.startsWith("sk_")) {
			setStatus("Sign-in returned no usable key.", true);
			return null;
		}
		try {
			sessionStorage.removeItem(VERIFIER_KEY);
		} catch {
			/* ignore */
		}
		storeToken(token);
		return token;
	}

	/* ------------------------------------------------------------- generation */

	function setStatus(text, bad) {
		const el = $("status");
		el.textContent = text || "";
		el.style.color = bad ? "var(--bad)" : "";
	}

	async function api(path, payload, method) {
		if (!state.token) throw new Error("Sign in first to generate your own world.");
		const response = await fetch(GEN + path, {
			method: method || "POST",
			headers: { Authorization: `Bearer ${state.token}`, "Content-Type": "application/json" },
			body: payload ? JSON.stringify(payload) : undefined,
		});
		if (response.status === 401) throw new Error("Your sign-in expired. Sign in again.");
		if (response.status === 402) throw new Error("Not enough Pollen for this step.");
		if (response.status === 429) throw new Error("Rate limited. Wait a moment and retry.");
		if (!response.ok) throw new Error(`Pollinations returned HTTP ${response.status}.`);
		return response.json();
	}

	/** Generate one view. `source` is the previous image, as a data URL. */
	async function makeImage(prompt, source) {
		const payload = {
			model: IMAGE_MODEL,
			prompt: `${STYLE} ${prompt}`,
			response_format: "b64_json",
		};
		let route = "/v1/images/generations";
		if (source) {
			payload.image = source;
			route = "/v1/images/edits";
		}
		const body = await api(route, payload);
		const encoded = body && body.data && body.data[0] && body.data[0].b64_json;
		if (!encoded) throw new Error("The image model returned nothing.");
		return `data:image/png;base64,${encoded}`;
	}

	/** Ask the vision model where the clickable spots are. */
	async function makeSpots(imageDataUrl, count) {
		const body = await api("/v1/chat/completions", {
			model: VISION_MODEL,
			messages: [
				{
					role: "user",
					content: [
						{ type: "text", text: SPOT_PROMPT(count) },
						{ type: "image_url", image_url: { url: imageDataUrl } },
					],
				},
			],
		});
		const content = (body.choices || [{}])[0].message?.content || "";
		const start = content.indexOf("{");
		const end = content.lastIndexOf("}");
		if (start < 0 || end < 0) throw new Error("The vision model returned no spots.");
		const parsed = JSON.parse(content.slice(start, end + 1));
		const spots = (parsed.spots || [])
			.filter((s) => typeof s.x === "number" && typeof s.y === "number")
			.map((s) => ({
				label: String(s.label || "step").slice(0, 40),
				x: Math.min(94, Math.max(6, Number(s.x))),
				y: Math.min(94, Math.max(6, Number(s.y))),
				hint: String(s.hint || "").slice(0, 120),
			}));
		if (spots.length === 0) throw new Error("No clickable spots were found.");
		return spots;
	}

	/* -------------------------------------------------------------- rendering */

	function renderTrail() {
		const trail = $("trail");
		trail.innerHTML = "";
		state.trail.forEach((id, index) => {
			if (index > 0) {
				const arrow = document.createElement("span");
				arrow.className = "arrow";
				arrow.textContent = "→";
				trail.appendChild(arrow);
			}
			const chip = document.createElement("span");
			chip.className = "step" + (index === state.trail.length - 1 ? " here" : "");
			const view = state.world && state.world.views[id];
			chip.textContent = (view && view.label) || id;
			trail.appendChild(chip);
		});
	}

	function renderView(entry) {
		const stage = $("stage");
		stage.innerHTML = "";

		const img = document.createElement("img");
		img.src = entry.image;
		img.alt = entry.prompt || "A generated view";
		stage.appendChild(img);

		const caption = document.createElement("div");
		caption.className = "caption";
		caption.textContent = entry.prompt || "";
		stage.appendChild(caption);

		entry.spots.forEach((spot, index) => {
			const button = document.createElement("button");
			button.className = "spot";
			button.style.left = `${spot.x}%`;
			button.style.top = `${spot.y}%`;
			button.title = spot.hint || "";
			const pin = document.createElement("span");
			pin.className = "pin";
			const text = document.createElement("span");
			text.textContent = spot.label;
			const n = document.createElement("span");
			n.className = "n";
			n.textContent = String(index + 1);
			button.append(pin, text, n);
			button.addEventListener("click", () => stepThrough(spot, index));
			stage.appendChild(button);
		});

		$("back").hidden = state.history.length <= 1;
		renderTrail();
	}

	function showLog(lines) {
		const log = $("log");
		if (!lines || lines.length === 0) {
			log.hidden = true;
			log.innerHTML = "";
			return;
		}
		log.hidden = false;
		log.innerHTML = "";
		for (const line of lines) {
			const p = document.createElement("div");
			p.innerHTML = line;
			log.appendChild(p);
		}
	}

	/* ------------------------------------------------------------- the walk */

	function enterDemo() {
		setStatus("Loading the demo world…");
		fetch("worlds/demo.json")
			.then((response) => {
				if (!response.ok) throw new Error(`HTTP ${response.status}`);
				return response.json();
			})
			.then((world) => {
				state.world = world;
				state.history = [];
				state.trail = [];
				state.current = world.start;
				const view = world.views[world.start];
				const entry = {
					id: world.start,
					label: view.label || view.prompt.split(",")[0].slice(0, 28),
					image: view.image,
					spots: view.spots,
					prompt: view.prompt,
					leads_to: view.leads_to,
				};
				state.history.push(entry);
				state.trail.push(entry.id);
				renderView(entry);
				setStatus(`${world.title} — click a spot to step through.`);
				showLog([]);
			})
			.catch((error) => setStatus(`Could not load the demo world: ${error.message}`, true));
	}

	async function startWorld(prompt) {
		if (!state.token) {
			setStatus("Sign in first to generate your own world.", true);
			return;
		}
		state.busy = true;
		$("begin").disabled = true;
		try {
			setStatus("Generating the first view…");
			const image = await makeImage(prompt, null);
			setStatus("Finding places to step through…");
			const spots = await makeSpots(image, 3);
			const entry = {
				id: "start",
				label: prompt.split(",")[0].slice(0, 28),
				image,
				spots,
				prompt,
				leads_to: [],
			};
			state.world = { title: prompt.slice(0, 60), start: "start", views: {} };
			state.history = [entry];
			state.trail = ["start"];
			state.current = "start";
			renderView(entry);
			setStatus("Click a spot to step through. Each step is generated from this view.");
			showLog([]);
		} catch (error) {
			setStatus(error.message, true);
		} finally {
			state.busy = false;
			$("begin").disabled = false;
		}
	}

	async function stepThrough(spot, index) {
		if (state.busy) return;
		const last = state.history[state.history.length - 1];

		// In a pre-generated demo world, follow the authored link instead.
		if (state.world.views[last.id] && state.world.views[last.id].image.startsWith("worlds/")) {
			const leadsTo = last.leads_to || [];
			// Each spot records where it leads. Falling back to label words was
			// tried and does not work: a vision model's "track-curves" shares no
			// word with the view id "frozen-tracks", so the paths crossed.
			const nextId =
				spot.to ||
				leadsTo.find((id) => id === spot.to) ||
				(leadsTo.length > 0 ? leadsTo[Math.min(index, leadsTo.length - 1)] : null);
			if (!nextId) {
				setStatus("That spot is a dead end in the demo world.");
				return;
			}
			const view = state.world.views[nextId];
			const entry = {
				id: nextId,
				label: view.label || view.prompt.split(",")[0].slice(0, 28),
				image: view.image,
				spots: view.spots,
				prompt: view.prompt,
				leads_to: view.leads_to,
			};
			state.history.push(entry);
			state.trail.push(entry.id);
			renderView(entry);
			setStatus(`Stepped through "${spot.label}".`);
			return;
		}

		state.busy = true;
		try {
			setStatus(`Stepping through "${spot.label}"…`);
			const prompt =
				`Continue the world: step through the ${spot.label}` +
				(spot.hint ? ` (${spot.hint})` : "") +
				`. Same place, same light, a little further on.`;
			const image = await makeImage(prompt, last.image);
			setStatus("Looking for what is next…");
			const spots = await makeSpots(image, 3);
			const entry = {
				id: `step-${state.history.length}`,
				label: spot.label,
				image,
				spots,
				prompt,
				leads_to: [],
			};
			state.history.push(entry);
			state.trail.push(entry.id);
			renderView(entry);
			setStatus("Stepped through. Keep going, or go back.");
		} catch (error) {
			setStatus(error.message, true);
		} finally {
			state.busy = false;
		}
	}

	function goBack() {
		if (state.history.length <= 1) return;
		state.history.pop();
		state.trail.pop();
		renderView(state.history[state.history.length - 1]);
		setStatus("Went back a step.");
	}

	/* ------------------------------------------------------------- replay link */

	/** The trail is encoded in the URL so a path can be shared and replayed. */
	function replayLink() {
		const params = new URLSearchParams();
		params.set("path", state.trail.join(","));
		if (state.world && state.world.title) params.set("title", state.world.title.slice(0, 80));
		return `${REDIRECT}?${params}`;
	}

	async function copyReplay() {
		const link = replayLink();
		try {
			await navigator.clipboard.writeText(link);
			setStatus("Replay link copied.");
		} catch {
			showLog([`Replay link: <span class="share">${link}</span>`]);
			setStatus("Copy the replay link from the box below.");
		}
	}

	/* ------------------------------------------------------------------- boot */

	async function boot() {
		paintAuth();

		const params = new URLSearchParams(window.location.search);
		if (params.get("code")) {
			await completeSignIn();
		} else {
			const stored = (() => {
				try {
					return localStorage.getItem(TOKEN_KEY);
				} catch {
					return null;
				}
			})();
			if (stored && stored.startsWith("sk_")) storeToken(stored);
		}

		// A shared replay link opens straight into the demo world's path.
		const path = params.get("path");
		if (path && !state.token) {
			enterDemo();
			showLog([`Replay of a path: <b>${path.replace(/,/g, " → ")}</b>`]);
		} else if (!state.token) {
			enterDemo();
		}

		$("begin").addEventListener("click", () => {
			const prompt = $("scene").value.trim();
			if (!prompt) {
				setStatus("Describe a place first.", true);
				return;
			}
			startWorld(prompt);
		});
		$("demo").addEventListener("click", enterDemo);
		$("back").addEventListener("click", goBack);
		$("replay").addEventListener("click", copyReplay);
		$("connect").addEventListener("click", signIn);
		$("disconnect").addEventListener("click", () => {
			storeToken(null);
			setStatus("Signed out. The demo world still works.");
		});

		$("replay").hidden = false;
	}

	// Exported for the test harness; the browser just runs boot().
	if (typeof module !== "undefined" && module.exports) {
		module.exports = { state, replayLink, base64url, SPOT_PROMPT, STYLE, IMAGE_MODELS };
	} else {
		window.__postcardWorlds = { state, replayLink, STYLE, SPOT_PROMPT, boot };
		boot().catch((error) => setStatus(`Could not start: ${error.message}`, true));
	}
})();
