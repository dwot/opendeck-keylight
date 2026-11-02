// Regenerates the plugin's static PNG icons: the sidebar, category and
// plugin icons and the images OpenDeck shows before the plugin draws a key.
// They follow the OpenXLR deck plugin's static icons: a flat dark tile with
// one thick coloured line glyph. Needs rsvg-convert.
'use strict';
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const root = path.join(__dirname, '..');

const TILE = '#1d2027';
const AMBER = '#ffc04d', GREEN = '#3ecf7a', BLUE = '#4fb3d9', DOTS = '#4a4f5c';
const W = 11;   // stroke width, as in OpenXLR's icons
const line = (c) => `fill="none" stroke="${c}" stroke-width="${W}" stroke-linecap="round" stroke-linejoin="round"`;

const GLYPHS = {
	// A knob with its pointer and the three detent dots, like OpenXLR's dial icon.
	knob: (c) => `<circle cx="72" cy="64" r="33" ${line(c)}/>
		<line x1="72" y1="64" x2="53" y2="45" ${line(c)}/>
		<g fill="${DOTS}"><circle cx="36" cy="114" r="5.5"/><circle cx="72" cy="120" r="5.5"/><circle cx="108" cy="114" r="5.5"/></g>`,
	// A Key Light panel on its stand.
	light: (c) => `<path d="M72 20v9 M45 26l5 8 M99 26l-5 8" ${line(c)}/>
		<rect x="34" y="44" width="76" height="44" rx="9" ${line(c)}/>
		<path d="M72 88v22 M52 116h40" ${line(c)}/>`,
	sun: (c) => `<circle cx="72" cy="72" r="19" ${line(c)}/>
		<path d="M72 22v10 M72 112v10 M22 72h10 M112 72h10 M37 37l7 7 M100 100l7 7 M37 107l7 -7 M100 44l7 -7" ${line(c)}/>`,
	thermo: (c) => `<path d="M62 86V38a10 10 0 0 1 20 0v48" ${line(c)}/>
		<circle cx="72" cy="102" r="16" ${line(c)}/>
		<path d="M96 42h10 M96 60h10" ${line(c)}/>`,
	scene: (c) => `<rect x="30" y="50" width="70" height="52" rx="8" ${line(c)}/>
		<path d="M42 38h66a8 8 0 0 1 8 8v42" ${line(c)}/>
		<path d="M42 90l14 -16l12 10l10 -16l14 22" ${line(c)}/>`,
};

// The temperature knob is drawn in the warm-to-cool spectrum it controls.
const KELVIN = `<linearGradient id="k" gradientUnits="userSpaceOnUse" x1="30" y1="0" x2="114" y2="0">
	<stop offset="0" stop-color="#ffa94d"/><stop offset="0.5" stop-color="#ffe9cc"/><stop offset="1" stop-color="#a9c8ff"/></linearGradient>`;

function tile(glyph, colour, defs = '') {
	return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="144" height="144" viewBox="0 0 144 144">
		<defs>${defs}</defs>
		<rect width="144" height="144" rx="22" fill="${TILE}"/>
		${GLYPHS[glyph](colour)}</svg>`);
}

function png(svg, file, size) {
	execFileSync('rsvg-convert', ['-w', String(size), '-h', String(size), '-o', path.join(root, 'icons', file)], { input: svg });
}
function both(svg, name, size) { png(svg, `${name}.png`, size); png(svg, `${name}@2x.png`, size * 2); }

// Action icons, used in the sidebar and as each action's default image.
const icons = {
	'brightness-dial': tile('knob', AMBER),
	'temperature-dial': tile('knob', 'url(#k)', KELVIN),
	toggle: tile('light', GREEN),
	brightness: tile('sun', AMBER),
	scene: tile('scene', BLUE),
};
for (const [name, svg] of Object.entries(icons)) both(svg, name, 72);
both(tile('light', AMBER), 'plugin', 256);

// The category icon sits beside the sidebar heading, so it stays a plain glyph.
both(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="144" height="144" viewBox="0 0 144 144">${GLYPHS.light('#ffffff')}</svg>`), 'category', 28);
console.log('icons written');
