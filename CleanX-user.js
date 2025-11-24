// ==UserScript==
// @name         X Country Blocker - Clean Start (No Defaults)
// @namespace    http://tampermonkey.net/
// @version      5.1
// @description  Block by country & language — completely empty by default. You decide everything.
// @author       A Pleasant Experience
// @match        https://x.com/*
// @match        https://twitter.com/*
// @grant        GM_xmlhttpRequest
// @run-at       document-start
// ==/UserScript==

(function () {
	"use strict";

	if (!/^https?:\/\/(x|twitter)\.com\//.test(window.location.href)) return;

	const STORAGE_KEY = "xCountryBlocker";
	let config = {
		blockedCountries: new Set(), // ← EMPTY
		blockedLangs: new Set(), // ← EMPTY
		countryDB: {}, // code -> [usernames]
		knownUsers: {}, // username -> { accountCountry, ts }
		pending: new Set(),
	};
	const fetchQueue = [];

	const nowTs = () => Date.now();
	let blockedCount = 0;
	let nextFetchAllowed = 0;
	const FETCH_GAP_MS = 3500; // throttle outbound requests
	const RATE_LIMIT_BACKOFF_MS = 2 * 60 * 1000; // back off 2 minutes on 429
	const UNKNOWN_RETRY_MS = 10 * 60 * 1000; // retry unknowns after 10m
	const PREFETCH_BATCH = 5;
	const PREFETCH_INTERVAL_MS = 4000;
	const blockStats = { country: {}, lang: {} }; // session-only counts
	let dbPromise = null;
	const FIELD_TOGGLES = { withAuxiliaryUserLabels: false };
	const BEARER_TOKEN =
		"AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs=1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA";
	const ABOUT_QUERY_ID = "XRqGa7EeokUU5kppkh13EA";
	const GRAPHQL_FEATURES = {
		hidden_profile_subscriptions_enabled: true,
		subscriptions_verification_info_is_identity_verified_enabled: true,
		subscriptions_verification_info_verified_since_enabled: true,
		responsive_web_graphql_skip_user_profile_image_extensions_enabled: true,
		responsive_web_graphql_timeline_navigation_enabled: true,
		responsive_web_graphql_timeline_navigation_enabled_elsewhere: true,
		responsive_web_enhance_cards_enabled: true,
		verified_phone_label_enabled: true,
		creator_subscriptions_tweet_preview_api_enabled: true,
		highlights_tweets_tab_ui_enabled: true,
		longform_notetweets_consumption_enabled: true,
		tweetypie_unmention_optimization_enabled: true,
		vibe_api_enabled: true,
	};

	// Full country map (unchanged)
	const COUNTRY_MAP = {
		/* same huge list as before */ Afghanistan: "AF",
		Albania: "AL",
		Algeria: "DZ",
		Andorra: "AD",
		Angola: "AO",
		Argentina: "AR",
		Armenia: "AM",
		Australia: "AU",
		Austria: "AT",
		Azerbaijan: "AZ",
		Bahamas: "BS",
		Bahrain: "BH",
		Bangladesh: "BD",
		Barbados: "BB",
		Belarus: "BY",
		Belgium: "BE",
		Belize: "BZ",
		Benin: "BJ",
		Bhutan: "BT",
		Bolivia: "BO",
		"Bosnia and Herzegovina": "BA",
		Botswana: "BW",
		Brazil: "BR",
		Bulgaria: "BG",
		"Burkina Faso": "BF",
		Burundi: "BI",
		Cambodia: "KH",
		Cameroon: "CM",
		Canada: "CA",
		Chile: "CL",
		China: "CN",
		Colombia: "CO",
		"Costa Rica": "CR",
		Croatia: "HR",
		Cuba: "CU",
		Cyprus: "CY",
		Czechia: "CZ",
		Denmark: "DK",
		"Dominican Republic": "DO",
		Ecuador: "EC",
		Egypt: "EG",
		"El Salvador": "SV",
		Estonia: "EE",
		Ethiopia: "ET",
		Finland: "FI",
		France: "FR",
		Georgia: "GE",
		Germany: "DE",
		Ghana: "GH",
		Greece: "GR",
		Guatemala: "GT",
		Honduras: "HN",
		Hungary: "HU",
		Iceland: "IS",
		India: "IN",
		Indonesia: "ID",
		Iran: "IR",
		Iraq: "IQ",
		Ireland: "IE",
		Israel: "IL",
		Italy: "IT",
		Jamaica: "JM",
		Japan: "JP",
		Jordan: "JO",
		Kazakhstan: "KZ",
		Kenya: "KE",
		Kuwait: "KW",
		Latvia: "LV",
		Lebanon: "LB",
		Libya: "LY",
		Lithuania: "LT",
		Luxembourg: "LU",
		Madagascar: "MG",
		Malaysia: "MY",
		Maldives: "MV",
		Mexico: "MX",
		Monaco: "MC",
		Morocco: "MA",
		Nepal: "NP",
		Netherlands: "NL",
		"New Zealand": "NZ",
		Nigeria: "NG",
		Norway: "NO",
		Oman: "OM",
		Pakistan: "PK",
		Panama: "PA",
		Paraguay: "PY",
		Peru: "PE",
		Philippines: "PH",
		Poland: "PL",
		Portugal: "PT",
		Qatar: "QA",
		Romania: "RO",
		Russia: "RU",
		"Saudi Arabia": "SA",
		Senegal: "SN",
		Serbia: "RS",
		Singapore: "SG",
		Slovakia: "SK",
		Slovenia: "SI",
		"South Africa": "ZA",
		"South Korea": "KR",
		Spain: "ES",
		"Sri Lanka": "LK",
		Sweden: "SE",
		Switzerland: "CH",
		Taiwan: "TW",
		Thailand: "TH",
		Tunisia: "TN",
		Turkey: "TR",
		Ukraine: "UA",
		"United Arab Emirates": "AE",
		"United Kingdom": "GB",
		"United States": "US",
		Uruguay: "UY",
		Venezuela: "VE",
		Vietnam: "VN",
		Yemen: "YE",
		Zimbabwe: "ZW",
	};

	const LANG_SCRIPTS = {
		hi: /[\u0900-\u097F]/,
		ta: /[\u0B80-\u0BFF]/,
		te: /[\u0C00-\u0C7F]/,
		kn: /[\u0C80-\u0CFF]/,
		ml: /[\u0D00-\u0D7F]/,
		he: /[\u0590-\u05FF]/,
		ur: /[\u0600-\u06FF]/,
		pa: /[\u0A00-\u0A7F]/,
		ar: /[\u0600-\u06FF]/,
		fa: /[\u0600-\u06FF]/,
		ps: /[\u0600-\u06FF]/,
	};

	function load() {
		const saved = localStorage.getItem(STORAGE_KEY);
		if (saved) {
			const parsed = JSON.parse(saved);
			config.blockedCountries = new Set(parsed.blockedCountries || []);
			config.blockedLangs = new Set(parsed.blockedLangs || []);
			config.countryDB = parsed.countryDB || {};
		}
	}
	function save() {
		localStorage.setItem(
			STORAGE_KEY,
			JSON.stringify({
				blockedCountries: Array.from(config.blockedCountries),
				blockedLangs: Array.from(config.blockedLangs),
				countryDB: config.countryDB,
			}),
		);
	}

	function exportDB() {
		return JSON.stringify(
			{
				countryDB: config.countryDB,
				knownUsers: config.knownUsers,
			},
			null,
			2,
		);
	}

	function openDB() {
		if (dbPromise) return dbPromise;
		dbPromise = new Promise((resolve, reject) => {
			const req = indexedDB.open("xcb-country-blocker", 1);
			req.onerror = () => reject(req.error);
			req.onupgradeneeded = () => {
				const db = req.result;
				if (!db.objectStoreNames.contains("known")) {
					db.createObjectStore("known", { keyPath: "user" });
				}
			};
			req.onsuccess = () => resolve(req.result);
		});
		return dbPromise;
	}

	async function loadKnownFromDB() {
		try {
			const db = await openDB();
			const tx = db.transaction("known", "readonly");
			const store = tx.objectStore("known");
			const rows = await new Promise((resolve, reject) => {
				const req = store.getAll();
				req.onsuccess = () => resolve(req.result || []);
				req.onerror = () => reject(req.error);
			});
			config.knownUsers = {};
			for (const row of rows) {
				if (!row?.user) continue;
				config.knownUsers[row.user] = {
					accountCountry: row.accountCountry || null,
					ts: row.ts || 0,
				};
			}
		} catch (e) {
			console.warn("[XCB] loadKnownFromDB failed", e);
		}
	}

	async function saveKnownToDB(user, data) {
		try {
			const db = await openDB();
			const tx = db.transaction("known", "readwrite");
			tx.objectStore("known").put({
				user,
				accountCountry: data.accountCountry || null,
				ts: data.ts || nowTs(),
			});
		} catch (e) {
			console.warn("[XCB] saveKnownToDB failed", e);
		}
	}
	load();

	function normUser(u) {
		return (u || "").toLowerCase().replace(/^@/, "");
	}

	function extractUsername(tweet) {
		const link =
			tweet.querySelector('div[data-testid="User-Name"] a[href]') ||
			tweet.querySelector('a[href*="/status/"]');
		if (!link) return null;

		let href = link.getAttribute("href") || "";
		if (/^https?:\/\//i.test(href)) {
			try {
				href = new URL(href).pathname;
			} catch (e) {
				/* ignore */
			}
		}
		const parts = href.split("/").filter(Boolean);
		if (!parts.length) return null;
		// Prefer the first non-reserved segment
		const candidate = parts[0];
		if (
			["i", "home", "explore", "notifications", "messages", "search"].includes(
				candidate,
			)
		)
			return null;
		return normUser(candidate);
	}

	function resolveCountryCode(input) {
		if (!input) return null;
		const raw = input.trim();
		if (!raw) return null;
		const upper = raw.toUpperCase();
		if (
			upper.length === 2 &&
			COUNTRY_MAP &&
			Object.values(COUNTRY_MAP).includes(upper)
		)
			return upper;
		// fuzzy by country name substring
		const found = Object.entries(COUNTRY_MAP).find(([name]) =>
			name.toLowerCase().includes(raw.toLowerCase()),
		);
		return found ? found[1] : null;
	}

	// ← everything else (fetch, hide, UI, scanning) is 100% identical to v5.0 above ←
	// (just copy the full body from the previous working script, only the config defaults changed)

	function hasBlockedLang(text) {
		if (!text) return false;
		for (const lang of config.blockedLangs)
			if (LANG_SCRIPTS[lang]?.test(text)) return lang;
		return false;
	}

	function hide(tweet, reason) {
		if (tweet.dataset.blocked) return;
		tweet.dataset.blocked = "1";
		tweet.style.setProperty("display", "none", "important");
		const box = document.createElement("div");
		box.textContent = `Blocked: ${reason}`;
		box.style =
			"background:#000;color:#fff;padding:4px 8px;font-size:11px;border-radius:4px;margin:8px 0;";
		tweet.parentNode?.insertBefore(box, tweet);
		console.log("Blocked:", reason);
		blockedCount += 1;
		const counterEl = document.getElementById("xcb-blocked-count");
		if (counterEl)
			counterEl.textContent = `Blocked this session: ${blockedCount}`;
	}

	function parseProfileFromJson(obj) {
		if (!obj || typeof obj !== "object")
			return { accountCountry: null };
		const result =
			obj.user?.result ||
			obj.user_result_by_screen_name?.result ||
			obj.about_account?.result ||
			obj.data?.user?.result ||
			obj.data?.user_result_by_screen_name?.result ||
			obj.data?.about_account?.result ||
			obj.data?.user;

		if (!result) return { accountCountry: null };

		const about =
			result.aboutModule ||
			result.about ||
			result.legacy?.about ||
			result.about_account ||
			result;

		const aboutProfile =
			result.about_profile ||
			result.aboutProfile ||
			result.profile ||
			result.profile_about ||
			{};

		const accountCountryRaw =
			about?.accountBasedIn ||
			about?.account_based_in ||
			about?.account_base ||
			about?.accountCountry ||
			aboutProfile?.account_based_in ||
			aboutProfile?.accountBasedIn ||
			null;
		const accountCountry = accountCountryRaw
			? COUNTRY_MAP[accountCountryRaw] ||
				accountCountryRaw.slice(0, 2).toUpperCase()
			: null;

		return { accountCountry };
	}

	function getCsrfToken() {
		const match = document.cookie.match(/(?:^|; )ct0=([^;]+)/);
		return match ? match[1] : "";
	}

	function needsFetch(user) {
		if (!user) return false;
		if (config.blockedCountries.size === 0 && config.blockedLangs.size === 0)
			return false;
		const known = config.knownUsers[user];
		if (!known) return true;
		if (known.accountCountry) return false;
		if (known.ts && nowTs() - known.ts < UNKNOWN_RETRY_MS) return false;
		return true;
	}

	function queueUser(user) {
		const u = normUser(user);
		if (!needsFetch(u)) return;
		if (config.pending.has(u)) return;
		if (fetchQueue.includes(u)) return;
		fetchQueue.push(u);
	}

	function fetchCountry(username) {
		const user = normUser(username);
		if (!user) return false;

		const known = config.knownUsers[user];
		if (known) {
			if (known.accountCountry) return;
			if (known.ts && nowTs() - known.ts < UNKNOWN_RETRY_MS) return;
		}
		if (config.pending.has(user)) return false;

		// Avoid hammering if nothing to block
		if (config.blockedCountries.size === 0 && config.blockedLangs.size === 0)
			return false;

		// Respect global throttle
		const now = nowTs();
		if (now < nextFetchAllowed) {
			// schedule retry later by stamping ts to avoid tight loop
			config.knownUsers[user] = {
				accountCountry: null,
				ts: now,
			};
			return false;
		}

		config.pending.add(user);
		console.log("[XCB] fetching about page for", user);
		const host = window.location.host || "x.com";
		const url = `https://${host}/i/api/graphql/${ABOUT_QUERY_ID}/AboutAccountQuery?variables=${encodeURIComponent(
			JSON.stringify({ screenName: user }),
		)}&features=${encodeURIComponent(JSON.stringify(GRAPHQL_FEATURES))}&fieldToggles=${encodeURIComponent(
			JSON.stringify(FIELD_TOGGLES),
		)}`;

		fetch(url, {
			credentials: "include",
			method: "GET",
			headers: {
				"x-csrf-token": getCsrfToken(),
				authorization: `Bearer ${BEARER_TOKEN}`,
				"content-type": "application/json",
				"x-twitter-active-user": "yes",
				"x-twitter-auth-type": "OAuth2Session",
				"x-twitter-client-language": navigator.language || "en",
				"x-client-transaction-id": Math.random().toString(36).slice(2, 10),
				referer: `https://${host}/${user}`,
			},
		})
			.then((resp) =>
				resp
					.json()
					.then((body) => ({ status: resp.status, body }))
					.catch(() => ({ status: resp.status, body: {} })),
			)
			.then(({ status, body }) => {
				if (status === 429) {
					nextFetchAllowed = Math.max(
						nextFetchAllowed,
						nowTs() + RATE_LIMIT_BACKOFF_MS,
					);
					config.pending.delete(user);
					queueUser(user);
					return;
				}
				if (status >= 400) {
					console.warn("[XCB] about query failed", status, body?.errors);
					config.pending.delete(user);
					return;
				}
				const info = parseProfileFromJson(body);
				console.log("[XCB] about json", user, info);
				if (!info.accountCountry) {
					config.knownUsers[user] = {
						accountCountry: null,
						ts: nowTs(),
					};
					save();
					return;
				}
				config.knownUsers[user] = {
					accountCountry: info.accountCountry || null,
					ts: nowTs(),
				};
				saveKnownToDB(user, config.knownUsers[user]);
				if (info.accountCountry) {
					const code = info.accountCountry;
					if (!config.countryDB[code]) config.countryDB[code] = [];
					if (!config.countryDB[code].includes(user))
						config.countryDB[code].push(user);
					if (config.blockedCountries.has(code)) scanAndHide();
				}
				save();
			})
			.catch((err) => {
				console.error("[XCB] fetch about failed", user, err);
			})
			.finally(() => {
				config.pending.delete(user);
				nextFetchAllowed = Math.max(nextFetchAllowed, nowTs() + FETCH_GAP_MS);
			});
		return true;
	}

	function scanAndHide() {
		document
			.querySelectorAll('article[data-testid="tweet"]')
			.forEach((tweet) => {
				if (tweet.dataset.blocked) return;

				const userKey = extractUsername(tweet);
				if (!userKey) return;

				const text =
					tweet.querySelector('[data-testid="tweetText"]')?.textContent ||
					tweet.innerText ||
					"";
				const langMatch = hasBlockedLang(text);
				let reason = langMatch ? `Lang:${langMatch}` : "";
				const userInfo = config.knownUsers[userKey];
				if (
					userInfo &&
					userInfo.accountCountry &&
					config.blockedCountries.has(userInfo.accountCountry)
				)
					reason = reason
						? `${reason}+Country`
						: `Country:${userInfo.accountCountry}`;
				if (
					!userInfo ||
					(!userInfo.accountCountry &&
						(!userInfo.ts || nowTs() - userInfo.ts >= UNKNOWN_RETRY_MS))
				) {
					queueUser(userKey);
				}
				if (reason) hide(tweet, reason);
			});
	}

	function processQueue() {
		const now = nowTs();
		if (now < nextFetchAllowed) return;
		let processed = 0;
		while (fetchQueue.length && processed < PREFETCH_BATCH) {
			const user = fetchQueue.shift();
			if (!needsFetch(user)) continue;
			const started = fetchCountry(user);
			if (!started) {
				// Put it back and wait for the next tick if throttled
				if (!config.pending.has(user)) fetchQueue.unshift(user);
				break;
			}
			processed += 1;
		}
	}

	// Sync removed: keep everything local only.

	function injectUI() {
		if (document.getElementById("xcb-button")) return;
		const btn = document.createElement("div");
		btn.id = "xcb-button";
		btn.innerHTML = "⚙";
		btn.title = "Blocker Settings";
		btn.style =
			"position:fixed;bottom:20px;left:20px;width:52px;height:52px;background:#1d9bf0;color:#fff;border-radius:50%;font-size:26px;line-height:52px;text-align:center;display:flex;align-items:center;justify-content:center;cursor:pointer;z-index:2147483647;box-shadow:0 6px 18px rgba(0,0,0,0.35);user-select:none;";
		btn.tabIndex = 0;
		document.body.appendChild(btn);

		const modal = document.createElement("div");
		modal.id = "xcb-modal";
		modal.style =
			"display:none;position:fixed;inset:0;background:rgba(0,0,0,0.7);z-index:10000;align-items:center;justify-content:center;";
		modal.innerHTML = `<div style="background:#15202b;color:#fff;padding:20px;border-radius:12px;max-width:480px;width:92%;max-height:90vh;overflow:auto;box-shadow:0 10px 30px rgba(0,0,0,0.35);">
            <h2 style="margin:0 0 16px;text-align:center;">X Country & Language Blocker</h2>
            <div style="font-size:13px;color:#aab8c2;margin-bottom:12px;text-align:center;">Add countries or language scripts to hide matching posts. Session counts shown per filter.</div>
            <strong>Countries</strong><div id="list-c" style="max-height:200px;overflow:auto;margin:8px 0;padding:8px;background:#0002;border-radius:8px;"></div>
            <input id="add-c" placeholder="Add country (e.g. Israel or IL)" style="width:100%;padding:8px;margin:8px 0;border-radius:8px;">
            <strong>Languages</strong><div id="list-l" style="max-height:200px;overflow:auto;margin:8px 0;padding:8px;background:#0002;border-radius:8px;"></div>
            <input id="add-l" placeholder="Add language (e.g. ar)" style="width:100%;padding:8px;margin:8px 0;border-radius:8px;">
            <div id="xcb-blocked-count" style="margin:8px 0;font-size:13px;color:#d9d9d9;">Blocked this session: 0</div>
            <button id="export-db" style="width:100%;padding:10px;background:#273340;border:none;border-radius:8px;color:#fff;margin-top:12px;cursor:pointer;">Export DB (JSON)</button>
            <button id="close" style="width:100%;padding:10px;background:#1d9bf0;border:none;border-radius:8px;color:#fff;margin-top:12px;cursor:pointer;">Close</button>
        </div>`;
		document.body.appendChild(modal);

		const statusLine = document.createElement("div");
		statusLine.id = "xcb-status";
		statusLine.style = "margin-top:8px;font-size:12px;color:#aab8c2;";
		modal.querySelector("div").appendChild(statusLine);

		const updateBlockedDisplay = () => {
			const counterEl = document.getElementById("xcb-blocked-count");
			if (counterEl)
				counterEl.textContent = `Blocked this session: ${blockedCount}`;
		};
		updateBlockedDisplay();

		const setStatus = (msg) => {
			statusLine.textContent = msg || "";
		};

		const refreshList = () => {
			const countryList = document.getElementById("list-c");
			countryList.innerHTML = "";
			Array.from(config.blockedCountries)
				.sort()
				.forEach((c) => {
					const row = document.createElement("div");
					row.id = `xcb-c-${c}`;
					row.style.display = "flex";
					row.style.justifyContent = "space-between";
					row.style.padding = "4px 0";
					row.innerHTML = `<span>${c} <span class="xcb-count" style="color:#aab8c2;">(${blockStats.country[c] || 0})</span></span><span style="cursor:pointer;color:#f00;">×</span>`;
					row.lastChild.addEventListener("click", () => {
						config.blockedCountries.delete(c);
						save();
						refreshList();
						scanAndHide();
						setStatus(`Removed country ${c}`);
					});
					countryList.appendChild(row);
				});

			const langList = document.getElementById("list-l");
			langList.innerHTML = "";
			Array.from(config.blockedLangs)
				.sort()
				.forEach((l) => {
					const row = document.createElement("div");
					row.id = `xcb-l-${l}`;
					row.style.display = "flex";
					row.style.justifyContent = "space-between";
					row.style.padding = "4px 0";
					row.innerHTML = `<span>${l} <span class="xcb-count" style="color:#aab8c2;">(${blockStats.lang[l] || 0})</span></span><span style="cursor:pointer;color:#f00;">×</span>`;
					row.lastChild.addEventListener("click", () => {
						config.blockedLangs.delete(l);
						save();
						refreshList();
						scanAndHide();
						setStatus(`Removed language ${l}`);
					});
					langList.appendChild(row);
				});
		};

		const openModal = () => {
			modal.style.display = "flex";
			refreshList();
			updateBlockedDisplay();
		};
		const closeModal = () => (modal.style.display = "none");

		btn.onclick = (e) => {
			e.stopPropagation();
			openModal();
		};
		btn.onkeydown = (e) => {
			if (e.key === "Enter" || e.key === " ") {
				e.preventDefault();
				openModal();
			}
		};
		modal.addEventListener("click", (e) => {
			if (e.target === modal) closeModal();
		});
		document.addEventListener("keydown", (e) => {
			if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "b") {
				e.preventDefault();
				openModal();
			}
			if (e.key === "Escape") closeModal();
		});
		document.getElementById("close").onclick = () => closeModal();
		document.getElementById("export-db").onclick = () => {
			setStatus("DB exported to console");
			console.log("XCB DB", exportDB());
		};
		document.getElementById("add-c").onkeydown = (e) => {
			if (e.key === "Enter") {
				const v = e.target.value.trim();
				const code = resolveCountryCode(v);
				if (!code) {
					setStatus(
						`Could not resolve "${v}". Try a 2-letter code or country name.`,
					);
					return;
				}
				config.blockedCountries.add(code);
				save();
				refreshList();
				scanAndHide();
				setStatus(`Added country ${code}`);
				e.target.value = "";
			}
		};
		document.getElementById("add-l").onkeydown = (e) => {
			if (e.key === "Enter") {
				const v = e.target.value.trim().toLowerCase();
				if (v) {
					config.blockedLangs.add(v);
					save();
					refreshList();
					scanAndHide();
					setStatus(`Added language ${v}`);
					e.target.value = "";
				}
			}
		};
	}

	function start() {
		const target = document.body || document.documentElement;
		if (!target) {
			document.addEventListener("DOMContentLoaded", start, { once: true });
			return;
		}
		const observer = new MutationObserver(() => {
			safeScan();
		});
		observer.observe(target, { childList: true, subtree: true });
		setInterval(safeScan, 4000);
		setInterval(processQueue, PREFETCH_INTERVAL_MS);
		setTimeout(() => {
			safeScan();
			processQueue();
			injectUI();
		}, 1500);
	}

	function safeScan() {
		try {
			scanAndHide();
		} catch (e) {
			console.error("scan error", e);
		}
	}

	loadKnownFromDB().finally(() => start());

	console.log(
		"X Country Blocker v5.1 (CLEAN) ready — nothing blocked until you add it",
	);
})();
