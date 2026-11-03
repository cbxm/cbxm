/**
 * Behavior for the /meander map: open centered on the origin (or on the plant
 * named in the URL hash), drag to pan with momentum, and keep the legend and the
 * plants pointing at each other. The map is a native scroll container, so
 * trackpads, wheels and touch scroll it without any help from here.
 */

const DRAG_THRESHOLD = 4;
const FRICTION = 0.92;
/** Pause (ms) between the last move and release after which a drag ends without gliding. */
const GLIDE_CUTOFF = 80;
/** A plant's anchor is its base; aim this far above it so the plant and label both show. */
const PLANT_AIM = 40;

export function plantGardenMap() {
  const map = document.querySelector<HTMLElement>('.map');
  const field = map?.querySelector<HTMLElement>('.field');
  if (!map || !field) return;

  const wide = window.matchMedia('(min-width: 48rem)');
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const originX = Number(field.dataset.originX);
  const originY = Number(field.dataset.originY);

  const sprigFor = (slug: string | undefined) =>
    slug ? field.querySelector<HTMLElement>(`.sprig[data-slug="${CSS.escape(slug)}"]`) : null;

  /** Scroll so field point (x, y) sits in the middle of the view. */
  const centerOn = (x: number, y: number, behavior: ScrollBehavior = 'auto') => {
    map.scrollTo({
      left: x - map.clientWidth / 2,
      top: y - map.clientHeight / 2,
      behavior: reducedMotion.matches ? 'auto' : behavior,
    });
  };

  const centerOnSprig = (sprig: HTMLElement, behavior: ScrollBehavior) =>
    centerOn(sprig.offsetLeft, sprig.offsetTop - PLANT_AIM, behavior);

  let lit: HTMLElement | null = null;
  const light = (sprig: HTMLElement | null) => {
    lit?.classList.remove('is-lit');
    sprig?.classList.add('is-lit');
    lit = sprig;
  };

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

  map.addEventListener('pointermove', (e) => {
    if (!drag) return;
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
  map.addEventListener('pointerup', endDrag);
  map.addEventListener('pointercancel', endDrag);
  map.addEventListener('wheel', () => cancelAnimationFrame(glide), { passive: true });
  map.addEventListener(
    'click',
    (e) => {
      if (!swallowClick) return;
      e.preventDefault();
      e.stopPropagation();
    },
    { capture: true },
  );

  // Remember which plant a reader left from, so returning to the map lands there.
  field.querySelectorAll<HTMLAnchorElement>('a.sprig').forEach((sprig) => {
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
