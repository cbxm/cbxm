/**
 * The sky in the header: the sun, the moon in its real phase, the planets, and the twelve
 * zodiac constellations, each where it really is for the viewer, redrawn every minute.
 * lightSky() sets the page's palette from the same moment. Pointing at (or tapping) any of
 * them lights it and names it.
 *
 * The band is the zodiac: the half of the ecliptic that is above the horizon, drawn in ecliptic
 * longitude across and ecliptic latitude up at the same pixels per degree both ways, so the
 * figures keep their shapes. The ecliptic and the horizon are both great circles, so exactly
 * 180° of longitude is up at any moment, from the point rising in the east to the point setting
 * in the west. Facing the equator from the north, the rising point is at the left edge and north
 * is up; from the south (by the same facing rule as sky-light.ts) the picture turns half round.
 * As the sky turns the window slides, so everything rises at one edge and sets at the other.
 *
 * Normally 180° spans the band's width. A band too short to show ±20° of latitude at that scale
 * (wide screens, and the strip) crops latitude; a band too narrow (phones) shows less longitude,
 * centred on the ecliptic's highest point. Neither stretches.
 *
 * The viewer is placed at their time zone's principal city (see sky-light.ts).
 */
import {
  Body,
  Equator,
  Illumination,
  InverseRotation,
  MakeTime,
  MoonPhase,
  Observer,
  RotateVector,
  Rotation_EQJ_ECT,
  Rotation_EQJ_HOR,
  SphereFromVector,
  Spherical,
  Vector,
  VectorFromSphere,
  type AstroTime,
  type RotationMatrix,
} from 'astronomy-engine';
import zodiac from '../lib/sky-stars.json';
import { lightSky, type SkyFix, type Theme } from './sky-light';

const RAD = Math.PI / 180;
const SVG_NS = 'http://www.w3.org/2000/svg';
/** Stars at least this bright twinkle. They are HTML rather than SVG so the compositor animates them. */
const TWINKLE_MAG = 2.5;
/** Radius in px of the invisible target around each star and planet. */
const HIT_R = 14;
/** Degrees of ecliptic latitude above and below the ecliptic that a narrow band keeps in view. */
const SHOWN_LATITUDE = 20;
/** Where the ecliptic runs, as a fraction of the band's height from the top. */
const ECLIPTIC_Y = 0.5;

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

/**
 * Ecliptic longitude (true ecliptic of date) of the point where the ecliptic crosses the eastern
 * horizon: where the horizon's plane meets the ecliptic's, on the east side.
 */
function risingPoint(time: AstroTime, observer: Observer, toEcliptic: RotationMatrix) {
  const fromHorizon = InverseRotation(Rotation_EQJ_HOR(time, observer));
  const toLocalEcliptic = (x: number, y: number, z: number) =>
    RotateVector(toEcliptic, RotateVector(fromHorizon, new Vector(x, y, z, time)));
  // Horizontal axes: x north, y west, z zenith.
  const zenith = toLocalEcliptic(0, 0, 1);
  const east = toLocalEcliptic(0, -1, 0);
  // The line along both planes is the ecliptic pole (0, 0, 1) crossed with the zenith.
  const side = -zenith.y * east.x + zenith.x * east.y < 0 ? -1 : 1;
  return Math.atan2(side * zenith.x, -side * zenith.y) / RAD;
}

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
  /** Where its label hangs from, in px within the sky, and how far the label keeps clear across and up or down. */
  x: number;
  y: number;
  rx: number;
  ry: number;
}

