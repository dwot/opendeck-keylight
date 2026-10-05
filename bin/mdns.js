/**
 * Minimal mDNS browser for Elgato lights (_elg._tcp). No dependencies.
 *
 * Joins the mDNS multicast group on port 5353 (shared with avahi via SO_REUSEADDR),
 * sends a PTR query and collects PTR/SRV/TXT/A records for `timeoutMs`.
 */

'use strict';

const dgram = require('dgram');

const MDNS_ADDR = '224.0.0.251';
const MDNS_PORT = 5353;
const SERVICE   = '_elg._tcp.local';

const T_A = 1, T_PTR = 12, T_TXT = 16, T_SRV = 33;

function encodeName(name) {
	const parts = name.split('.').filter(Boolean);
	const bufs = parts.map((p) => {
		const b = Buffer.from(p, 'utf8');
		return Buffer.concat([Buffer.from([b.length]), b]);
	});
	return Buffer.concat([...bufs, Buffer.from([0])]);
}

function buildQuery(name) {
	const header = Buffer.alloc(12);
	header.writeUInt16BE(1, 4); // QDCOUNT
	const tail = Buffer.alloc(4);
	tail.writeUInt16BE(T_PTR, 0);
	tail.writeUInt16BE(1, 2);   // class IN, QU bit clear (multicast reply)
	return Buffer.concat([header, encodeName(name), tail]);
}

// Read a (possibly compressed) DNS name. Returns { name, end } where `end` is the
// offset just past the name in the original position.
function readName(buf, off) {
	const labels = [];
	let end = -1;
	let jumps = 0;
	while (off < buf.length) {
		const len = buf[off];
		if (len === 0) { off += 1; break; }
		if ((len & 0xc0) === 0xc0) {
			if (end < 0) end = off + 2;
			off = ((len & 0x3f) << 8) | buf[off + 1];
			if (++jumps > 20) throw new Error('mDNS name loop');
			continue;
		}
		labels.push(buf.toString('utf8', off + 1, off + 1 + len));
		off += 1 + len;
	}
	return { name: labels.join('.'), end: end < 0 ? off : end };
}

function parsePacket(buf) {
	if (buf.length < 12) return [];
	const flags = buf.readUInt16BE(2);
	if (!(flags & 0x8000)) return []; // queries, not responses
	const qd = buf.readUInt16BE(4);
	const rrCount = buf.readUInt16BE(6) + buf.readUInt16BE(8) + buf.readUInt16BE(10);
	let off = 12;
	for (let i = 0; i < qd; i++) off = readName(buf, off).end + 4;

	const records = [];
	for (let i = 0; i < rrCount && off < buf.length; i++) {
		const { name, end } = readName(buf, off);
		off = end;
		const type  = buf.readUInt16BE(off);
		const rdlen = buf.readUInt16BE(off + 8);
		const rd    = off + 10;
		off = rd + rdlen;
		const rec = { name: name.toLowerCase(), type };
		if (type === T_PTR) {
			rec.data = readName(buf, rd).name;
		} else if (type === T_SRV) {
			rec.data = { port: buf.readUInt16BE(rd + 4), target: readName(buf, rd + 6).name.toLowerCase() };
		} else if (type === T_A && rdlen === 4) {
			rec.data = `${buf[rd]}.${buf[rd + 1]}.${buf[rd + 2]}.${buf[rd + 3]}`;
		} else if (type === T_TXT) {
			const txt = {};
			for (let p = rd; p < rd + rdlen;) {
				const l = buf[p];
				const s = buf.toString('utf8', p + 1, p + 1 + l);
				const eq = s.indexOf('=');
				if (eq > 0) txt[s.slice(0, eq)] = s.slice(eq + 1);
				p += 1 + l;
			}
			rec.data = txt;
		} else {
			continue;
		}
		records.push(rec);
	}
	return records;
}

/**
 * Browse for Elgato lights. Resolves to [{ name, ip, port, id }] where `id` is the
 * MAC from the TXT record (may be undefined), never rejects.
 */
function browse(timeoutMs = 2500) {
	return new Promise((resolve) => {
		const instances = new Set();
		const srv = new Map();  // instance -> { port, target }
		const txt = new Map();  // instance -> {}
		const addr = new Map(); // host -> ip

		const sock = dgram.createSocket({ type: 'udp4', reuseAddr: true });
		let done = false;
		const finish = () => {
			if (done) return;
			done = true;
			try { sock.close(); } catch {}
			const out = [];
			for (const inst of instances) {
				const s = srv.get(inst);
				if (!s) continue;
				const ip = addr.get(s.target);
				if (!ip) continue;
				out.push({ name: inst.split('.')[0], ip, port: s.port, id: (txt.get(inst) || {}).id });
			}
			resolve(out);
		};

		sock.on('error', (e) => {
			console.error('[keylight] mDNS socket error:', e.message);
			finish();
		});
		sock.on('message', (msg) => {
			let recs;
			try { recs = parsePacket(msg); } catch { return; }
			for (const r of recs) {
				if (r.type === T_PTR && r.name === SERVICE) instances.add(r.data.toLowerCase());
				else if (r.type === T_SRV) srv.set(r.name, r.data);
				else if (r.type === T_TXT) txt.set(r.name, r.data);
				else if (r.type === T_A) addr.set(r.name, r.data);
			}
		});
		sock.bind(MDNS_PORT, () => {
			try {
				sock.addMembership(MDNS_ADDR);
				sock.setMulticastTTL(255);
			} catch (e) {
				console.error('[keylight] mDNS join failed:', e.message);
			}
			const q = buildQuery(SERVICE);
			const ask = () => { if (!done) sock.send(q, MDNS_PORT, MDNS_ADDR, () => {}); };
			ask();
			setTimeout(ask, 600);
			setTimeout(finish, timeoutMs);
		});
	});
}

module.exports = { browse, parsePacket };
