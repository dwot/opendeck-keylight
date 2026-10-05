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

function requestDevices(rescan) {
	sendToPlugin({ command: 'getDevices', rescan: !!rescan });
}

// Fill a <select> with "All lights" + each discovered light. Values are light ids (MAC).
function fillDeviceSelect($select, devices, settings) {
	$select.innerHTML = '';
	const all = document.createElement('option');
	all.value = '__ALL__';
	all.textContent = devices.length ? 'All lights' : 'All lights (none found yet)';
	$select.appendChild(all);
	for (const d of devices) {
		const opt = document.createElement('option');
		opt.value = d.id;
		opt.textContent = `${d.name} (${d.ip})`;
		$select.appendChild(opt);
	}
	const want = settings.deviceId != null ? String(settings.deviceId) : '__ALL__';
	$select.value = want;
	// Unknown/legacy id: keep it selectable rather than silently switching targets.
	if ($select.value !== want) {
		const opt = document.createElement('option');
		opt.value = want;
		opt.textContent = `${want} (not found)`;
		$select.appendChild(opt);
		$select.value = want;
	}
}

// Shared footer on every action: rescan button + manual addresses for networks where
// mDNS can't see the lights.
function mountDiscoveryFooter() {
	const wrap = document.createElement('div');
	wrap.innerHTML = `
		<hr>
		<div class="row">
			<label>Manual IPs</label>
			<input type="text" id="klHosts" placeholder="e.g. 192.168.1.50, 192.168.1.51">
		</div>
		<div class="row">
			<label></label>
			<button id="klRescan" type="button">Rescan</button>
			<span id="klStatus" class="note"></span>
		</div>
		<div class="note">Lights are found automatically (mDNS). Manual IPs are only needed if they
		don't show up. Shared by every key.</div>`;
	document.body.appendChild(wrap);
	const $hosts = wrap.querySelector('#klHosts');
	const $status = wrap.querySelector('#klStatus');
	wrap.querySelector('#klRescan').addEventListener('click', () => {
		$status.textContent = 'Scanning…';
		requestDevices(true);
	});
	$hosts.addEventListener('change', () => {
		$status.textContent = 'Scanning…';
		sendToPlugin({ command: 'setHosts', hosts: $hosts.value });
	});
	on('devices', (msg) => {
		if (document.activeElement !== $hosts) $hosts.value = msg.hosts || '';
		$status.textContent = `${msg.devices.length} light${msg.devices.length === 1 ? '' : 's'} found`;
	});
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
		mountDiscoveryFooter();
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
window.PI = { on, saveSettings, sendToPlugin, requestDevices, fillDeviceSelect, getSettings: () => currentSettings };
