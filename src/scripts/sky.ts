/**
 * The sky in the header: the sun, the moon in its real phase, the planets, and the twelve
 * zodiac constellations, each where it really is for the viewer, redrawn every minute.
 * lightSky() sets the page's palette from the same moment. Pointing at (or tapping) any of
 * them lights it and names it.
 *
 * The view is a 180° panorama facing the side of the sky where the sun crosses the meridian
 * that day, so the sun always passes through it: south for most of the northern hemisphere,
 * north for most of the southern, and either in the tropics as the seasons turn. Azimuth runs
 * evenly across the band and altitude up it, from the horizon (sky.css's --horizon) to the
 * zenith at the top edge. Facing south, east is on the left, so everything rises on the left
 * and sets on the right; facing north it is the other way round. Whatever is below the horizon
 * or behind the viewer is not drawn. In the header's strip, altitude is squashed into a few
 * rem while the discs and dots keep their size, so the figures flatten.
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
  MoonPhase,
  Observer,
  RotateVector,
  Rotation_EQJ_HOR,
  Spherical,
  VectorFromSphere,
} from 'astronomy-engine';
import zodiac from '../lib/sky-stars.json';
import { lightSky, type SkyFix, type Theme } from './sky-light';

const RAD = Math.PI / 180;
const SVG_NS = 'http://www.w3.org/2000/svg';
/** Stars at least this bright twinkle. They are HTML rather than SVG so the compositor animates them. */
const TWINKLE_MAG = 2.5;
/** Radius in px of the invisible target around each star and planet. */
const HIT_R = 14;

const PLANETS = [Body.Mercury, Body.Venus, Body.Mars, Body.Jupiter, Body.Saturn, Body.Uranus, Body.Neptune, Body.Pluto];
/** Planets fainter than this (Uranus, Neptune, Pluto) show as the faintest stars do. */
const FAINTEST_PLANET = 6;

/** Labels for the figures, by the names of their zodiac signs. */
const FIGURE_NAMES: Record<string, string> = {
  Ari: 'aries',
  Tau: 'taurus',
  Gem: 'gemini',
  Cnc: 'cancer',
  Leo: 'leo',
  Vir: 'virgo',
  Lib: 'libra',
  Sco: 'scorpio',
  Sgr: 'sagittarius',
  Cap: 'capricorn',
  Aqr: 'aquarius',
  Psc: 'pisces',
};

/**
 * The moon's phase from its elongation `e` east of the sun (0° new, 180° full): the four
 * principal phases within about half a day of their moment, the four between them otherwise.
 */
function moonPhase(e: number) {
  const quarter = Math.round(e / 90);
  if (Math.abs(e - quarter * 90) < 7) return ['new', 'first quarter', 'full', 'last quarter'][quarter % 4];
  return ['waxing crescent', 'waxing gibbous', 'waning gibbous', 'waning crescent'][Math.floor(e / 90)];
}

/** Faintest magnitude that shows with the sun at `sunAlt`: nothing until night, everything by 16° down. */
const faintest = (sunAlt: number) => (sunAlt > -4 ? -Infinity : 1 + (-4 - sunAlt) * 0.45);

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

/** Opacity of a point of light of magnitude `mag` in a sky that shows down to `limit`. */
const glimmer = (mag: number, limit: number) => clamp((limit - mag) / 1.5, 0, 1) * clamp(1.15 - 0.15 * mag, 0.3, 1);

const starRadius = (mag: number) => clamp(2.7 - 0.4 * mag, 0.7, 3.2);

/** A star's tint class from its B-V colour index (tokens.css --star-0 to --star-4). */
const starTint = (bv: number) => `tint-${bv < 0 ? 0 : bv < 0.4 ? 1 : bv < 0.8 ? 2 : bv < 1.3 ? 3 : 4}`;

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

/** Something in the sky that lights and names itself under the pointer. */
interface Item {
  name: string;
  /** What lights up. */
  nodes: Element[];
  /** Its invisible targets, tagged with the item's id. */
  hit: SVGGElement;
  /** Where its label hangs from, in px within the sky, and how far the label keeps clear. */
  x: number;
  y: number;
  reach: number;
}

