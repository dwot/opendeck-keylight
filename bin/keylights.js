/**
 * Direct client for Elgato Key Lights (HTTP on port 9123), plus a device registry
 * fed by mDNS discovery, manually configured addresses and a cache of last-known
 * addresses.
 *
 * Device shape: { id, name, ip, port, on, brightness, temperature, failures }
 * `id` is the light's MAC without colons (e.g. "AABBCCDDEEFF"), stable across DHCP changes.
 */

'use strict';

const http = require('http');
const mdns = require('./mdns');

const DEFAULT_PORT = 9123;
const MAX_FAILURES = 3;          // drop a device after this many failed polls in a row
const REDISCOVER_MIN_MS = 30000; // throttle for failure-triggered rediscovery

function request(ip, port, method, path, body) {
	return new Promise((resolve, reject) => {
		const data = body ? JSON.stringify(body) : null;
		const req = http.request({
			host: ip,
			port,
			path,
			method,
			headers: data
				? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) }
				: {},
			timeout: 2000,
		}, (res) => {
			let chunks = '';
			res.on('data', (c) => chunks += c);
			res.on('end', () => {
				if (res.statusCode < 200 || res.statusCode >= 300) {
					return reject(new Error(`HTTP ${res.statusCode} from ${ip}`));
				}
				try { resolve(JSON.parse(chunks)); }
				catch { reject(new Error(`Bad JSON from ${ip}: ${chunks.slice(0, 80)}`)); }
			});
		});
		req.on('error', reject);
		req.on('timeout', () => req.destroy(new Error(`timeout talking to ${ip}`)));
		if (data) req.write(data);
		req.end();
	});
}

function normId(mac) {
	return mac ? String(mac).replace(/[^0-9a-f]/gi, '').toUpperCase() : null;
}

function parseHost(s) {
	const m = String(s).trim().match(/^([^:\s]+)(?::(\d+))?$/);
	return m ? { ip: m[1], port: m[2] ? parseInt(m[2], 10) : DEFAULT_PORT } : null;
}

function applyLightState(dev, r) {
	const l = r && r.lights && r.lights[0];
	if (!l) return;
	dev.on = !!l.on;
	dev.brightness = l.brightness;
	dev.temperature = l.temperature;
}

class KeyLights {
	constructor({ onChange } = {}) {
		this.devices = new Map();   // id -> device
		this.manualHosts = [];      // [{ ip, port }]
		this.onChange = onChange || (() => {});
		this._discovering = null;
		this._lastDiscover = 0;
	}

	/** Devices sorted by name, so "first device" and legacy indices are stable. */
	list() {
		return [...this.devices.values()].sort((a, b) => a.name.localeCompare(b.name));
	}

	get(id) {
		if (id == null) return null;
		const dev = this.devices.get(String(id));
		if (dev) return dev;
		// Legacy settings from the keylight-control era stored a numeric index.
		if (/^\d+$/.test(String(id))) return this.list()[parseInt(id, 10)] || null;
		return null;
	}

	setManualHosts(list) {
		this.manualHosts = (list || []).map(parseHost).filter(Boolean);
	}

	/** Seed from cached [{ id, name, ip, port }] so keys work before discovery finishes. */
	seed(cached) {
		for (const c of cached || []) {
			const id = normId(c.id);
			if (!id || this.devices.has(id)) continue;
			this.devices.set(id, { id, name: c.name || id, ip: c.ip, port: c.port || DEFAULT_PORT, failures: 0 });
		}
	}

	/** Compact form for the global-settings cache. */
	snapshot() {
		return this.list().map(({ id, name, ip, port }) => ({ id, name, ip, port }));
	}

	/** Query one address and register the light found there. */
	async probe(ip, port = DEFAULT_PORT, hintId) {
		const [info, state] = await Promise.all([
			request(ip, port, 'GET', '/elgato/accessory-info'),
			request(ip, port, 'GET', '/elgato/lights'),
		]);
		const id = normId(info.macAddress) || normId(hintId) || `${ip}:${port}`;
		const dev = this.devices.get(id) || { id };
		Object.assign(dev, {
			name: info.displayName || info.productName || id,
			ip, port, failures: 0,
		});
		applyLightState(dev, state);
		this.devices.set(id, dev);
		return dev;
	}

	/** mDNS browse + manual hosts + known addresses, probed in parallel. */
	discover() {
		if (this._discovering) return this._discovering;
		this._lastDiscover = Date.now();
		this._discovering = (async () => {
			const found = await mdns.browse();
			const targets = new Map();
			for (const f of found) targets.set(`${f.ip}:${f.port}`, f);
			for (const h of this.manualHosts) targets.set(`${h.ip}:${h.port}`, h);
			for (const d of this.devices.values()) {
				if (!targets.has(`${d.ip}:${d.port}`)) targets.set(`${d.ip}:${d.port}`, d);
			}
			const results = await Promise.allSettled(
				[...targets.values()].map((t) => this.probe(t.ip, t.port, t.id))
			);
			// A light that moved to a new IP is re-registered under the same MAC by probe().
			// Drop devices nobody could reach.
			const seen = new Set(results.filter((r) => r.status === 'fulfilled').map((r) => r.value.id));
			for (const id of [...this.devices.keys()]) {
				if (!seen.has(id)) this.devices.delete(id);
			}
			console.log(`[keylight] discovery: mDNS ${found.length}, manual ${this.manualHosts.length}, ` +
				`online ${seen.size} (${this.list().map((d) => `${d.name}@${d.ip}`).join(', ')})`);
			this.onChange();
			return this.list();
		})().finally(() => { this._discovering = null; });
		return this._discovering;
	}

	/** Refresh state of every known light; rediscover if any light stopped answering. */
	async poll() {
		let needDiscover = this.devices.size === 0;
		await Promise.all([...this.devices.values()].map(async (dev) => {
			try {
				applyLightState(dev, await request(dev.ip, dev.port, 'GET', '/elgato/lights'));
				dev.failures = 0;
			} catch {
				dev.failures = (dev.failures || 0) + 1;
				needDiscover = true;
				if (dev.failures >= MAX_FAILURES) this.devices.delete(dev.id);
			}
		}));
		this.onChange();
		if (needDiscover && Date.now() - this._lastDiscover > REDISCOVER_MIN_MS) {
			this.discover().catch(() => {});
		}
	}

	/** Set { on?, brightness?, temperature? } on one light; updates the cache from the reply. */
	async set(id, payload) {
		const dev = this.get(id);
		if (!dev) throw new Error(`Unknown light ${id}`);
		const light = {};
		if (typeof payload.on === 'boolean') light.on = payload.on ? 1 : 0;
		if (payload.brightness != null) light.brightness = payload.brightness;
		if (payload.temperature != null) light.temperature = payload.temperature;
		const r = await request(dev.ip, dev.port, 'PUT', '/elgato/lights', { numberOfLights: 1, lights: [light] });
		applyLightState(dev, r);
		return dev;
	}

	async toggle(id) {
		const dev = this.get(id);
		if (!dev) throw new Error(`Unknown light ${id}`);
		return this.set(dev.id, { on: !dev.on });
	}
}

module.exports = { KeyLights };
