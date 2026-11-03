/**
 * Behavior for the /ander map: open centered on the origin (or on the plant
 * named in the URL hash), drag to pan with momentum, zoom with a pinch or
 * ctrl+wheel, keep the legend and the plants pointing at each other, and light a
 * plant's roots and the plants they reach. The map is a native scroll container,
 * so trackpads, wheels and touch scroll it without any help from here.
 *
 * Zoom is CSS `zoom` on the field, driven by its `--zoom` property, so the field
 * lays out at the zoomed size: text stays sharp and the scroll extents follow.
 * Positions read from the field (offsetLeft, data-origin-*, data-width/height) are in
 * unzoomed field pixels; scroll offsets are in screen pixels, which is the same thing
 * times the zoom.
 */

const DRAG_THRESHOLD = 4;
const FRICTION = 0.92;
/** Pause (ms) between the last move and release after which a drag ends without gliding. */
const GLIDE_CUTOFF = 80;
/** A plant's anchor is its base; aim this far above it so the plant and label both show. */
const PLANT_AIM = 40;
/** localStorage key for whether the legend is folded. */
const FOLDED_KEY = 'cbxm:legend-folded';
/** Zoom range. Zooming out also stops where the field would no longer fill the map. */
const MIN_ZOOM = 0.5;
const MAX_ZOOM = 2.5;
/**
 * Zoom changes by e^(-delta * ZOOM_RATE) for a wheel delta in pixels. Chromium reports a pinch as
 * ctrl+wheel with deltaY = -100 * ln(scale), so this rate makes a pinch track the fingers exactly.
 */
const ZOOM_RATE = 0.01;
/** Largest delta one wheel event may apply, so a mouse notch (100px or more) zooms by about 20%. */
const ZOOM_STEP = 20;
/** Pixels per line, for wheels that report in lines (Firefox with ctrl held). */
const LINE_HEIGHT = 16;