/** Builds the sky's bodies inside `.sky` and returns the function that moves them to a moment. */
function raiseSky(sky: HTMLElement, label: HTMLElement) {
  const strip = sky.dataset.band === 'strip';
  const sunR = strip ? 9 : 15;
  const moonR = strip ? 8 : 12;
  const horizon = parseFloat(getComputedStyle(sky).getPropertyValue('--horizon')) / 100;

  const field = svg('svg', { class: 'sky-bodies' });
  const defs = svg('defs', {}, field);
  for (const id of ['sky-sun-glow', 'sky-moon-glow']) {
    const gradient = svg('radialGradient', { id }, defs);
    svg('stop', { offset: 0 }, gradient);
    svg('stop', { offset: 1 }, gradient);
  }

  const lineGroup = svg('g', { class: 'sky-lines' }, field);
  const starGroup = svg('g', { class: 'sky-stars' }, field);

  const moon = svg('svg', { class: 'sky-moon', overflow: 'visible' }, field);
  svg('circle', { class: 'sky-moon-glow', r: moonR * 4 }, moon);
  const moonFace = svg('g', {}, moon);
  svg('circle', { class: 'sky-moon-dark', r: moonR }, moonFace);
  const moonLit = svg('path', { class: 'sky-moon-lit' }, moonFace);
  svg('circle', { class: 'sky-moon-rim', r: moonR }, moonFace);

  const sun = svg('svg', { class: 'sky-sun', overflow: 'visible' }, field);
  svg('circle', { class: 'sky-sun-glow', r: sunR * 5 }, sun);
  svg('circle', { class: 'sky-sun-disc', r: sunR }, sun);

  // Planets over the discs: the drawn moon is wider than the real one, and a planet beside it would vanish.
  const planetGroup = svg('g', { class: 'sky-planets' }, field);
  const hits = svg('g', { class: 'sky-hits' }, field);

  const twinkles = document.createElement('div');
  twinkles.className = 'sky-twinkles';
  sky.prepend(field, twinkles);

  const items = new Map<string, Item>();
  const addItem = (id: string, name: string, nodes: Element[]) => {
    const item = { name, nodes, hit: svg('g', { 'data-item': id }, hits), x: 0, y: 0, reach: 0 };
    items.set(id, item);
    return item;
  };

  const epoch = MakeTime(new Date());
  const stars = zodiac.stars.map(([ra, dec, mag, bv]) => {
    let node: SVGCircleElement | HTMLElement;
    if (mag < TWINKLE_MAG) {
      node = document.createElement('span');
      node.className = `sky-twinkle ${starTint(bv)}`;
      node.style.setProperty('--r', `${starRadius(mag)}px`);
      node.style.setProperty('--phase', `${((ra * 7.3) % 5).toFixed(2)}s`);
      twinkles.append(node);
    } else {
      node = svg('circle', { r: starRadius(mag), class: starTint(bv) }, starGroup);
    }
    return { mag, node, vector: VectorFromSphere(new Spherical(dec, ra, 1), epoch) };
  });

  const figures = Object.entries(zodiac.lines).map(([abbr, polylines]) => {
    const members = [...new Set(polylines.flat())];
    const segments = polylines.flatMap((polyline) =>
      polyline.slice(1).map((to, i) => ({ from: polyline[i], to, node: svg('line', {}, lineGroup) })),
    );
    const item = addItem(abbr, FIGURE_NAMES[abbr], [
      ...members.map((i) => stars[i].node),
      ...segments.map((segment) => segment.node),
    ]);
    return {
      item,
      members: members.map((i) => ({ i, hit: svg('circle', { r: HIT_R }, item.hit) })),
      segments: segments.map((segment) => ({ ...segment, hit: svg('line', {}, item.hit) })),
    };
  });

  // Targets stack smallest on top, so a planet beside the moon can still be found.
  const sunItem = addItem('sun', 'sun', [sun]);
  const sunHit = svg('circle', { r: sunR + 10 }, sunItem.hit);
  const moonItem = addItem('moon', 'moon', [moon]);
  const moonHit = svg('circle', { r: moonR + 10 }, moonItem.hit);

  const planets = PLANETS.map((body) => {
    const node = svg('circle', { class: `sky-planet sky-planet--${body.toLowerCase()}` }, planetGroup);
    const item = addItem(body, body.toLowerCase(), [node]);
    return { body, node, item, hit: svg('circle', { r: HIT_R }, item.hit) };
  });

  let lit: string | undefined;

  // The header's wordmark, nav, and theme button (Base.astro), which a label must not cover.
  const obstacles = [...(label.parentElement?.querySelectorAll('.wordmark, .header-end') ?? [])];

  /** Hangs the label above the lit item, or below it when the room above is off the band or taken. */
  const placeLabel = () => {
    const item = lit ? items.get(lit) : undefined;
    label.hidden = !item;
    if (!item) return;
    label.textContent = item.name;
    const pad = 4;
    const w = label.offsetWidth;
    const h = label.offsetHeight;
    const band = sky.getBoundingClientRect();
    const left = clamp(item.x - w / 2, pad, sky.clientWidth - w - pad);
    const covers = (top: number) =>
      obstacles.some((o) => {
        const r = o.getBoundingClientRect();
        return left < r.right - band.left && left + w > r.left - band.left && top < r.bottom - band.top && top + h > r.top - band.top;
      });
    const above = item.y - item.reach - h;
    const top = above >= pad && !covers(above) ? above : Math.min(item.y + item.reach, sky.clientHeight - h - pad);
    label.style.translate = `${left.toFixed(1)}px ${top.toFixed(1)}px`;
  };

  const light = (id: string | undefined) => {
    if (id === lit) return;
    for (const node of (lit && items.get(lit)?.nodes) || []) node.classList.remove('is-lit');
    lit = id;
    for (const node of (lit && items.get(lit)?.nodes) || []) node.classList.add('is-lit');
    placeLabel();
  };

  const itemAt = (target: EventTarget | null) =>
    target instanceof Element ? target.closest<SVGElement>('[data-item]')?.dataset.item : undefined;

  // A mouse lights what it is over; a touch lights what it taps, until it taps elsewhere.
  hits.addEventListener('pointerover', (event) => {
    if (event.pointerType === 'mouse') light(itemAt(event.target));
  });
  hits.addEventListener('pointerout', (event) => {
    if (event.pointerType === 'mouse' && itemAt(event.relatedTarget) !== lit) light(undefined);
  });
  hits.addEventListener('click', (event) => light(itemAt(event.target)));
  document.addEventListener('pointerdown', (event) => {
    if (!itemAt(event.target)) light(undefined);
  });

  return function draw(fix: SkyFix) {
    const time = MakeTime(fix.date);
    const observer = new Observer(fix.lat, fix.lon, 0);
    // The light theme keeps a day sky, the dark theme a sky at full dark.
    const limit = fix.theme === 'light' ? -Infinity : faintest(fix.theme === 'dark' ? -18 : fix.alt);
    const width = sky.clientWidth;
    const height = sky.clientHeight;

    /** Position as fractions of the band. `ahead` is degrees of azimuth from the middle of the view. */
    const project = (alt: number, az: number) => {
      const ahead = ((((az - fix.facing) % 360) + 540) % 360) - 180;
      return { x: 0.5 + ahead / 180, y: horizon * (1 - alt / 90), ahead, alt };
    };
    const inView = (at: { alt: number; ahead: number }, slack = 0) => at.alt > -slack && Math.abs(at.ahead) <= 90 + slack;
    const locate = (body: Body) => {
      const eq = Equator(body, time, observer, true, true);
      const hor = Horizon(time, observer, eq.ra, eq.dec, 'normal');
      return project(hor.altitude, hor.azimuth);
    };
    const anchor = (item: Item, at: { x: number; y: number }, reach: number) => {
      item.x = at.x * width;
      item.y = at.y * height;
      item.reach = reach;
    };
    const place = (node: Element, at: { x: number; y: number }, x = 'cx', y = 'cy') => {
      node.setAttribute(x, pct(at.x));
      node.setAttribute(y, pct(at.y));
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
        place(star.node, at);
        star.node.setAttribute('opacity', opacity.toFixed(2));
      }
      return { ...at, visible };
    });

    const lines = clamp((limit - 2) / 2.5, 0, 1);
    lineGroup.style.opacity = lines.toFixed(2);
    for (const { item, members, segments } of figures) {
      const shown = members.filter(({ i }) => placed[i].visible);
      for (const { i, hit } of members) {
        show(hit, placed[i].visible);
        if (placed[i].visible) place(hit, placed[i]);
      }
      for (const { from, to, node, hit } of segments) {
        const a = placed[from];
        const b = placed[to];
        const visible = lines > 0 && Math.abs(a.ahead - b.ahead) < 90 && (inView(a) || inView(b));
        show(node, visible);
        show(hit, visible);
        if (visible) {
          for (const line of [node, hit]) {
            place(line, a, 'x1', 'y1');
            place(line, b, 'x2', 'y2');
          }
        }
      }
      show(item.hit, shown.length > 0);
      if (shown.length) {
        const ys = shown.map(({ i }) => placed[i].y);
        const top = Math.min(...ys);
        const bottom = Math.max(...ys);
        const x = shown.reduce((sum, { i }) => sum + placed[i].x, 0) / shown.length;
        anchor(item, { x, y: (top + bottom) / 2 }, ((bottom - top) / 2) * height + 8);
      }
    }

    for (const { body, node, item, hit } of planets) {
      const at = locate(body);
      const mag = Math.min(FAINTEST_PLANET, Illumination(body, time).mag);
      const opacity = glimmer(mag, limit);
      const visible = opacity > 0.02 && inView(at, 1);
      show(node, visible);
      show(item.hit, visible);
      if (visible) {
        place(node, at);
        place(hit, at);
        node.setAttribute('r', clamp(2.4 - 0.3 * mag, 1.6, 3.4).toFixed(2));
        node.setAttribute('opacity', opacity.toFixed(2));
        anchor(item, at, 8);
      }
    }

    const sunAt = locate(Body.Sun);
    const sunVisible = fix.theme !== 'dark' && inView(sunAt, 2);
    show(sun, sunVisible);
    show(sunItem.hit, sunVisible);
    place(sun, sunAt, 'x', 'y');
    place(sunHit, sunAt);
    anchor(sunItem, sunAt, sunR + 6);

    const moonAt = locate(Body.Moon);
    const moonVisible = inView(moonAt, 2);
    show(moon, moonVisible);
    show(moonItem.hit, moonVisible);
    place(moon, moonAt, 'x', 'y');
    place(moonHit, moonAt);
    anchor(moonItem, moonAt, moonR + 6);
    moonItem.name = `moon, ${moonPhase(MoonPhase(time))}`;

    // Lit fraction from the phase angle (0° full, 180° new): a semicircle on the bright side
    // closed by a half-ellipse terminator.
    const k = Math.cos(Illumination(Body.Moon, time).phase_angle * RAD);
    const rx = (Math.abs(k) * moonR).toFixed(2);
    moonLit.setAttribute('d', `M0 ${-moonR}A${moonR} ${moonR} 0 0 1 0 ${moonR}A${rx} ${moonR} 0 0 ${k > 0 ? 1 : 0} 0 ${-moonR}Z`);

    // The bright limb faces the sun along the great circle between them: its bearing from the
    // zenith toward increasing azimuth, carried onto the band's uneven degrees per pixel.
    const dAz = (sunAt.ahead - moonAt.ahead) * RAD;
    const hs = sunAt.alt * RAD;
    const hm = moonAt.alt * RAD;
    const bearing = Math.atan2(
      Math.sin(dAz) * Math.cos(hs),
      Math.cos(hm) * Math.sin(hs) - Math.sin(hm) * Math.cos(hs) * Math.cos(dAz),
    );
    const dx = (Math.sin(bearing) / Math.max(0.2, Math.cos(hm))) * (width / 180);
    const dy = -Math.cos(bearing) * ((height * horizon) / 90);
    moonFace.setAttribute('transform', `rotate(${(Math.atan2(dy, dx) / RAD).toFixed(1)})`);

    // Whatever is lit may have moved, or set.
    if (lit && items.get(lit)?.hit.style.display === 'none') light(undefined);
    else placeLabel();
  };
}

const sky = document.querySelector<HTMLElement>('.sky');
const label = document.querySelector<HTMLElement>('.sky-label');

if (sky && label) {
  const draw = raiseSky(sky, label);
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

  // The theme button cycles light → dynamic → dark and saves the choice for later pages.
  const toggle = document.querySelector<HTMLButtonElement>('.theme');
  const themes: Theme[] = ['light', 'dynamic', 'dark'];
  const root = document.documentElement;
  const after = (theme: Theme) => themes[(themes.indexOf(theme) + 1) % themes.length];
  const nameToggle = () => {
    const theme = root.dataset.theme as Theme;
    const name = `${theme} theme, switch to ${after(theme)}`;
    toggle?.setAttribute('aria-label', name);
    if (toggle) toggle.title = name;
  };
  nameToggle();
  toggle?.addEventListener('click', () => {
    const theme = after(root.dataset.theme as Theme);
    root.dataset.theme = theme;
    try {
      localStorage.setItem('sky-theme', theme);
    } catch {}
    nameToggle();
    tick();
  });
}
