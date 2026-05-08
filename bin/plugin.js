#!/usr/bin/env node
/**
 * me.dwot.keylight - OpenDeck plugin for Elgato Key Lights
 * Talks to OpenDeck via Stream Deck SDK WebSocket protocol.
 * Talks to keylight-control's HTTP API (default 127.0.0.1:27301).
 */

'use strict';

const WebSocket = require('ws');
const http = require('http');

// --- CLI args from OpenDeck ---
const args = process.argv.slice(2);
function arg(name) {
	const i = args.indexOf('-' + name);
	return i >= 0 ? args[i + 1] : null;
}
const PORT         = arg('port');
const PLUGIN_UUID  = arg('pluginUUID');
const REGISTER_EVT = arg('registerEvent');

if (!PORT || !PLUGIN_UUID || !REGISTER_EVT) {
	console.error('[keylight] Missing required args from OpenDeck');
	process.exit(1);
}

const ALL = '__ALL__';

// --- keylight-control HTTP client ---
const KL_HOST = process.env.KEYLIGHT_HOST || '127.0.0.1';
const KL_PORT = parseInt(process.env.KEYLIGHT_PORT || '27301', 10);

function klRequest(method, path, body) {
	return new Promise((resolve, reject) => {
		const data = body ? JSON.stringify(body) : null;
		const req = http.request({
			host: KL_HOST,
			port: KL_PORT,
			path,
			method,
			headers: data
				? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) }
				: {},
			timeout: 3000,
		}, (res) => {
			let chunks = '';
			res.on('data', (c) => chunks += c);
			res.on('end', () => {
				try { resolve(JSON.parse(chunks)); }
				catch (e) { reject(new Error('Bad JSON from keylight-control: ' + chunks)); }
			});
		});
		req.on('error', reject);
		req.on('timeout', () => { req.destroy(new Error('keylight-control timeout')); });
		if (data) req.write(data);
		req.end();
	});
}

const kl = {
	list:      ()       => klRequest('GET',  '/api/lights'),
	get:       (id)     => klRequest('GET',  `/api/lights/${encodeURIComponent(id)}`),
	set:       (id, p)  => klRequest('PUT',  `/api/lights/${encodeURIComponent(id)}`, p),
	toggleAll: ()       => klRequest('POST', '/api/lights/toggle'),
	toggleOne: (id)     => klRequest('POST', `/api/lights/${encodeURIComponent(id)}/toggle`),
};

// Apply settings to one device or all of them.
async function applyToTarget(deviceId, payload) {
	if (deviceId === ALL) {
		const ids = [...allLightIndices()];
		await Promise.all(ids.map((id) => kl.set(id, payload).catch(() => {})));
	} else {
		await kl.set(deviceId, payload);
	}
}

// --- Elgato units <-> Kelvin conversion ---
// 143 ≈ 7000K, 344 ≈ 2900K. Linear interp.
const E_MIN = 143, E_MAX = 344;
const K_MIN = 2900, K_MAX = 7000;
function kToElgato(k) {
	k = Math.max(K_MIN, Math.min(K_MAX, k));
	const ratio = (K_MAX - k) / (K_MAX - K_MIN);
	return Math.round(E_MIN + ratio * (E_MAX - E_MIN));
}
function elgatoToK(e) {
	e = Math.max(E_MIN, Math.min(E_MAX, e));
	const ratio = (e - E_MIN) / (E_MAX - E_MIN);
	return Math.round(K_MAX - ratio * (K_MAX - K_MIN));
}

// --- OpenDeck WebSocket ---
const ws = new WebSocket('ws://127.0.0.1:' + PORT);

const actions = new Map();      // Map<context, { action, settings, localBrightness?, localK? }>
const lightState = new Map();   // Cache of last-known light state, keyed by index string and MAC
const pendingApply = new Map(); // Per-context debounce

function send(payload) {
	if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(payload));
}
function setState(context, state) {
	send({ event: 'setState', context, payload: { state } });
}
function showAlert(context) {
	send({ event: 'showAlert', context });
}
function setTitle(context, title) {
	send({ event: 'setTitle', context, payload: { title, target: 0 } });
}
function setFeedback(context, payload) {
	send({ event: 'setFeedback', context, payload });
}

ws.on('open', () => {
	send({ event: REGISTER_EVT, uuid: PLUGIN_UUID });
	console.log('[keylight] Registered with OpenDeck');
	pollLights().catch((e) => console.error('[keylight] initial poll failed:', e.message));
	setInterval(() => { pollLights().catch(() => {}); }, 5000);
});
ws.on('error', (e) => console.error('[keylight] WebSocket error:', e.message));
ws.on('close', () => { console.error('[keylight] WebSocket closed, exiting'); process.exit(0); });

// --- State polling and visual sync ---
async function pollLights() {
	const r = await kl.list();
	if (!r || !r.ok) return;
	// Wipe stale entries (handles devices going away).
	lightState.clear();
	for (const d of r.devices || []) {
		lightState.set(String(d.index), d);
		if (d.mac) lightState.set(d.mac, d);
	}
	for (const [context, info] of actions) {
		updateVisual(context, info);
	}
}