/** Builds the sky's bodies inside `.sky` and returns the function that moves them to a moment. */
function raiseSky(sky: HTMLElement, label: HTMLElement) {
  const strip = sky.dataset.band === 'strip';
  const sunR = strip ? 9 : 15;
  const moonR = strip ? 8 : 12;

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
    const item = { name, nodes, hit: svg('g', { 'data-item': id }, hits), x: 0, y: 0, rx: 0, ry: 0 };
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

  /**
   * Hangs the label inside the band and clear of the lit item: above, below, or level with it,
   * centred on it, beside it, or slid to an edge of the header's words. Of those slots it takes
   * the one covering the least of the words, then the nearest.
   */
  const placeLabel = () => {
    const item = lit ? items.get(lit) : undefined;
    label.hidden = !item;
    if (!item) return;
    label.textContent = item.name;
    const pad = 4;
    const w = label.offsetWidth;
    const h = label.offsetHeight;
    const width = sky.clientWidth;
    const height = sky.clientHeight;
    const band = sky.getBoundingClientRect();
    const taken = obstacles.map((o) => {
      const r = o.getBoundingClientRect();
      return { left: r.left - band.left, right: r.right - band.left, top: r.top - band.top, bottom: r.bottom - band.top };
    });
    const covered = ([x, y]: number[]) =>
      taken.reduce(
        (sum, r) =>
          sum + Math.max(0, Math.min(x + w, r.right) - Math.max(x, r.left)) * Math.max(0, Math.min(y + h, r.bottom) - Math.max(y, r.top)),
        0,
      );
    const distance = ([x, y]: number[]) => Math.hypot(x + w / 2 - item.x, y + h / 2 - item.y);

    const xs = [item.x - w / 2, item.x + item.rx, item.x - item.rx - w, ...taken.flatMap((r) => [r.right + pad, r.left - w - pad])];
    const ys = [item.y - item.ry - h, item.y + item.ry, item.y - h / 2];
    const clearOfItem = ([x, y]: number[]) =>
      x >= item.x + item.rx || x + w <= item.x - item.rx || y >= item.y + item.ry || y + h <= item.y - item.ry;
    const slots = ys
      .flatMap((y) => xs.map((x) => [clamp(x, pad, width - w - pad), clamp(y, pad, height - h - pad)]))
      .filter(clearOfItem)
      .sort((a, b) => covered(a) - covered(b) || distance(a) - distance(b));
    const [x, y] = slots[0] ?? [clamp(item.x - w / 2, pad, width - w - pad), clamp(item.y + item.ry, pad, height - h - pad)];
    label.style.translate = `${x.toFixed(1)}px ${y.toFixed(1)}px`;
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
    const scale = Math.max(width / 180, height / (2 * SHOWN_LATITUDE));
    const toEcliptic = Rotation_EQJ_ECT(time);
    const rising = risingPoint(time, observer, toEcliptic);
    const north = fix.facing === 180;

    /**
     * Position as fractions of the band. `along` is degrees of ecliptic longitude from the
     * window's middle, the ecliptic's highest point; the window runs from -90 (rising) to 90.
     */
    const project = (sphere: { lon: number; lat: number }) => {
      const along = ((((rising - sphere.lon - 90) % 360) + 540) % 360) - 180;
      const x = 0.5 + (along * scale) / width;
      const y = ECLIPTIC_Y - (sphere.lat * scale) / height;
      return { x: north ? x : 1 - x, y: north ? y : 2 * ECLIPTIC_Y - y, along };
    };
    const inView = (at: { x: number; y: number; along: number }, slack = 0) =>
      Math.abs(at.along) <= 90 + slack && at.x > -0.02 && at.x < 1.02 && at.y > -0.02 && at.y < 1.02;
    const ecliptic = (vector: Vector) => SphereFromVector(RotateVector(toEcliptic, vector));
    const locate = (body: Body) => {
      const eq = Equator(body, time, observer, false, true);
      const sphere = ecliptic(VectorFromSphere(new Spherical(eq.dec, eq.ra * 15, 1), time));
      return { ...project(sphere), lon: sphere.lon, lat: sphere.lat };
    };
    const anchor = (item: Item, at: { x: number; y: number }, rx: number, ry = rx) => {
      item.x = at.x * width;
      item.y = at.y * height;
      item.rx = rx;
      item.ry = ry;
    };
    const place = (node: Element, at: { x: number; y: number }, x = 'cx', y = 'cy') => {
      node.setAttribute(x, pct(at.x));
      node.setAttribute(y, pct(at.y));
    };

    const placed = stars.map((star) => {
      const at = project(ecliptic(star.vector));
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
        const visible = lines > 0 && Math.abs(a.along - b.along) < 90 && (inView(a) || inView(b));
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
        const xs = shown.map(({ i }) => placed[i].x);
        const ys = shown.map(({ i }) => placed[i].y);
        const [left, right, top, bottom] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
        anchor(item, { x: (left + right) / 2, y: (top + bottom) / 2 }, ((right - left) / 2) * width + 8, ((bottom - top) / 2) * height + 8);
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

    // On the ecliptic, the sun is in the window exactly while it is up.
    const sunAt = locate(Body.Sun);
    const sunVisible = fix.theme !== 'dark' && inView(sunAt, 1);
    show(sun, sunVisible);
    show(sunItem.hit, sunVisible);
    place(sun, sunAt, 'x', 'y');
    place(sunHit, sunAt);
    anchor(sunItem, sunAt, sunR + 6);

    const moonAt = locate(Body.Moon);
    const moonVisible = inView(moonAt, 1);
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

    // The bright limb faces the sun along the great circle between them: its bearing from
    // ecliptic north toward increasing longitude, which runs leftward with north up.
    const dLon = (sunAt.lon - moonAt.lon) * RAD;
    const bs = sunAt.lat * RAD;
    const bm = moonAt.lat * RAD;
    const bearing = Math.atan2(
      Math.sin(dLon) * Math.cos(bs),
      Math.cos(bm) * Math.sin(bs) - Math.sin(bm) * Math.cos(bs) * Math.cos(dLon),
    );
    const turn = north ? 1 : -1;
    moonFace.setAttribute(
      'transform',
      `rotate(${(Math.atan2(-Math.cos(bearing) * turn, -Math.sin(bearing) * turn) / RAD).toFixed(1)})`,
    );

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
  // Back in view, or restored from the back-forward cache: another tab may have changed the theme.
  const retheme = () => {
    draw(lightSky(true));
    nameToggle();
  };
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') retheme();
  });
  addEventListener('pageshow', (event) => {
    if (event.persisted) retheme();
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
