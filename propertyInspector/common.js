// Shared property inspector boilerplate.
// Connects to OpenDeck via WebSocket and exposes a small API.

let websocket = null;
let pluginUuid = null;
let actionUuid = null;
let registerEvent = null;
let currentSettings = {};

const listeners = {
	settings: [],
	devices:  [],
	open:     [],
};

function on(event, fn) { (listeners[event] || (listeners[event] = [])).push(fn); }
function emit(event, data) { (listeners[event] || []).forEach((fn) => fn(data)); }

function saveSettings(settings) {
	currentSettings = settings;
	if (websocket && websocket.readyState === WebSocket.OPEN) {
		websocket.send(JSON.stringify({
			event: 'setSettings',
			context: pluginUuid,
			payload: settings,
		}));
	}
}

function sendToPlugin(payload) {
	if (websocket && websocket.readyState === WebSocket.OPEN) {
		websocket.send(JSON.stringify({
			event: 'sendToPlugin',
			context: pluginUuid,
			action: actionUuid,
			payload,
		}));
	}
}

function requestDevices() {
	sendToPlugin({ command: 'getDevices' });
}

// Stream Deck calls this entry point with connection params.
function connectElgatoStreamDeckSocket(port, uuid, regEvent, info, actionInfoStr) {
	pluginUuid = uuid;
	registerEvent = regEvent;

	let actionInfo = {};
	try { actionInfo = JSON.parse(actionInfoStr); } catch {}
	actionUuid = actionInfo.action;
	currentSettings = (actionInfo.payload && actionInfo.payload.settings) || {};

	websocket = new WebSocket('ws://127.0.0.1:' + port);
	websocket.onopen = () => {
		websocket.send(JSON.stringify({ event: regEvent, uuid }));
		emit('settings', currentSettings);
		emit('open');
		// Auto-request the device list on every PI open.
		requestDevices();
	};
	websocket.onmessage = (e) => {
		let msg;
		try { msg = JSON.parse(e.data); } catch { return; }
		if (msg.event === 'didReceiveSettings') {
			currentSettings = (msg.payload && msg.payload.settings) || {};
			emit('settings', currentSettings);
		} else if (msg.event === 'sendToPropertyInspector') {
			const p = msg.payload || {};
			if (p.event === 'devices') emit('devices', p);
		}
	};
}

// Expose globally so the SDK can call it.
window.connectElgatoStreamDeckSocket = connectElgatoStreamDeckSocket;
window.PI = { on, saveSettings, sendToPlugin, requestDevices, getSettings: () => currentSettings };
