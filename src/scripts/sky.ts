/**
 * The sky behind every page: the sun, the moon in its real phase, the five naked-eye planets,
 * and the twelve zodiac constellations, each where it really is for the viewer, redrawn every
 * minute. lightSky() sets the palette from the same moment.
 *
 * The view is a 180° panorama facing the side of the sky where the sun crosses the meridian
 * that day, so the sun always passes through it: south for most of the northern hemisphere,
 * north for most of the southern, and either in the tropics as the seasons turn. Azimuth runs
 * evenly across the screen and altitude up it, from the horizon at the bottom edge to the
 * zenith at the top. Facing south, east is on the left, so everything rises on the left and
 * sets on the right; facing north it is the other way round. Whatever is below the horizon or
 * behind the viewer is not drawn.
 *
 * The viewer is placed at their time zone's principal city (see sky-light.ts).
 */
import {
  Body,
  Equator,
  Horizon,
  HorizonFromVector,
  Illumination,
  MakeTime,
  Observer,
  RotateVector,
  Rotation_EQJ_HOR,
  Spherical,
  VectorFromSphere,
} from 'astronomy-engine';
import zodiac from '../lib/sky-stars.json';
import { lightSky, type SkyFix } from './sky-light';

const RAD = Math.PI / 180;
const SVG_NS = 'http://www.w3.org/2000/svg';
/** Drawn radii in px. The real discs are half a degree across; these are sized to be seen. */
const SUN_R = 15;
const MOON_R = 12;
/** Stars at least this bright twinkle. They are HTML rather than SVG so the compositor animates them. */
const TWINKLE_MAG = 2.5;

const PLANETS = [Body.Mercury, Body.Venus, Body.Mars, Body.Jupiter, Body.Saturn];

/** Faintest magnitude that shows with the sun at `sunAlt`: nothing until night, everything by 16° down. */
const faintest = (sunAlt: number) => (sunAlt > -4 ? -Infinity : 1 + (-4 - sunAlt) * 0.45);

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

/** Opacity of a point of light of magnitude `mag` in a sky that shows down to `limit`. */
const glimmer = (mag: number, limit: number) => clamp((limit - mag) / 1.5, 0, 1) * clamp(1.15 - 0.15 * mag, 0.3, 1);

const starRadius = (mag: number) => clamp(2.7 - 0.4 * mag, 0.7, 3.2);

/** A star's tint from its B-V colour index: blue-white through white to orange. */
const starTint = (bv: number) =>
  bv < 0 ? '#dfe6ff' : bv < 0.4 ? '#f4f3ff' : bv < 0.8 ? '#fff4e2' : bv < 1.3 ? '#ffe4bf' : '#ffd0a0';

function svg<K extends keyof SVGElementTagNameMap>(name: K, attrs: Record<string, string | number>, parent?: Element) {
  const node = document.createElementNS(SVG_NS, name);
  for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, String(value));
  parent?.append(node);
  return node;
}

const pct = (fraction: number) => `${(fraction * 100).toFixed(3)}%`;

function show(node: SVGElement | HTMLElement, visible: boolean) {
  node.style.display = visible ? '' : 'none';
}

