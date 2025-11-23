// ==UserScript==
// @name         X Country Blocker - Clean Start (No Defaults)
// @namespace    http://tampermonkey.net/
// @version      5.1
// @description  Block by country & language — completely empty by default. You decide everything.
// @author       You
// @match        https://x.com/*
// @match        https://twitter.com/*
// @grant        GM_xmlhttpRequest
// @run-at       document-start
// ==/UserScript==

(function () {
    'use strict';

    const STORAGE_KEY = 'xCountryBlocker';
    let config = {
        blockedCountries: new Set(),  // ← EMPTY
        blockedLangs: new Set(),      // ← EMPTY
        countryDB: {},
        knownUsers: {},
        pending: new Set()
    };

    // Full country map (unchanged)
    const COUNTRY_MAP = { /* same huge list as before */ 
        "Afghanistan":"AF","Albania":"AL","Algeria":"DZ","Andorra":"AD","Angola":"AO","Argentina":"AR","Armenia":"AM","Australia":"AU","Austria":"AT","Azerbaijan":"AZ",
        "Bahamas":"BS","Bahrain":"BH","Bangladesh":"BD","Barbados":"BB","Belarus":"BY","Belgium":"BE","Belize":"BZ","Benin":"BJ","Bhutan":"BT","Bolivia":"BO",
        "Bosnia and Herzegovina":"BA","Botswana":"BW","Brazil":"BR","Bulgaria":"BG","Burkina Faso":"BF","Burundi":"BI","Cambodia":"KH","Cameroon":"CM","Canada":"CA","Chile":"CL",
        "China":"CN","Colombia":"CO","Costa Rica":"CR","Croatia":"HR","Cuba":"CU","Cyprus":"CY","Czechia":"CZ","Denmark":"DK","Dominican Republic":"DO","Ecuador":"EC",
        "Egypt":"EG","El Salvador":"SV","Estonia":"EE","Ethiopia":"ET","Finland":"FI","France":"FR","Georgia":"GE","Germany":"DE","Ghana":"GH","Greece":"GR",
        "Guatemala":"GT","Honduras":"HN","Hungary":"HU","Iceland":"IS","India":"IN","Indonesia":"ID","Iran":"IR","Iraq":"IQ","Ireland":"IE","Israel":"IL",
        "Italy":"IT","Jamaica":"JM","Japan":"JP","Jordan":"JO","Kazakhstan":"KZ","Kenya":"KE","Kuwait":"KW","Latvia":"LV","Lebanon":"LB","Libya":"LY",
        "Lithuania":"LT","Luxembourg":"LU","Madagascar":"MG","Malaysia":"MY","Maldives":"MV","Mexico":"MX","Monaco":"MC","Morocco":"MA","Nepal":"NP","Netherlands":"NL",
        "New Zealand":"NZ","Nigeria":"NG","Norway":"NO","Oman":"OM","Pakistan":"PK","Panama":"PA","Paraguay":"PY","Peru":"PE","Philippines":"PH","Poland":"PL",
        "Portugal":"PT","Qatar":"QA","Romania":"RO","Russia":"RU","Saudi Arabia":"SA","Senegal":"SN","Serbia":"RS","Singapore":"SG","Slovakia":"SK","Slovenia":"SI",
        "South Africa":"ZA","South Korea":"KR","Spain":"ES","Sri Lanka":"LK","Sweden":"SE","Switzerland":"CH","Taiwan":"TW","Thailand":"TH","Tunisia":"TN","Turkey":"TR",
        "Ukraine":"UA","United Arab Emirates":"AE","United Kingdom":"GB","United States":"US","Uruguay":"UY","Venezuela":"VE","Vietnam":"VN","Yemen":"YE","Zimbabwe":"ZW"
    };

    const LANG_SCRIPTS = {
        hi: /[\u0900-\u097F]/, ta: /[\u0B80-\u0BFF]/, te: /[\u0C00-\u0C7F]/, kn: /[\u0C80-\u0CFF]/,
        ml: /[\u0D00-\u0D7F]/, he: /[\u0590-\u05FF]/, ur: /[\u0600-\u06FF]/, pa: /[\u0A00-\u0A7F]/,
        ar: /[\u0600-\u06FF]/, fa: /[\u0600-\u06FF]/, ps: /[\u0600-\u06FF]/
    };

    function load() {
        const saved = localStorage.getItem(STORAGE_KEY);
        if (saved) {
            const parsed = JSON.parse(saved);
            config.blockedCountries = new Set(parsed.blockedCountries || []);
            config.blockedLangs = new Set(parsed.blockedLangs || []);
            config.countryDB = parsed.countryDB || {};
            config.knownUsers = parsed.knownUsers || {};
        }
    }
    function save() {
        localStorage.setItem(STORAGE_KEY, JSON.stringify({
            blockedCountries: Array.from(config.blockedCountries),
            blockedLangs: Array.from(config.blockedLangs),
            countryDB: config.countryDB,
            knownUsers: config.knownUsers
        }));
    }
    load();

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
        tweet.style.display = 'none';
        const box = document.createElement('div');
        box.textContent = `Blocked: ${reason}`;
        box.style = 'background:#000;color:#fff;padding:4px 8px;font-size:11px;border-radius:4px;margin:8px 0;';
        tweet.parentNode?.insertBefore(box, tweet);
        tweet.dataset.blocked = '1';
        console.log('Blocked:', reason);
    }

    function fetchCountry(username) {
        if (config.knownUsers[username] || config.pending.has(username)) return;
        config.pending.add(username);
        GM_xmlhttpRequest({
            method: "GET",
            url: `https://x.com/${username}`,
            onload: r => {
                config.pending.delete(username);
                const m = r.responseText.match(/Account is located in ([^"<.]+)/);
                if (m) {
                    const name = m[1].trim();
                    const code = COUNTRY_MAP[name] || name.slice(0,2).toUpperCase();
                    config.knownUsers[username] = code;
                    if (!config.countryDB[code]) config.countryDB[code] = [];
                    config.countryDB[code].push(username);
                    save();
                    if (config.blockedCountries.has(code)) scanAndHide();
                }
            }
        });
    }

    function scanAndHide() {
        document.querySelectorAll('article[data-testid="tweet"]').forEach(tweet => {
            if (tweet.dataset.blocked) return;
            const a = tweet.querySelector('a[href^="/"][href*="/status/"]');
            const username = a?.href.match(/\/([^\/]+)\/status\//)?.[1];
            const text = tweet.querySelector('[data-testid="tweetText"]')?.textContent || '';
            let reason = hasBlockedLang(text) ? `Lang:${hasBlockedLang(text)}` : '';
            if (username && config.knownUsers[username] && config.blockedCountries.has(config.knownUsers[username]))
                reason = reason ? `${reason}+Country` : `Country:${config.knownUsers[username]}`;
            if (username && !config.knownUsers[username]) fetchCountry(username);
            if (reason) hide(tweet, reason);
        });
    }

    function injectUI() {
        if (document.getElementById('xcb-button')) return;
        const btn = document.createElement('div');
        btn.id = 'xcb-button';
        btn.innerHTML = 'X';
        btn.title = 'Blocker Settings';
        btn.style = 'position:fixed;bottom:20px;right:20px;width:48px;height:48px;background:#000;color:#fff;border-radius:50%;font-size:28px;line-height:48px;text-align:center;cursor:pointer;z-index:9999;box-shadow:0 4px 12px rgba(0,0,0,0.4);';
        document.body.appendChild(btn);

        const modal = document.createElement('div');
        modal.id = 'xcb-modal';
        modal.style = 'display:none;position:fixed;inset:0;background:rgba(0,0,0,0.7);z-index:10000;align-items:center;justify-content:center;';
        modal.innerHTML = `<div style="background:#15202b;color:#fff;padding:20px;border-radius:12px;max-width:420px;width:90%;max-height:90vh;overflow:auto;">
            <h2 style="margin:0 0 16px;text-align:center;">X Country & Language Blocker</h2>
            <strong>Countries</strong><div id="list-c" style="max-height:200px;overflow:auto;margin:8px 0;padding:8px;background:#0002;border-radius:8px;"></div>
            <input id="add-c" placeholder="Add country code (e.g. RU)" style="width:100%;padding:8px;margin:8px 0;border-radius:8px;">
            <strong>Languages</strong><div id="list-l" style="max-height:200px;overflow:auto;margin:8px 0;padding:8px;background:#0002;border-radius:8px;"></div>
            <input id="add-l" placeholder="Add language (e.g. ar)" style="width:100%;padding:8px;margin:8px 0;border-radius:8px;">
            <button id="close" style="width:100%;padding:10px;background:#1d9bf0;border:none;border-radius:8px;color:#fff;margin-top:12px;cursor:pointer;">Close</button>
        </div>`;
        document.body.appendChild(modal);

        const refresh = () => {
            document.getElementById('list-c').innerHTML = Array.from(config.blockedCountries).sort().map(c => 
                `<div style="display:flex;justify-content:space-between;padding:4px 0;"><span>${c}</span><span onclick="config.blockedCountries.delete('${c}');save();refresh();scanAndHide();" style="cursor:pointer;color:#f00;">×</span></div>`).join('');
            document.getElementById('list-l').innerHTML = Array.from(config.blockedLangs).sort().map(l => 
                `<div style="display:flex;justify-content:space-between;padding:4px 0;"><span>${l}</span><span onclick="config.blockedLangs.delete('${l}');save();refresh();scanAndHide();" style="cursor:pointer;color:#f00;">×</span></div>`).join('');
        };

        btn.onclick = () => { modal.style.display = 'flex'; refresh(); };
        document.getElementById('close').onclick = () => modal.style.display = 'none';
        document.getElementById('add-c').onkeydown = e => { if(e.key==='Enter'){ const v=e.target.value.trim().toUpperCase(); if(v){config.blockedCountries.add(v);save();refresh();scanAndHide();e.target.value='';} }};
        document.getElementById('add-l').onkeydown = e => { if(e.key==='Enter'){ const v=e.target.value.trim().toLowerCase(); if(v){config.blockedLangs.add(v);save();refresh();scanAndHide();e.target.value='';} }};
    }

    const observer = new MutationObserver(scanAndHide);
    observer.observe(document.body || document.documentElement, { childList: true, subtree: true });
    setInterval(scanAndHide, 4000);
    setTimeout(() => { scanAndHide(); injectUI(); }, 2000);

    console.log('X Country Blocker v5.1 (CLEAN) ready — nothing blocked until you add it');
})();
