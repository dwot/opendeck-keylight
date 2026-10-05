#!/usr/bin/env node
/**
 * me.dwot.keylight (Key Light Direct) - OpenDeck plugin for Elgato Key Lights
 * Talks to OpenDeck via Stream Deck SDK WebSocket protocol.
 * Talks to the lights directly over their HTTP API (port 9123); finds them with mDNS.
 */

'use strict';

const WebSocket = require('ws');
const { KeyLights } = require('./keylights');

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

// --- Key Lights ---
const POLL_MS = 5000;
const REDISCOVER_MS = 5 * 60 * 1000;

const lights = new KeyLights({ onChange: () => { refreshVisuals(); saveCache(); } });

const kl = {
	set:       (id, p) => lights.set(id, p),
	toggleOne: (id)    => lights.toggle(id),
};

// Apply settings to one device or all of them.
async function applyToTarget(deviceId, payload) {
	if (deviceId === ALL) {
		await Promise.all(allLightIndices().map((id) => kl.set(id, payload).catch(() => {})));
	} else {
		await kl.set(deviceId, payload);
	}
	refreshVisuals();
}

// --- Global settings: manual addresses + cache of last-known lights ---
let globalSettings = {};
let started = false;

function saveCache() {
	const cache = lights.snapshot();
	if (JSON.stringify(cache) === JSON.stringify(globalSettings.cache || [])) return;
	globalSettings = { ...globalSettings, cache };
	send({ event: 'setGlobalSettings', context: PLUGIN_UUID, payload: globalSettings });
}

function start() {
	if (started) return;
	started = true;
	// Cached lights answer in milliseconds; mDNS takes a couple of seconds.
	lights.poll().catch(() => {});
	lights.discover().catch((e) => console.error('[keylight] discovery failed:', e.message));
	setInterval(() => { lights.poll().catch(() => {}); }, POLL_MS);
	setInterval(() => { lights.discover().catch(() => {}); }, REDISCOVER_MS);
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
	send({ event: 'getGlobalSettings', context: PLUGIN_UUID });
	// Don't wait forever if the host never answers getGlobalSettings.
	setTimeout(start, 2000);
});
ws.on('error', (e) => console.error('[keylight] WebSocket error:', e.message));
ws.on('close', () => { console.error('[keylight] WebSocket closed, exiting'); process.exit(0); });

function refreshVisuals() {
	for (const [context, info] of actions) {
		updateVisual(context, info);
	}
}

// Ids of every known light.
function allLightIndices() {
	return lights.list().map((d) => d.id);
}

// All known devices.
function allDevices() {
	return lights.list();
}

// Get a representative device for the configured target.
// For ALL, returns the first light by name (used as the "reference" for current values).
function getDevice(settings) {
	const id = settings && settings.deviceId;
	if (id == null) return null;
	if (id === ALL) {
		const all = allDevices();
		return all.length ? all[0] : null;
	}
	return lights.get(id);
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
	return dev.name.replace(/Elgato Key Light (Air )?/, '').replace(/\s+/g, ' ').trim().slice(0, 12);
}

const LOCAL_HOLD_MS = 3000;

function updateVisual(context, info) {
	const dev = getDevice(info.settings);
	if (!dev) return;

	if (info.lastRotate && Date.now() - info.lastRotate > LOCAL_HOLD_MS) {
		delete info.localBrightness;
		delete info.localK;
		delete info.lastRotate;
	}

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

// Keys whose device dropdown was never touched have no deviceId; the PI shows
// "All lights" for them, so treat them that way.
function withDefaults(settings) {
	return (settings.deviceId == null || settings.deviceId === '')
		? { ...settings, deviceId: ALL }
		: settings;
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
				if (settings.deviceId === ALL) {
					// Use group state to decide the action so they end up in the same state.
					const targetOn = !isGroupOn(settings);
					await Promise.all(
						allLightIndices().map((id) =>
							kl.set(id, { on: targetOn }).catch(() => {})
						)
					);
				} else {
					await kl.toggleOne(settings.deviceId);
				}
				refreshVisuals();
				break;
			case 'me.dwot.keylight.setbrightness': {
				const b = clampInt(settings.brightness, 1, 100, 50);
				await applyToTarget(settings.deviceId, { brightness: b });
				refreshVisuals();
				break;
			}
			case 'me.dwot.keylight.scene': {
				const payload = {};
				if (typeof settings.on === 'boolean') payload.on = settings.on;
				if (settings.brightness  != null)     payload.brightness  = clampInt(settings.brightness,  1, 100, 50);
				if (settings.temperature != null)     payload.temperature = clampInt(settings.temperature, E_MIN, E_MAX, 200);
				await applyToTarget(settings.deviceId, payload);
				refreshVisuals();
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
	const dev = getDevice(settings);
	if (!dev) { showAlert(context); return; }

	const info = actions.get(context);
	if (!info) return;
	info.lastRotate = Date.now();
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
	try {
		if (action === 'me.dwot.keylight.brightnessdial') {
			// Push = toggle. For All, drive everyone to the inverse of the group state
			// (so they end up in the same on/off state, no matter what they were before).
			if (settings.deviceId === ALL) {
				const targetOn = !isGroupOn(settings);
				await Promise.all(
					allLightIndices().map((id) =>
						kl.set(id, { on: targetOn }).catch(() => {})
					)
				);
			} else {
				await kl.toggleOne(settings.deviceId);
			}
			refreshVisuals();
		} else if (action === 'me.dwot.keylight.temperaturedial') {
			const defaultK = parseInt(settings.defaultK || '4500', 10);
			await applyToTarget(settings.deviceId, { temperature: kToElgato(defaultK) });
			const info = actions.get(context);
			if (info) info.localK = defaultK;
			refreshVisuals();
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
function sendDevices(context) {
	send({
		event: 'sendToPropertyInspector',
		context,
		payload: {
			event: 'devices',
			ok: true,
			devices: lights.list().map(({ id, name, ip }) => ({ id, name, ip })),
			hosts: (globalSettings.hosts || []).join(', '),
		},
	});
}

async function handleSendToPlugin(context, payload) {
	if (!payload || !payload.command) return;
	if (payload.command === 'getDevices') {
		sendDevices(context);
		if (lights.list().length === 0 || payload.rescan) {
			await lights.discover().catch(() => {});
			sendDevices(context);
		}
	} else if (payload.command === 'setHosts') {
		const hosts = String(payload.hosts || '').split(/[\s,]+/).filter(Boolean);
		globalSettings = { ...globalSettings, hosts };
		send({ event: 'setGlobalSettings', context: PLUGIN_UUID, payload: globalSettings });
		lights.setManualHosts(hosts);
		await lights.discover().catch(() => {});
		sendDevices(context);
	}
}

// --- Event router ---
ws.on('message', (raw) => {
	let msg;
	try { msg = JSON.parse(raw); } catch { return; }

	const { event, action, context, payload } = msg;
	const rawSettings = (payload && payload.settings) || {};
	const settings = withDefaults(rawSettings);

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
		case 'didReceiveGlobalSettings':
			globalSettings = rawSettings;
			lights.setManualHosts(globalSettings.hosts);
			lights.seed(globalSettings.cache);
			refreshVisuals();
			start();
			break;
	}
});

process.on('SIGTERM', () => process.exit(0));
process.on('SIGINT',  () => process.exit(0));