/** Builds the sky's bodies inside `.sky` and returns the function that moves them to a moment. */
function raiseSky(sky: HTMLElement) {
  const field = svg('svg', { class: 'sky-bodies' });
  const defs = svg('defs', {}, field);
  for (const id of ['sky-sun-glow', 'sky-moon-glow']) {
    const gradient = svg('radialGradient', { id }, defs);
    svg('stop', { offset: 0 }, gradient);
    svg('stop', { offset: 1 }, gradient);
  }

  const lineGroup = svg('g', { class: 'sky-lines' }, field);
  const starGroup = svg('g', { class: 'sky-stars' }, field);
  const planetGroup = svg('g', { class: 'sky-planets' }, field);

  const moon = svg('svg', { class: 'sky-moon', overflow: 'visible' }, field);
  svg('circle', { class: 'sky-moon-glow', r: MOON_R * 4 }, moon);
  const moonFace = svg('g', {}, moon);
  svg('circle', { class: 'sky-moon-dark', r: MOON_R }, moonFace);
  const moonLit = svg('path', { class: 'sky-moon-lit' }, moonFace);
  svg('circle', { class: 'sky-moon-rim', r: MOON_R }, moonFace);

  const sun = svg('svg', { class: 'sky-sun', overflow: 'visible' }, field);
  svg('circle', { class: 'sky-sun-glow', r: SUN_R * 5 }, sun);
  svg('circle', { class: 'sky-sun-disc', r: SUN_R }, sun);

  const twinkles = document.createElement('div');
  twinkles.className = 'sky-twinkles';
  sky.prepend(field, twinkles);

  const epoch = MakeTime(new Date());
  const stars = zodiac.stars.map(([ra, dec, mag, bv]) => {
    let node: SVGCircleElement | HTMLElement;
    if (mag < TWINKLE_MAG) {
      node = document.createElement('span');
      node.className = 'sky-twinkle';
      node.style.setProperty('--r', `${starRadius(mag)}px`);
      node.style.setProperty('--tint', starTint(bv));
      node.style.setProperty('--phase', `${((ra * 7.3) % 5).toFixed(2)}s`);
      twinkles.append(node);
    } else {
      node = svg('circle', { r: starRadius(mag), fill: starTint(bv) }, starGroup);
    }
    return { mag, node, vector: VectorFromSphere(new Spherical(dec, ra, 1), epoch) };
  });

  const segments = Object.values(zodiac.lines).flatMap((polylines) =>
    polylines.flatMap((polyline) =>
      polyline.slice(1).map((to, i) => ({ from: polyline[i], to, node: svg('line', {}, lineGroup) })),
    ),
  );

  const planets = PLANETS.map((body) => ({
    body,
    node: svg('circle', { class: `sky-planet sky-planet--${body.toLowerCase()}` }, planetGroup),
  }));

  return function draw(fix: SkyFix) {
    const time = MakeTime(fix.date);
    const observer = new Observer(fix.lat, fix.lon, 0);
    const limit = faintest(fix.alt);

    /** Position as fractions of the viewport. `ahead` is degrees of azimuth from the middle of the view. */
    const project = (alt: number, az: number) => {
      const ahead = ((((az - fix.facing) % 360) + 540) % 360) - 180;
      return { x: 0.5 + ahead / 180, y: 1 - alt / 90, ahead, alt };
    };
    const inView = (at: { alt: number; ahead: number }, slack = 0) => at.alt > -slack && Math.abs(at.ahead) <= 90 + slack;
    const locate = (body: Body) => {
      const eq = Equator(body, time, observer, true, true);
      const hor = Horizon(time, observer, eq.ra, eq.dec, 'normal');
      return project(hor.altitude, hor.azimuth);
    };

    const toLocal = Rotation_EQJ_HOR(time, observer);
    const placed = stars.map((star) => {
      const local = HorizonFromVector(RotateVector(toLocal, star.vector), 'normal');
      const at = project(local.lat, local.lon);
      const opacity = glimmer(star.mag, limit);
      const visible = opacity > 0.02 && inView(at, 1);
      show(star.node, visible);
      if (visible && star.node instanceof HTMLElement) {
        star.node.style.left = pct(at.x);
        star.node.style.top = pct(at.y);
        star.node.style.opacity = opacity.toFixed(2);
      } else if (visible) {
        star.node.setAttribute('cx', pct(at.x));
        star.node.setAttribute('cy', pct(at.y));
        star.node.setAttribute('opacity', opacity.toFixed(2));
      }
      return at;
    });

    const figures = clamp((limit - 2) / 2.5, 0, 1);
    lineGroup.style.opacity = figures.toFixed(2);
    for (const { from, to, node } of segments) {
      const a = placed[from];
      const b = placed[to];
      const visible = figures > 0 && Math.abs(a.ahead - b.ahead) < 90 && (inView(a) || inView(b));
      show(node, visible);
      if (visible) {
        node.setAttribute('x1', pct(a.x));
        node.setAttribute('y1', pct(a.y));
        node.setAttribute('x2', pct(b.x));
        node.setAttribute('y2', pct(b.y));
      }
    }

    for (const { body, node } of planets) {
      const at = locate(body);
      const { mag } = Illumination(body, time);
      const opacity = glimmer(mag, limit);
      const visible = opacity > 0.02 && inView(at, 1);
      show(node, visible);
      if (visible) {
        node.setAttribute('cx', pct(at.x));
        node.setAttribute('cy', pct(at.y));
        node.setAttribute('r', clamp(2.4 - 0.3 * mag, 1.6, 3.4).toFixed(2));
        node.setAttribute('opacity', opacity.toFixed(2));
      }
    }

    const sunAt = locate(Body.Sun);
    show(sun, inView(sunAt, 2));
    sun.setAttribute('x', pct(sunAt.x));
    sun.setAttribute('y', pct(sunAt.y));

    const moonAt = locate(Body.Moon);
    show(moon, inView(moonAt, 2));
    moon.setAttribute('x', pct(moonAt.x));
    moon.setAttribute('y', pct(moonAt.y));

    // Lit fraction from the phase angle (0° full, 180° new): a semicircle on the bright side
    // closed by a half-ellipse terminator.
    const k = Math.cos(Illumination(Body.Moon, time).phase_angle * RAD);
    const rx = (Math.abs(k) * MOON_R).toFixed(2);
    moonLit.setAttribute('d', `M0 ${-MOON_R}A${MOON_R} ${MOON_R} 0 0 1 0 ${MOON_R}A${rx} ${MOON_R} 0 0 ${k > 0 ? 1 : 0} 0 ${-MOON_R}Z`);

    // The bright limb faces the sun along the great circle between them: its bearing from the
    // zenith toward increasing azimuth, carried onto the screen's uneven degrees per pixel.
    const dAz = (sunAt.ahead - moonAt.ahead) * RAD;
    const hs = sunAt.alt * RAD;
    const hm = moonAt.alt * RAD;
    const bearing = Math.atan2(
      Math.sin(dAz) * Math.cos(hs),
      Math.cos(hm) * Math.sin(hs) - Math.sin(hm) * Math.cos(hs) * Math.cos(dAz),
    );
    const dx = (Math.sin(bearing) / Math.max(0.2, Math.cos(hm))) * (sky.clientWidth / 180);
    const dy = -Math.cos(bearing) * (sky.clientHeight / 90);
    moonFace.setAttribute('transform', `rotate(${(Math.atan2(dy, dx) / RAD).toFixed(1)})`);
  };
}

const sky = document.querySelector<HTMLElement>('.sky');

if (sky) {
  const draw = raiseSky(sky);
  const tick = () => draw(lightSky());

  tick();
  setTimeout(
    () => {
      tick();
      setInterval(tick, 60_000);
    },
    60_000 - (Date.now() % 60_000),
  );
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') tick();
  });
  let frame = 0;
  addEventListener('resize', () => {
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(tick);
  });
}
