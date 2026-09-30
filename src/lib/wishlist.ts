import type { Copy, WishlistItem } from '../db/schema';
import { bestOwned, FORMAT_RANK, satisfies } from './formats';

type CopyLike = Pick<Copy, 'id' | 'format' | 'ownership' | 'reviewStatus'>;

/** A copy counts towards the wishlist only once it is confirmed as legitimately owned. */
export const countsAsOwned = (c: Pick<Copy, 'ownership' | 'reviewStatus'>) => c.ownership === 'owned' && c.reviewStatus === 'confirmed';

/** The best copy that fulfils a wishlist item, or null. */
export function fulfillingCopy(item: Pick<WishlistItem, 'targetFormat'>, copies: CopyLike[]) {
  return (
    copies
      .filter((c) => countsAsOwned(c) && satisfies(c.format, item.targetFormat))
      .sort((a, b) => FORMAT_RANK[b.format] - FORMAT_RANK[a.format])[0] ?? null
  );
}

/**
 * Decide what kind of wishlist item to create for a movie: an upgrade when you already
 * own it in a lower format, a new purchase otherwise (pirated copies don't count).
 * Returns null when an owned copy already satisfies the target.
 */
export function planWishlistItem(targetFormat: 'bluray' | 'uhd', copies: CopyLike[]) {
  const owned = copies.filter(countsAsOwned);
  const best = bestOwned(owned);
  if (best && satisfies(best, targetFormat)) return null;
  const fromCopy = owned.sort((a, b) => FORMAT_RANK[b.format] - FORMAT_RANK[a.format])[0] ?? null;
  return { kind: fromCopy ? ('upgrade' as const) : ('new' as const), fromCopyId: fromCopy?.id ?? null };
}
