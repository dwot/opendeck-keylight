// Regenerates the plugin's static PNG icons from bin/render.js, in the
// default OpenXLR skin (Broadcast). Needs rsvg-convert.
'use strict';
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const root = path.join(__dirname, '..');
const render = require(path.join(root, 'bin', 'render.js'));
const c = require(path.join(root, 'bin', 'skin-palettes.json')).broadcast;

const svgOf = (uri) => Buffer.from(uri.split(',')[1], 'base64');
function png(svg, file, size) {
	const out = path.join(root, 'icons', file);
	execFileSync('rsvg-convert', ['-w', String(size), '-h', String(size), '-o', out], { input: svg });
}
function both(svg, name, size) { png(svg, `${name}.png`, size); png(svg, `${name}@2x.png`, size * 2); }

// Default key faces (shown before the plugin draws, and in the action list preview).
const keys = {
	'state-off': { on: false, known: true, glyph: 'light' },
	'state-on': { on: true, known: true, glyph: 'light' },
	toggle: { on: true, known: true, glyph: 'light' },
	brightness: { on: true, known: true, badge: '50' },
	scene: { on: true, known: true, glyph: 'scene' },
	temperature: { on: true, known: true, glyph: 'thermo' },
};
for (const [name, k] of Object.entries(keys)) both(svgOf(render.keyImage(c, k)), name, 72);
both(svgOf(render.keyImage(c, { on: true, known: true, glyph: 'light' })), 'plugin', 256);

// Monochrome sidebar glyphs.
const mono = (glyph, color = '#ffffff') => Buffer.from(
	`<svg xmlns="http://www.w3.org/2000/svg" width="144" height="144" viewBox="0 0 144 144">${render.GLYPHS[glyph].replaceAll('currentColor', color)}</svg>`);
const actions = { brightness: 'sun', scene: 'scene', temperature: 'thermo', toggle: 'light' };
for (const [name, glyph] of Object.entries(actions)) both(mono(glyph), `actions/${name}`, 20);
both(mono('light'), 'category', 28);
console.log('icons written');
