(function () {
	"use strict";

	if (!/^https?:\/\/(x|twitter)\.com\//.test(window.location.href)) return;

	const STORAGE_KEY = "xCountryBlocker";
	const defaultTotals = () => ({
		overall: 0,
		country: {},
		lang: {},
		region: {},
		session: 0,
	});
	let config = {
		blockedCountries: new Set(), // ← EMPTY
		blockedLangs: new Set(), // ← EMPTY
		blockedRegions: new Set(), // ← EMPTY
		countryDB: {}, // code -> [usernames]
		knownUsers: {}, // username -> { accountCountry, accountRegion, usernameChanges, ts }
		pending: new Set(),
		filterMode: "block", // "block" | "highlight"
		filterTotals: defaultTotals(),
		highlightRegionDisplayOnly: false,
	};
	const fetchQueue = [];

	const nowTs = () => Date.now();
	let filteredCount = 0;
	let totalsSaveTimer = null;
	let nextFetchAllowed = 0;
	const FETCH_GAP_MS = 3500; // throttle outbound requests
	const RATE_LIMIT_BACKOFF_MS = 2 * 60 * 1000; // back off 2 minutes on 429
	const UNKNOWN_RETRY_MS = 10 * 60 * 1000; // retry unknowns after 10m
	const PREFETCH_BATCH = 5;
	const PREFETCH_INTERVAL_MS = 4000;
	const blockStats = { country: {}, lang: {}, region: {} }; // session-only counts
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

	const REGION_DEFS = [
		{
			name: "Africa",
			codes: [
				"DZ",
				"AO",
				"BJ",
				"BW",
				"BF",
				"BI",
				"CM",
				"CV",
				"CF",
				"TD",
				"KM",
				"CG",
				"CD",
				"DJ",
				"EG",
				"GQ",
				"ER",
				"ET",
				"GA",
				"GM",
				"GH",
				"GN",
				"GW",
				"CI",
				"KE",
				"LS",
				"LR",
				"LY",
				"MG",
				"MW",
				"ML",
				"MR",
				"MU",
				"MA",
				"MZ",
				"NA",
				"NE",
				"NG",
				"RE",
				"RW",
				"ST",
				"SN",
				"SC",
				"SL",
				"SO",
				"ZA",
				"SS",
				"SD",
				"SZ",
				"TZ",
				"TG",
				"TN",
				"UG",
				"YT",
				"ZM",
				"ZW",
			],
		},
		{
			name: "Middle East and North Africa",
			codes: [
				"IR",
				"IQ",
				"IL",
				"JO",
				"LB",
				"SA",
				"AE",
				"QA",
				"BH",
				"KW",
				"EG",
				"MA",
				"DZ",
				"TN",
				"LY",
				"TR",
				"OM",
				"YE",
				"SY",
				"PS",
			],
		},
		{
			name: "South Asia",
			codes: ["IN", "PK", "BD", "LK", "NP", "AF", "MV", "BT"],
		},
		{
			name: "Southeast Asia",
			codes: ["SG", "TH", "VN", "MY", "ID", "PH", "KH", "LA", "MM", "BN"],
		},
		{
			name: "East Asia and Pacific",
			codes: [
				"CN",
				"JP",
				"KR",
				"TW",
				"PH",
				"ID",
				"TH",
				"VN",
				"MY",
				"SG",
				"AU",
				"NZ",
				"HK",
				"MO",
				"PG",
				"FJ",
			],
		},
		{
			name: "Latin America",
			codes: [
				"MX",
				"BR",
				"AR",
				"CL",
				"CO",
				"PE",
				"VE",
				"UY",
				"PY",
				"BO",
				"CR",
				"PA",
				"DO",
				"HN",
				"GT",
				"SV",
				"CU",
				"EC",
				"PR",
				"JM",
				"TT",
				"NI",
			],
		},
		{
			name: "South America",
			codes: ["AR", "BR", "CL", "CO", "PE", "VE", "UY", "PY", "BO", "EC", "GY", "SR"],
		},
		{
			name: "Eastern Europe",
			codes: [
				"RU",
				"UA",
				"LV",
				"RO",
				"PL",
				"HU",
				"BG",
				"CZ",
				"SK",
				"SI",
				"RS",
				"HR",
				"BA",
				"BY",
				"LT",
				"EE",
				"MD",
				"GE",
			],
		},
		{
			name: "Western Europe",
			codes: [
				"GB",
				"FR",
				"DE",
				"ES",
				"PT",
				"IT",
				"NL",
				"BE",
				"CH",
				"AT",
				"IE",
				"NO",
				"SE",
				"DK",
				"FI",
				"LU",
				"GR",
			],
		},
		{
			name: "Europe",
			codes: [
				"GB",
				"FR",
				"DE",
				"ES",
				"PT",
				"IT",
				"NL",
				"BE",
				"CH",
				"AT",
				"IE",
				"NO",
				"SE",
				"DK",
				"FI",
				"LU",
				"CZ",
				"PL",
				"HU",
				"RO",
				"BG",
				"RS",
				"HR",
				"SI",
				"SK",
				"UA",
				"LT",
				"LV",
				"EE",
				"GR",
				"MD",
				"GE",
			],
		},
		{
			name: "North America",
			codes: ["US", "CA", "MX"],
		},
	];

	function load() {
		const saved = localStorage.getItem(STORAGE_KEY);
		if (saved) {
			const parsed = JSON.parse(saved);
			config.blockedCountries = new Set(parsed.blockedCountries || []);
			config.blockedLangs = new Set(parsed.blockedLangs || []);
			config.blockedRegions = new Set(parsed.blockedRegions || []);
			config.countryDB = parsed.countryDB || {};
			config.filterMode =
				parsed.filterMode === "highlight" ? "highlight" : "block";
			config.filterTotals = {
				...defaultTotals(),
				...(parsed.filterTotals || {}),
			};
			config.highlightRegionDisplayOnly = Boolean(
				parsed.highlightRegionDisplayOnly,
			);
			if (parsed.knownUsers) {
				config.knownUsers = {};
				for (const [k, v] of Object.entries(parsed.knownUsers)) {
					config.knownUsers[k] = {
						accountCountry: v.accountCountry || null,
						accountRegion: v.accountRegion || null,
						usernameChanges:
							typeof v.usernameChanges === "number"
								? v.usernameChanges
								: null,
						ts: v.ts || 0,
					};
				}
			}
		}
	}
	function save() {
		localStorage.setItem(
			STORAGE_KEY,
			JSON.stringify({
				blockedCountries: Array.from(config.blockedCountries),
				blockedLangs: Array.from(config.blockedLangs),
				blockedRegions: Array.from(config.blockedRegions),
				countryDB: config.countryDB,
				filterMode: config.filterMode,
				filterTotals: config.filterTotals,
				highlightRegionDisplayOnly: config.highlightRegionDisplayOnly,
			}),
		);
	}

	function exportDB() {
		return JSON.stringify(
			{
				countryDB: config.countryDB,
				knownUsers: config.knownUsers,
				filterTotals: config.filterTotals,
				highlightRegionDisplayOnly: config.highlightRegionDisplayOnly,
			},
			null,
			2,
		);
	}

	function openDB() {
		if (dbPromise) return dbPromise;
		dbPromise = new Promise((resolve, reject) => {
			const req = indexedDB.open("xcb-country-blocker", 2);
			req.onerror = () => reject(req.error);
			req.onupgradeneeded = () => {
				const db = req.result;
				if (!db.objectStoreNames.contains("known")) {
					db.createObjectStore("known", { keyPath: "user" });
				}
				if (!db.objectStoreNames.contains("stats")) {
					db.createObjectStore("stats", { keyPath: "id" });
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
					accountRegion: row.accountRegion || null,
					usernameChanges:
						typeof row.usernameChanges === "number"
							? row.usernameChanges
							: null,
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
				accountRegion: data.accountRegion || null,
				usernameChanges:
					typeof data.usernameChanges === "number"
						? data.usernameChanges
						: null,
				ts: data.ts || nowTs(),
			});
		} catch (e) {
			console.warn("[XCB] saveKnownToDB failed", e);
		}
	}

	async function loadTotalsFromDB() {
		try {
			const db = await openDB();
			const tx = db.transaction("stats", "readonly");
			const store = tx.objectStore("stats");
			const totals = await new Promise((resolve, reject) => {
				const req = store.get("totals");
				req.onsuccess = () => resolve(req.result || null);
				req.onerror = () => reject(req.error);
			});
			if (totals) {
				config.filterTotals = {
					overall: totals.overall || 0,
					country: totals.country || {},
					lang: totals.lang || {},
					region: totals.region || {},
					session: totals.session || 0,
				};
				filteredCount = totals.session || 0;
			}
		} catch (e) {
			console.warn("[XCB] loadTotalsFromDB failed", e);
		} finally {
			if (!config.filterTotals) config.filterTotals = defaultTotals();
		}
	}

	async function saveTotalsToDB() {
		try {
			const db = await openDB();
			const tx = db.transaction("stats", "readwrite");
			tx.objectStore("stats").put({
				id: "totals",
				overall: config.filterTotals.overall || 0,
				country: config.filterTotals.country || {},
				lang: config.filterTotals.lang || {},
				region: config.filterTotals.region || {},
				session: filteredCount,
				updated: nowTs(),
			});
		} catch (e) {
			console.warn("[XCB] saveTotalsToDB failed", e);
		}
	}

	function scheduleTotalsSave() {
		if (totalsSaveTimer) return;
		totalsSaveTimer = setTimeout(() => {
			totalsSaveTimer = null;
			config.filterTotals.session = filteredCount;
			save();
			saveTotalsToDB();
		}, 1000);
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

	function countryCodeToFlag(code) {
		if (!code || typeof code !== "string" || code.length !== 2) return "";
		const upper = code.toUpperCase();
		const a = upper.charCodeAt(0) - 65 + 0x1f1e6;
		const b = upper.charCodeAt(1) - 65 + 0x1f1e6;
		if (a < 0x1f1e6 || b < 0x1f1e6) return "";
		return String.fromCodePoint(a, b);
	}

	function regionFromCountry(code) {
		if (!code) return null;
		const upper = code.toUpperCase();
		for (const def of REGION_DEFS) {
			if (def.codes.includes(upper)) return def.name;
		}
		return null;
	}

	function resolveRegionName(input) {
		if (!input) return null;
		const norm = input.trim().toLowerCase();
		if (!norm) return null;
		const found = REGION_DEFS.find(
			(def) => def.name.toLowerCase() === norm,
		);
		if (found) return found.name;
		return null;
	}

	function renderFlag(tweet, countryCode) {
		// Feature disabled: keep cleanup only
		const flagWrapId = tweet.dataset.xcbFlagId;
		if (flagWrapId) {
			const existing = document.getElementById(flagWrapId);
			if (existing) existing.remove();
			delete tweet.dataset.xcbFlagId;
		}
		return;
	}

	function addFlagOverlay(tweet, countryCode) {
		if (!countryCode) return;
		const flag = countryCodeToFlag(countryCode);
		if (!flag) return;
		const existingId = tweet.dataset.xcbOverlayId;
		if (existingId) {
			const existing = document.getElementById(existingId);
			if (existing) existing.remove();
			delete tweet.dataset.xcbOverlayId;
		}
		const overlay = document.createElement("div");
		const id = `xcb-overlay-${Math.random().toString(36).slice(2, 9)}`;
		overlay.id = id;
		overlay.textContent = flag;
		overlay.style =
			"position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-size:96px;opacity:0.08;pointer-events:none;user-select:none;filter:saturate(0.9);z-index:1;";
		tweet.appendChild(overlay);
		tweet.dataset.xcbOverlayId = id;
	}

	function renderFooterInfo(tweet, countryCode, usernameChanges) {
		const rowId = tweet.dataset.xcbFooterId;
		const hasCountry = Boolean(countryCode);
		const hasChanges = Number.isFinite(usernameChanges);
		if (!hasCountry && !hasChanges) {
			if (rowId) {
				const existing = document.getElementById(rowId);
				if (existing) existing.remove();
				delete tweet.dataset.xcbFooterId;
				delete tweet.dataset.xcbFooterContent;
			}
			return;
		}
		const parts = [];
		if (hasCountry) {
			const flag = countryCodeToFlag(countryCode) || countryCode;
			parts.push(`Country: ${flag} ${countryCode}`);
		}
		if (hasChanges) {
			parts.push(`Username changes: ${usernameChanges}`);
		}
		const content = parts.join(" · ");
		if (!content) return;
		if (tweet.dataset.xcbFooterContent === content && rowId) {
			const existing = document.getElementById(rowId);
			if (existing) return;
		}
		const replyBtn = tweet.querySelector('[data-testid="reply"]');
		const actionGroup = replyBtn?.closest('div[role="group"]');
		const actionWrapper = actionGroup?.parentElement || actionGroup || tweet;
		let row = rowId ? document.getElementById(rowId) : null;
		if (!row) {
			row = document.createElement("div");
			const id = `xcb-footer-${Math.random().toString(36).slice(2, 9)}`;
			row.id = id;
			row.style =
				"display:flex;flex-wrap:wrap;gap:12px;padding:6px 12px 4px;margin-top:2px;font-size:12px;color:rgb(170,184,194);";
			tweet.dataset.xcbFooterId = id;
		}
		if (row.textContent !== content) row.textContent = content;
		tweet.dataset.xcbFooterContent = content;
		if (row.parentNode !== actionWrapper) {
			if (actionGroup && actionGroup.parentNode === actionWrapper) {
				actionWrapper.insertBefore(row, actionGroup.nextSibling);
			} else {
				actionWrapper.appendChild(row);
			}
		}
	}

	function updateFilteredDisplay() {
		const counterEl = document.getElementById("xcb-blocked-count");
		if (counterEl)
			counterEl.textContent = `Filtered this session: ${filteredCount} (${config.filterMode === "highlight" ? "highlight" : "block"}) | Total: ${
				config.filterTotals?.overall || 0
			}`;
	}

	function clearFilterMark(tweet) {
		const noteId = tweet.dataset.xcbNoteId;
		if (noteId) {
			const noteEl = document.getElementById(noteId);
			if (noteEl) noteEl.remove();
		}
		const badgeId = tweet.dataset.xcbBadgeId;
		if (badgeId) {
			const badgeEl = document.getElementById(badgeId);
			if (badgeEl) badgeEl.remove();
		}
		if (tweet.dataset.xcbPrevDisplay !== undefined) {
			tweet.style.display = tweet.dataset.xcbPrevDisplay;
			delete tweet.dataset.xcbPrevDisplay;
		} else if (tweet.dataset.xcbMode === "block") {
			tweet.style.removeProperty("display");
		}
		if (tweet.dataset.xcbPrevPosition !== undefined) {
			tweet.style.position = tweet.dataset.xcbPrevPosition;
			delete tweet.dataset.xcbPrevPosition;
		}
		const overlayId = tweet.dataset.xcbOverlayId;
		if (overlayId) {
			const overlayEl = document.getElementById(overlayId);
			if (overlayEl) overlayEl.remove();
			delete tweet.dataset.xcbOverlayId;
		}
		tweet.style.removeProperty("outline");
		tweet.style.removeProperty("outline-offset");
		tweet.style.removeProperty("box-shadow");
		tweet.style.removeProperty("background-color");
		delete tweet.dataset.xcbMode;
		delete tweet.dataset.xcbReason;
		delete tweet.dataset.blocked;
		delete tweet.dataset.xcbNoteId;
		delete tweet.dataset.xcbBadgeId;
	}

	function markBlocked(tweet, reason) {
		tweet.dataset.blocked = "1";
		tweet.dataset.xcbMode = "block";
		tweet.dataset.xcbReason = reason;
		tweet.dataset.xcbPrevDisplay = tweet.style.display || "";
		tweet.style.setProperty("display", "none", "important");
		const box = document.createElement("div");
		const noteId = `xcb-note-${Math.random().toString(36).slice(2, 9)}`;
		box.id = noteId;
		box.textContent = `Blocked: ${reason}`;
		box.style =
			"background:#000;color:#fff;padding:4px 8px;font-size:11px;border-radius:4px;margin:8px 0;";
		tweet.parentNode?.insertBefore(box, tweet);
		tweet.dataset.xcbNoteId = noteId;
		console.log("Blocked:", reason);
	}

	function markHighlighted(tweet, reason, countryCode) {
		tweet.dataset.xcbMode = "highlight";
		tweet.dataset.xcbReason = reason;
		const flag = countryCodeToFlag(countryCode);
		const displayText = flag
			? `${flag} ${countryCode || ""}`
			: reason.replace(/\+/g, " + ");
		const currentPos = getComputedStyle(tweet).position;
		if (currentPos === "static") {
			tweet.dataset.xcbPrevPosition = tweet.style.position || "";
			tweet.style.position = "relative";
		}
		tweet.style.setProperty("outline", "3px solid #ff4d4f", "important");
		tweet.style.setProperty("outline-offset", "2px", "important");
		tweet.style.setProperty(
			"box-shadow",
			"0 0 0 3px rgba(255,77,79,0.35)",
			"important",
		);
		tweet.style.setProperty("background-color", "rgba(255,77,79,0.12)", "important");

		const badge = document.createElement("div");
		const badgeId = `xcb-badge-${Math.random().toString(36).slice(2, 9)}`;
		badge.id = badgeId;
		badge.textContent = displayText;
		badge.style =
			"position:absolute;top:-10px;left:-10px;background:#ff4d4f;color:#fff;padding:6px 10px;border-radius:10px;font-size:12px;font-weight:bold;box-shadow:0 4px 12px rgba(0,0,0,0.25);z-index:2;";
		tweet.appendChild(badge);
		tweet.dataset.xcbBadgeId = badgeId;
		addFlagOverlay(tweet, countryCode);
	}

	function markRegionOnlyHighlight(tweet, regionName) {
		if (tweet.dataset.xcbMode === "region-only") return;
		clearFilterMark(tweet);
		const currentPos = getComputedStyle(tweet).position;
		if (currentPos === "static") {
			tweet.dataset.xcbPrevPosition = tweet.style.position || "";
			tweet.style.position = "relative";
		}
		tweet.dataset.xcbMode = "region-only";
		tweet.dataset.xcbReason = `RegionOnly:${regionName}`;
		tweet.style.setProperty("outline", "3px solid #f5c400", "important");
		tweet.style.setProperty("outline-offset", "2px", "important");
		tweet.style.setProperty(
			"box-shadow",
			"0 0 0 3px rgba(245,196,0,0.35)",
			"important",
		);
		tweet.style.setProperty("background-color", "rgba(245,196,0,0.12)", "important");

		const badge = document.createElement("div");
		const badgeId = `xcb-badge-${Math.random().toString(36).slice(2, 9)}`;
		badge.id = badgeId;
		badge.textContent = `Region-only: ${regionName}`;
		badge.style =
			"position:absolute;top:-10px;left:-10px;background:#f5c400;color:#1c1c1c;padding:6px 10px;border-radius:10px;font-size:12px;font-weight:bold;box-shadow:0 4px 12px rgba(0,0,0,0.25);z-index:2;";
		tweet.appendChild(badge);
		tweet.dataset.xcbBadgeId = badgeId;
	}

	function bumpCounts({ countryCode, lang }) {
		config.filterTotals = config.filterTotals || defaultTotals();
		if (countryCode) {
			blockStats.country[countryCode] =
				(blockStats.country[countryCode] || 0) + 1;
			config.filterTotals.country[countryCode] =
				(config.filterTotals.country[countryCode] || 0) + 1;
		}
		if (lang) {
			blockStats.lang[lang] = (blockStats.lang[lang] || 0) + 1;
			config.filterTotals.lang[lang] =
				(config.filterTotals.lang[lang] || 0) + 1;
		}
		if (arguments[0]?.region) {
			const region = arguments[0].region;
			blockStats.region[region] = (blockStats.region[region] || 0) + 1;
			config.filterTotals.region[region] =
				(config.filterTotals.region[region] || 0) + 1;
		}
		config.filterTotals.overall = (config.filterTotals.overall || 0) + 1;
		config.filterTotals.session = filteredCount;
	}

	function applyFilterAction(tweet, info) {
		const reason = info?.reason;
		const countryCode = info?.countryCode;
		const lang = info?.lang || null;
		const region = info?.region || null;
		const mode = config.filterMode === "highlight" ? "highlight" : "block";
		const prevMode = tweet.dataset.xcbMode;
		const prevReason = tweet.dataset.xcbReason;
		if (prevMode === mode && prevReason === reason) return;

		clearFilterMark(tweet);
		if (!reason) return;

		if (!tweet.dataset.xcbCounted) {
			filteredCount += 1;
			tweet.dataset.xcbCounted = "1";
			bumpCounts({ countryCode, lang, region });
			updateFilteredDisplay();
			scheduleTotalsSave();
		}

		if (mode === "highlight") {
			markHighlighted(tweet, reason, countryCode);
			return;
		}
		markBlocked(tweet, reason);
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
		const accountRegionRaw =
			about?.accountRegion ||
			about?.account_region ||
			aboutProfile?.account_region ||
			aboutProfile?.accountRegion ||
			null;
		const usernameChangesRaw =
			aboutProfile?.usernameChangeCount ||
			aboutProfile?.username_changes ||
			aboutProfile?.screen_name_change_count ||
			about?.usernameChangeCount ||
			about?.username_changes ||
			about?.screen_name_change_count ||
			result.legacy?.screen_name_change_count ||
			null;

		const accountCountry = accountCountryRaw
			? COUNTRY_MAP[accountCountryRaw] ||
				accountCountryRaw.slice(0, 2).toUpperCase()
			: null;
		const accountRegion =
			typeof accountRegionRaw === "string" && accountRegionRaw.trim()
				? accountRegionRaw.trim()
				: null;
		const usernameChanges =
			typeof usernameChangesRaw === "number"
				? usernameChangesRaw
				: Number.isFinite(Number(usernameChangesRaw))
					? Number(usernameChangesRaw)
					: null;

		return { accountCountry, accountRegion, usernameChanges };
	}

	function getCsrfToken() {
		const match = document.cookie.match(/(?:^|; )ct0=([^;]+)/);
		return match ? match[1] : "";
	}

	function needsFetch(user) {
		if (!user) return false;
		if (
			config.blockedCountries.size === 0 &&
			config.blockedLangs.size === 0 &&
			config.blockedRegions.size === 0 &&
			!config.highlightRegionDisplayOnly
		)
			return false;
		const known = config.knownUsers[user];
		if (!known) return true;
		if (known.accountCountry) return false;
		if (known.accountRegion) {
			if (known.ts && nowTs() - known.ts < UNKNOWN_RETRY_MS) return false;
			return true;
		}
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
		if (
			config.blockedCountries.size === 0 &&
			config.blockedLangs.size === 0 &&
			config.blockedRegions.size === 0 &&
			!config.highlightRegionDisplayOnly
		)
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
				if (!info.accountCountry && !info.accountRegion) {
					config.knownUsers[user] = {
						accountCountry: null,
						accountRegion: info.accountRegion || null,
						usernameChanges: info.usernameChanges ?? null,
						ts: nowTs(),
					};
					save();
					return;
				}
				config.knownUsers[user] = {
					accountCountry: info.accountCountry || null,
					accountRegion: info.accountRegion || null,
					usernameChanges: info.usernameChanges ?? null,
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
				const userKey = extractUsername(tweet);
				if (!userKey) return;

				const text =
					tweet.querySelector('[data-testid="tweetText"]')?.textContent ||
					tweet.innerText ||
					"";
				const langMatch = hasBlockedLang(text);
				let reason = langMatch ? `Lang:${langMatch}` : "";
				const userInfo = config.knownUsers[userKey];
				const accountCountry = userInfo?.accountCountry || null;
				let countryCode = null;
				let regionName =
					userInfo?.accountRegion ||
					(userInfo?.accountCountry
						? regionFromCountry(userInfo.accountCountry)
						: null);
				if (userInfo?.accountRegion && !regionName)
					regionName = userInfo.accountRegion;
				if (
					userInfo &&
					accountCountry &&
					config.blockedCountries.has(accountCountry)
				) {
					countryCode = accountCountry;
					reason = reason
						? `${reason}+Country`
						: `Country:${accountCountry}`;
				}
				if (regionName && config.blockedRegions.has(regionName)) {
					reason = reason ? `${reason}+Region` : `Region:${regionName}`;
				}
				if (
					!userInfo ||
					(!userInfo.accountCountry &&
						(!userInfo.ts || nowTs() - userInfo.ts >= UNKNOWN_RETRY_MS))
				) {
					queueUser(userKey);
				}
				renderFlag(tweet, accountCountry || null);
				renderFooterInfo(tweet, accountCountry || null, userInfo?.usernameChanges);
				if (!reason && (tweet.dataset.xcbMode || tweet.dataset.blocked)) {
					clearFilterMark(tweet);
				}
				if (
					!reason &&
					config.highlightRegionDisplayOnly &&
					userInfo?.accountRegion &&
					!userInfo.accountCountry
				) {
					markRegionOnlyHighlight(tweet, regionName || userInfo.accountRegion);
					return;
				}
				if (reason)
					applyFilterAction(tweet, {
						reason,
						countryCode,
						lang: langMatch,
						region: config.blockedRegions.has(regionName || "")
							? regionName || null
							: null,
					});
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

	function ensureSidebarButton(openModal) {
		const existing = document.getElementById("xcb-button");
		const nav = document.querySelector('nav[aria-label="Primary"]');
		if (!nav) return false;
		const homeLink = nav.querySelector('a[aria-label="Home"]');
		const profileLink = nav.querySelector('a[aria-label="Profile"]');
		const moreEntry =
			nav.querySelector('[aria-label="More menu items"]') ||
			nav.querySelector('[aria-label="More"]') ||
			nav.querySelector('[data-testid="AppTabBar_More_Menu"]');
		const anchorRef = moreEntry || profileLink || homeLink;
		if (!anchorRef) return false;
		const parent = (anchorRef.closest("a, div, button") || anchorRef).parentElement || nav;
		if (!parent) return false;
		const btn = existing || document.createElement("a");
		btn.id = "xcb-button";
		btn.setAttribute("role", "button");
		btn.href = "javascript:void(0)";
		btn.innerHTML =
			'<span class="xcb-icon" style="font-size:22px;line-height:22px;color:#fff;">🚫</span><span class="xcb-label" style="font-size:18px;font-weight:700;">CleanX</span>';
		btn.style =
			"display:flex;align-items:center;gap:14px;padding:12px;border-radius:9999px;color:#e7e9ea;text-decoration:none;font-size:17px;font-weight:700;cursor:pointer;max-width:260px;min-width:52px;box-sizing:border-box;";
		btn.onmouseenter = () => {
			btn.style.backgroundColor = "rgba(255,255,255,0.08)";
		};
		btn.onmouseleave = () => {
			btn.style.backgroundColor = "transparent";
		};
		btn.onclick = (e) => {
			e.preventDefault();
			e.stopPropagation();
			openModal();
		};
		btn.onkeydown = (e) => {
			if (e.key === "Enter" || e.key === " ") {
				e.preventDefault();
				openModal();
			}
		};
		const label = btn.querySelector(".xcb-label");
		if (label) {
			label.style.display =
				(nav.getBoundingClientRect().width || 0) > 80 ? "inline" : "none";
		}
		if (btn.parentElement !== parent) {
			if (moreEntry && moreEntry.parentElement === parent) {
				parent.insertBefore(btn, moreEntry);
			} else if (profileLink && profileLink.parentElement === parent) {
				parent.insertBefore(btn, profileLink.nextSibling);
			} else if (homeLink && homeLink.parentElement === parent) {
				parent.insertBefore(btn, homeLink.nextSibling);
			} else {
				parent.appendChild(btn);
			}
		}
		return true;
	}

	function injectUI() {
		if (document.getElementById("xcb-modal")) return;
		const modal = document.createElement("div");
		modal.id = "xcb-modal";
		modal.style =
			"display:none;position:fixed;inset:0;background:rgba(0,0,0,0.7);z-index:10000;align-items:center;justify-content:center;";
		modal.innerHTML = `<div style="background:#15202b;color:#fff;padding:20px;border-radius:12px;max-width:480px;width:92%;max-height:90vh;overflow:auto;box-shadow:0 10px 30px rgba(0,0,0,0.35);">
            <h2 style="margin:0 0 16px;text-align:center;">X Country & Language Blocker</h2>
            <div style="font-size:13px;color:#aab8c2;margin-bottom:12px;text-align:center;">Add countries or language scripts to hide or highlight matching posts. Counts show S: this session, T: total (saved).</div>
            <div style="margin:10px 0 14px;">
              <strong>Filtered post behavior</strong>
              <div id="xcb-mode-row" style="display:flex;gap:12px;flex-wrap:wrap;margin-top:6px;font-size:13px;">
                <label style="display:flex;align-items:center;gap:6px;cursor:pointer;"><input type="radio" name="xcb-mode" value="block" style="transform:scale(1.1);"> Block (hide)</label>
                <label style="display:flex;align-items:center;gap:6px;cursor:pointer;"><input type="radio" name="xcb-mode" value="highlight" style="transform:scale(1.1);"> Highlight with flag</label>
              </div>
            </div>
            <strong>Countries</strong><div id="list-c" style="max-height:200px;overflow:auto;margin:8px 0;padding:8px;background:#0002;border-radius:8px;"></div>
            <input id="add-c" placeholder="Add country (e.g. Israel or IL)" style="width:100%;padding:8px;margin:8px 0;border-radius:8px;">
            <strong>Regions</strong><div id="list-r" style="max-height:200px;overflow:auto;margin:8px 0;padding:8px;background:#0002;border-radius:8px;"></div>
            <input id="add-r" placeholder="Add region (e.g. Middle East and North Africa)" style="width:100%;padding:8px;margin:8px 0;border-radius:8px;">
            <strong>Languages</strong><div id="list-l" style="max-height:200px;overflow:auto;margin:8px 0;padding:8px;background:#0002;border-radius:8px;"></div>
            <input id="add-l" placeholder="Add language (e.g. ar)" style="width:100%;padding:8px;margin:8px 0;border-radius:8px;">
            <div id="xcb-blocked-count" style="margin:8px 0;font-size:13px;color:#d9d9d9;">Filtered this session: 0</div>
            <label style="display:flex;align-items:center;gap:8px;font-size:13px;margin:6px 0;"><input type="checkbox" id="xcb-highlight-region-only"> Highlight accounts showing region-only (yellow)</label>
            <button id="export-db" style="width:100%;padding:10px;background:#273340;border:none;border-radius:8px;color:#fff;margin-top:12px;cursor:pointer;">Export DB (JSON)</button>
            <button id="close" style="width:100%;padding:10px;background:#1d9bf0;border:none;border-radius:8px;color:#fff;margin-top:12px;cursor:pointer;">Close</button>
        </div>`;
		document.body.appendChild(modal);

		const statusLine = document.createElement("div");
		statusLine.id = "xcb-status";
		statusLine.style = "margin-top:8px;font-size:12px;color:#aab8c2;";
		modal.querySelector("div").appendChild(statusLine);

		updateFilteredDisplay();

		const setStatus = (msg) => {
			statusLine.textContent = msg || "";
		};

		modal
			.querySelectorAll('input[name="xcb-mode"]')
			.forEach((input) => {
				input.checked =
					input.value ===
					(config.filterMode === "highlight" ? "highlight" : "block");
				input.addEventListener("change", () => {
					if (!input.checked) return;
					config.filterMode =
						input.value === "highlight" ? "highlight" : "block";
					save();
					setStatus(
						config.filterMode === "highlight"
							? "Highlighting filtered posts with flags"
							: "Blocking filtered posts",
					);
					document
						.querySelectorAll('article[data-testid="tweet"]')
						.forEach((t) => clearFilterMark(t));
					safeScan();
					updateFilteredDisplay();
				});
			});

		const regionOnlyToggle = document.getElementById("xcb-highlight-region-only");
		if (regionOnlyToggle) {
			regionOnlyToggle.checked = Boolean(config.highlightRegionDisplayOnly);
			regionOnlyToggle.addEventListener("change", () => {
				config.highlightRegionDisplayOnly = regionOnlyToggle.checked;
				save();
				setStatus(
					config.highlightRegionDisplayOnly
						? "Highlighting region-only accounts in yellow"
						: "Region-only highlighting disabled",
				);
				if (!config.highlightRegionDisplayOnly) {
					document
						.querySelectorAll('article[data-testid="tweet"]')
						.forEach((t) => {
							if (t.dataset.xcbMode === "region-only") clearFilterMark(t);
						});
				}
				safeScan();
			});
		}

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
					row.innerHTML = `<span>${c} <span class="xcb-count" style="color:#aab8c2;">(S:${
						blockStats.country[c] || 0
					} | T:${config.filterTotals?.country?.[c] || 0})</span></span><span style="cursor:pointer;color:#f00;">×</span>`;
					row.lastChild.addEventListener("click", () => {
						config.blockedCountries.delete(c);
						save();
						refreshList();
						scanAndHide();
						setStatus(`Removed country ${c}`);
					});
					countryList.appendChild(row);
				});

			const regionList = document.getElementById("list-r");
			regionList.innerHTML = "";
			Array.from(config.blockedRegions)
				.sort()
				.forEach((r) => {
					const row = document.createElement("div");
					row.id = `xcb-r-${r}`;
					row.style.display = "flex";
					row.style.justifyContent = "space-between";
					row.style.padding = "4px 0";
					row.innerHTML = `<span>${r} <span class="xcb-count" style="color:#aab8c2;">(S:${
						blockStats.region[r] || 0
					} | T:${config.filterTotals?.region?.[r] || 0})</span></span><span style="cursor:pointer;color:#f00;">×</span>`;
					row.lastChild.addEventListener("click", () => {
						config.blockedRegions.delete(r);
						save();
						refreshList();
						scanAndHide();
						setStatus(`Removed region ${r}`);
					});
					regionList.appendChild(row);
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
					row.innerHTML = `<span>${l} <span class="xcb-count" style="color:#aab8c2;">(S:${
						blockStats.lang[l] || 0
					} | T:${config.filterTotals?.lang?.[l] || 0})</span></span><span style="cursor:pointer;color:#f00;">×</span>`;
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
			updateFilteredDisplay();
		};
		const closeModal = () => (modal.style.display = "none");

		const placeButton = () => {
			if (!ensureSidebarButton(openModal)) setTimeout(placeButton, 700);
		};
		placeButton();
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
		document.getElementById("add-r").onkeydown = (e) => {
			if (e.key === "Enter") {
				const v = e.target.value.trim();
				const resolved = resolveRegionName(v);
				if (!resolved) {
					setStatus(`Unknown region "${v}". Try a listed region name.`);
					return;
				}
				config.blockedRegions.add(resolved);
				save();
				refreshList();
				scanAndHide();
				setStatus(`Added region ${resolved}`);
				e.target.value = "";
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

	Promise.all([loadKnownFromDB(), loadTotalsFromDB()]).finally(() => start());

	console.log(
		"X Country Blocker v5.1 (CLEAN) ready — nothing blocked until you add it",
	);
})();