export function plantGardenMap() {
  const map = document.querySelector<HTMLElement>('.map');
  const field = map?.querySelector<HTMLElement>('.field');
  if (!map || !field) return;

  const wide = window.matchMedia('(min-width: 48rem)');
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const originX = Number(field.dataset.originX);
  const originY = Number(field.dataset.originY);

  const fieldWidth = Number(field.dataset.width);
  const fieldHeight = Number(field.dataset.height);
  let zoom = 1;

  const sprigFor = (slug: string | undefined) =>
    slug ? field.querySelector<HTMLElement>(`.sprig[data-slug="${CSS.escape(slug)}"]`) : null;

  const legend = document.querySelector<HTMLElement>('.index');

  /** Width along the map's left edge that the legend covers; the view's middle is measured from there. */
  const legendCover = () => {
    if (!legend) return 0;
    const cover = legend.getBoundingClientRect().right - map.getBoundingClientRect().left;
    return Math.min(Math.max(0, cover), map.clientWidth / 2);
  };

  /** Scroll so field point (x, y) sits in the middle of the part of the map the legend leaves open. */
  const centerOn = (x: number, y: number, behavior: ScrollBehavior = 'auto') => {
    const cover = legendCover();
    map.scrollTo({
      left: x * zoom - (cover + (map.clientWidth - cover) / 2),
      top: y * zoom - map.clientHeight / 2,
      behavior: reducedMotion.matches ? 'auto' : behavior,
    });
  };

  const centerOnSprig = (sprig: HTMLElement, behavior: ScrollBehavior) =>
    centerOn(sprig.offsetLeft, sprig.offsetTop - PLANT_AIM, behavior);

  const roots = [...field.querySelectorAll<SVGGElement>('.root')];

  /** Light a plant, the roots joining it to others, and the plants at their other ends. */
  const light = (sprig: HTMLElement | null) => {
    field.querySelectorAll('.is-lit, .is-kin').forEach((el) => el.classList.remove('is-lit', 'is-kin'));
    const slug = sprig?.dataset.slug;
    if (!sprig || !slug) return;
    sprig.classList.add('is-lit');
    for (const root of roots) {
      const { from, to } = root.dataset;
      if (from !== slug && to !== slug) continue;
      root.classList.add('is-lit');
      sprigFor(from === slug ? to : from)?.classList.add('is-kin');
    }
  };

  // The legend folds down to its title, and stays as the reader left it.
  // Fold before the view is placed, so centering measures the legend as it will be.
  const fold = legend?.querySelector<HTMLButtonElement>('.fold');
  const setFolded = (folded: boolean) => {
    legend?.classList.toggle('is-folded', folded);
    fold?.setAttribute('aria-expanded', String(!folded));
    fold?.setAttribute('aria-label', folded ? 'show the list' : 'hide the list');
  };
  try {
    setFolded(localStorage.getItem(FOLDED_KEY) === 'true');
  } catch {
    // Storage can be unavailable (private windows, blocked site data); the legend just starts open.
  }
  fold?.addEventListener('click', () => {
    const folded = fold.getAttribute('aria-expanded') === 'true';
    legend?.classList.add('is-turning');
    setFolded(folded);
    try {
      localStorage.setItem(FOLDED_KEY, String(folded));
    } catch {
      // Not remembered this time.
    }
  });

  const placeView = () => {
    if (!wide.matches) return;
    const target = sprigFor(decodeURIComponent(location.hash.slice(1)));
    if (target) {
      centerOnSprig(target, 'auto');
      light(target);
    } else {
      centerOn(originX, originY);
    }
  };
  placeView();
  wide.addEventListener('change', placeView);

  // Drag to pan with mouse or pen. Touch already pans natively.
  // A drag starts on the map but is followed on the window: until the pointer is
  // captured past the threshold, it can wander onto the legend or header, and the
  // release has to end the drag wherever it lands. Capturing at pointerdown instead
  // would retarget the click to the map, so plants could no longer be clicked.
  let drag: { x: number; y: number; left: number; top: number; moved: boolean } | null = null;
  let velocity = { x: 0, y: 0 };
  let last = { x: 0, y: 0, t: 0 };
  let glide = 0;
  let swallowClick = false;

  map.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'touch' || e.button !== 0) return;
    cancelAnimationFrame(glide);
    drag = { x: e.clientX, y: e.clientY, left: map.scrollLeft, top: map.scrollTop, moved: false };
    velocity = { x: 0, y: 0 };
    last = { x: e.clientX, y: e.clientY, t: e.timeStamp };
  });

  window.addEventListener('pointermove', (e) => {
    if (!drag) return;
    // No primary button means the release happened somewhere this page never heard about.
    if ((e.buttons & 1) === 0) return endDrag(e);
    const dx = e.clientX - drag.x;
    const dy = e.clientY - drag.y;
    if (!drag.moved) {
      if (Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
      drag.moved = true;
      map.setPointerCapture(e.pointerId);
      map.classList.add('is-dragging');
    }
    map.scrollLeft = drag.left - dx;
    map.scrollTop = drag.top - dy;
    const dt = Math.max(1, e.timeStamp - last.t);
    velocity = { x: (e.clientX - last.x) / dt, y: (e.clientY - last.y) / dt };
    last = { x: e.clientX, y: e.clientY, t: e.timeStamp };
  });

  const endDrag = (e: PointerEvent) => {
    if (!drag) return;
    const { moved } = drag;
    drag = null;
    map.classList.remove('is-dragging');
    if (!moved) return;
    // The click that follows a drag must not open the plant the drag started on.
    swallowClick = true;
    setTimeout(() => (swallowClick = false));
    if (reducedMotion.matches || e.timeStamp - last.t > GLIDE_CUTOFF) return;
    let vx = velocity.x * 16;
    let vy = velocity.y * 16;
    const step = () => {
      vx *= FRICTION;
      vy *= FRICTION;
      if (Math.hypot(vx, vy) < 0.3) return;
      map.scrollLeft -= vx;
      map.scrollTop -= vy;
      glide = requestAnimationFrame(step);
    };
    glide = requestAnimationFrame(step);
  };
  window.addEventListener('pointerup', endDrag);
  window.addEventListener('pointercancel', endDrag);

  /** Smallest zoom: MIN_ZOOM, or where the field just fills the map if that comes first. Never above 1. */
  const minZoom = () =>
    Math.min(1, Math.max(MIN_ZOOM, map.clientWidth / fieldWidth, map.clientHeight / fieldHeight));

  /** Zoom to `next`, keeping the field point under (clientX, clientY) where it is on screen. */
  const zoomAt = (next: number, clientX: number, clientY: number) => {
    next = Math.min(MAX_ZOOM, Math.max(minZoom(), next));
    if (next === zoom) return;
    const rect = map.getBoundingClientRect();
    const x = clientX - rect.left;
    const y = clientY - rect.top;
    const before = { left: map.scrollLeft, top: map.scrollTop };
    const fieldX = (before.left + x) / zoom;
    const fieldY = (before.top + y) / zoom;
    zoom = next;
    field.style.setProperty('--zoom', String(zoom));
    map.scrollLeft = fieldX * zoom - x;
    map.scrollTop = fieldY * zoom - y;
    // A drag under way carries on from where the zoom moved the view.
    if (drag) {
      drag.left += map.scrollLeft - before.left;
      drag.top += map.scrollTop - before.top;
    }
  };

  // A map that grows can outgrow a zoomed-out field; zoom back in until the field fills it.
  new ResizeObserver(() => {
    const rect = map.getBoundingClientRect();
    zoomAt(zoom, rect.left + rect.width / 2, rect.top + rect.height / 2);
  }).observe(map);

  // A plain wheel or two-finger swipe scrolls natively. With ctrl held, which is also how
  // Chromium and Firefox report a trackpad pinch, it zooms the map instead of the page.
  map.addEventListener(
    'wheel',
    (e) => {
      cancelAnimationFrame(glide);
      if (!e.ctrlKey) return;
      e.preventDefault();
      const unit =
        e.deltaMode === WheelEvent.DOM_DELTA_LINE ? LINE_HEIGHT : e.deltaMode === WheelEvent.DOM_DELTA_PAGE ? map.clientHeight : 1;
      const delta = Math.min(ZOOM_STEP, Math.max(-ZOOM_STEP, e.deltaY * unit));
      zoomAt(zoom * Math.exp(-delta * ZOOM_RATE), e.clientX, e.clientY);
    },
    { passive: false },
  );

  // Safari reports a trackpad pinch as its own gesture events, with the scale since the pinch began.
  type GestureEvent = UIEvent & { scale: number; clientX: number; clientY: number };
  let pinchFrom = 1;
  map.addEventListener('gesturestart', (e) => {
    e.preventDefault();
    pinchFrom = zoom;
  });
  map.addEventListener('gesturechange', (e) => {
    e.preventDefault();
    const { scale, clientX, clientY } = e as GestureEvent;
    zoomAt(pinchFrom * scale, clientX, clientY);
  });
  map.addEventListener(
    'click',
    (e) => {
      if (!swallowClick) return;
      e.preventDefault();
      e.stopPropagation();
    },
    { capture: true },
  );

  field.querySelectorAll<HTMLAnchorElement>('a.sprig').forEach((sprig) => {
    sprig.addEventListener('pointerenter', () => light(sprig));
    sprig.addEventListener('pointerleave', () => light(null));
    // Remember which plant a reader left from, so returning to the map lands there.
    sprig.addEventListener('click', () => history.replaceState(null, '', `#${sprig.dataset.slug}`));
  });

  // The legend lights its plant on hover, and brings it into view on keyboard focus.
  document.querySelectorAll<HTMLElement>('.pieces li').forEach((item) => {
    const sprig = sprigFor(item.dataset.slug);
    if (!sprig) return;
    item.addEventListener('pointerenter', () => light(sprig));
    item.addEventListener('pointerleave', () => light(null));
    item.addEventListener('focusin', () => {
      if (!wide.matches) return;
      light(sprig);
      centerOnSprig(sprig, 'smooth');
    });
    item.addEventListener('focusout', () => light(null));
  });
}