// Returns iterable of integer-index strings ("0", "1", ...) — one per real device.
function* allLightIndices() {
	for (const [k, v] of lightState) {
		if (k === String(v.index)) yield k;
	}
}

// All discovered devices.
function allDevices() {
	const out = [];
	for (const [k, v] of lightState) {
		if (k === String(v.index)) out.push(v);
	}
	return out;
}

// Get a representative device for the configured target.
// For ALL, returns the first discovered device (used as the "reference" for current values).
function getDevice(settings) {
	const id = settings && settings.deviceId;
	if (id == null) return null;
	if (id === ALL) {
		const all = allDevices();
		return all.length ? all[0] : null;
	}
	return lightState.get(String(id)) || null;
}

// "Are all targeted lights on?" — for the All Lights toggle UX.
// If ANY are on, treat the group as "on" (so a press turns them all off).
function isGroupOn(settings) {
	const id = settings && settings.deviceId;
	if (id !== ALL) {
		const d = getDevice(settings);
		return d ? !!d.on : false;
	}
	for (const d of allDevices()) {
		if (d.on) return true;
	}
	return false;
}

function shortName(dev, settings) {
	if (settings && settings.deviceId === ALL) return 'All Lights';
	if (!dev) return '';
	return dev.name.replace(/^Elgato Key Light /, '').replace(/^Air /, '').slice(0, 12);
}

function updateVisual(context, info) {
	const dev = getDevice(info.settings);
	if (!dev) return;

	const isAll = info.settings.deviceId === ALL;
	const groupOn = isAll ? isGroupOn(info.settings) : !!dev.on;

	switch (info.action) {
		case 'me.dwot.keylight.toggle':
			setState(context, groupOn ? 1 : 0);
			if (info.settings.showBrightness) {
				setTitle(context, groupOn ? `${dev.brightness}%` : '');
			}
			break;
		case 'me.dwot.keylight.brightnessdial':
			setFeedback(context, {
				title: shortName(dev, info.settings),
				value: groupOn ? `${dev.brightness}%` : 'OFF',
				indicator: groupOn ? dev.brightness : 0,
			});
			break;
		case 'me.dwot.keylight.temperaturedial': {
			const k = elgatoToK(dev.temperature);
			const indicatorPct = Math.round(((k - K_MIN) / (K_MAX - K_MIN)) * 100);
			setFeedback(context, {
				title: shortName(dev, info.settings),
				value: `${k}K`,
				indicator: indicatorPct,
			});
			break;
		}
	}
}

function clampInt(v, lo, hi, def) {
	const n = parseInt(v, 10);
	if (isNaN(n)) return def;
	return Math.max(lo, Math.min(hi, n));
}

// --- Keypad action handler ---
async function handleKeyDown(action, context, settings) {
	try {
		switch (action) {
			case 'me.dwot.keylight.toggle':
				if (settings.deviceId === ALL || settings.deviceId == null) {
					// Use group state to decide the action so they end up in the same state.
					const targetOn = !isGroupOn(settings);
					await Promise.all(
						[...allLightIndices()].map((id) =>
							kl.set(id, { on: targetOn }).catch(() => {})
						)
					);
				} else {
					await kl.toggleOne(settings.deviceId);
				}
				setTimeout(() => pollLights().catch(() => {}), 250);
				break;
			case 'me.dwot.keylight.setbrightness': {
				if (settings.deviceId == null) throw new Error('No device configured');
				const b = clampInt(settings.brightness, 1, 100, 50);
				await applyToTarget(settings.deviceId, { brightness: b });
				setTimeout(() => pollLights().catch(() => {}), 250);
				break;
			}
			case 'me.dwot.keylight.scene': {
				if (settings.deviceId == null) throw new Error('No device configured');
				const payload = {};
				if (typeof settings.on === 'boolean') payload.on = settings.on;
				if (settings.brightness  != null)     payload.brightness  = clampInt(settings.brightness,  1, 100, 50);
				if (settings.temperature != null)     payload.temperature = clampInt(settings.temperature, E_MIN, E_MAX, 200);
				await applyToTarget(settings.deviceId, payload);
				setTimeout(() => pollLights().catch(() => {}), 250);
				break;
			}
		}
	} catch (e) {
		console.error('[keylight] keyDown failed:', e.message);
		showAlert(context);
	}
}

// --- Encoder (dial) handlers ---
function scheduleApply(context, deviceId, payload, debounceMs = 80) {
	let entry = pendingApply.get(context);
	if (entry) {
		clearTimeout(entry.timer);
		Object.assign(entry.payload, payload);
	} else {
		entry = { payload: { ...payload } };
		pendingApply.set(context, entry);
	}
	entry.timer = setTimeout(async () => {
		pendingApply.delete(context);
		try {
			await applyToTarget(deviceId, entry.payload);
		} catch (e) {
			console.error('[keylight] apply failed:', e.message);
			showAlert(context);
		}
	}, debounceMs);
}

