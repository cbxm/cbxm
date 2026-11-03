import { getCollection, type CollectionEntry } from 'astro:content';

export type Piece = CollectionEntry<'garden'>;

/** All pieces, newest first. */
export async function getGarden(): Promise<Piece[]> {
  const pieces = await getCollection('garden');
  return pieces.sort((a, b) => b.data.date.valueOf() - a.data.date.valueOf());
}

export const pieceHref = (piece: Piece) => `/ander/${piece.id}`;

/** Margin of open ground around the outermost plants, in map pixels. */
const MARGIN = { x: 900, y: 700 };
/** Smallest field, so a sparse garden still fills a large screen. */
const MIN = { width: 2400, height: 1800 };

/**
 * The rectangle of map space the field covers. It always contains the origin,
 * so the map can open centered on (0, 0).
 */
export function fieldBounds(pieces: Piece[]) {
  const xs = [0, ...pieces.map((p) => p.data.x)];
  const ys = [0, ...pieces.map((p) => p.data.y)];
  let left = Math.min(...xs) - MARGIN.x;
  let right = Math.max(...xs) + MARGIN.x;
  let top = Math.min(...ys) - MARGIN.y;
  let bottom = Math.max(...ys) + MARGIN.y;
  const padX = Math.max(0, MIN.width - (right - left)) / 2;
  const padY = Math.max(0, MIN.height - (bottom - top)) / 2;
  left -= padX;
  right += padX;
  top -= padY;
  bottom += padY;
  return { left, top, width: right - left, height: bottom - top };
}

/**
 * Stable per-piece variation so plants of the same stage don't look stamped:
 * a mirror flip, a slight lean, and a slight size change, all derived from the slug.
 */
export function plantVariation(slug: string) {
  let h = 2166136261;
  for (let i = 0; i < slug.length; i++) {
    h ^= slug.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  const unit = (shift: number) => ((h >>> shift) & 0xff) / 0xff;
  return {
    flip: (h & 1) === 1,
    lean: (unit(8) - 0.5) * 8,
    scale: 0.92 + unit(16) * 0.16,
  };
}