async function handleDialRotate(action, context, settings, payload) {
	const ticks = payload.ticks || 0;
	if (settings.deviceId == null) { showAlert(context); return; }
	const dev = getDevice(settings);
	if (!dev) { showAlert(context); return; }

	const info = actions.get(context);
	if (!info) return;
	const isAll = settings.deviceId === ALL;

	if (action === 'me.dwot.keylight.brightnessdial') {
		const step = parseInt(settings.step || '5', 10);
		const current = (info.localBrightness != null) ? info.localBrightness : dev.brightness;
		const next = Math.max(1, Math.min(100, current + ticks * step));
		info.localBrightness = next;

		const groupOn = isAll ? isGroupOn(settings) : !!dev.on;
		setFeedback(context, {
			title: shortName(dev, settings),
			value: groupOn ? `${next}%` : `${next}% (off)`,
			indicator: groupOn ? next : 0,
		});
		scheduleApply(context, settings.deviceId, { brightness: next });
	} else if (action === 'me.dwot.keylight.temperaturedial') {
		const stepK = parseInt(settings.step || '100', 10);
		const currentK = (info.localK != null) ? info.localK : elgatoToK(dev.temperature);
		const nextK = Math.max(K_MIN, Math.min(K_MAX, currentK + ticks * stepK));
		info.localK = nextK;
		const indicatorPct = Math.round(((nextK - K_MIN) / (K_MAX - K_MIN)) * 100);
		setFeedback(context, {
			title: shortName(dev, settings),
			value: `${nextK}K`,
			indicator: indicatorPct,
		});
		scheduleApply(context, settings.deviceId, { temperature: kToElgato(nextK) });
	}
}

async function handleDialDown(action, context, settings) {
	if (settings.deviceId == null) { showAlert(context); return; }
	try {
		if (action === 'me.dwot.keylight.brightnessdial') {
			// Push = toggle. For All, drive everyone to the inverse of the group state
			// (so they end up in the same on/off state, no matter what they were before).
			if (settings.deviceId === ALL) {
				const targetOn = !isGroupOn(settings);
				await Promise.all(
					[...allLightIndices()].map((id) =>
						kl.set(id, { on: targetOn }).catch(() => {})
					)
				);
			} else {
				await kl.toggleOne(settings.deviceId);
			}
			setTimeout(() => pollLights().catch(() => {}), 250);
		} else if (action === 'me.dwot.keylight.temperaturedial') {
			const defaultK = parseInt(settings.defaultK || '4500', 10);
			await applyToTarget(settings.deviceId, { temperature: kToElgato(defaultK) });
			const info = actions.get(context);
			if (info) info.localK = defaultK;
			setTimeout(() => pollLights().catch(() => {}), 250);
		}
	} catch (e) {
		console.error('[keylight] dialDown failed:', e.message);
		showAlert(context);
	}
}

async function handleTouchTap(action, context, settings) {
	return handleDialDown(action, context, settings);
}

// --- Property inspector messages ---
async function handleSendToPlugin(context, payload) {
	if (!payload || !payload.command) return;
	if (payload.command === 'getDevices') {
		try {
			const r = await kl.list();
			send({
				event: 'sendToPropertyInspector',
				context,
				payload: { event: 'devices', devices: (r && r.ok) ? r.devices : [], ok: !!(r && r.ok) },
			});
		} catch (e) {
			send({
				event: 'sendToPropertyInspector',
				context,
				payload: { event: 'devices', devices: [], ok: false, error: e.message },
			});
		}
	}
}

// --- Event router ---
ws.on('message', (raw) => {
	let msg;
	try { msg = JSON.parse(raw); } catch { return; }

	const { event, action, context, payload } = msg;
	const settings = (payload && payload.settings) || {};

	switch (event) {
		case 'willAppear':
			actions.set(context, { action, settings });
			updateVisual(context, { action, settings });
			break;
		case 'willDisappear':
			actions.delete(context);
			pendingApply.delete(context);
			break;
		case 'didReceiveSettings': {
			const info = actions.get(context) || { action };
			info.settings = settings;
			delete info.localBrightness;
			delete info.localK;
			actions.set(context, info);
			updateVisual(context, info);
			break;
		}
		case 'keyDown':
			handleKeyDown(action, context, settings);
			break;
		case 'dialRotate':
			handleDialRotate(action, context, settings, payload);
			break;
		case 'dialDown':
			handleDialDown(action, context, settings);
			break;
		case 'dialUp':
			break;
		case 'touchTap':
			handleTouchTap(action, context, settings);
			break;
		case 'sendToPlugin':
			handleSendToPlugin(context, payload);
			break;
	}
});

process.on('SIGTERM', () => process.exit(0));
process.on('SIGINT',  () => process.exit(0));
