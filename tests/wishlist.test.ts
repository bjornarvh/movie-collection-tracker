import { describe, expect, it } from 'vitest';
import { fulfillingCopy, planWishlistItem } from '../src/lib/wishlist';

const copy = (id: number, format: 'dvd' | 'digital' | 'bluray' | 'uhd', ownership: 'owned' | 'pirated' | 'unverified' = 'owned', reviewStatus: 'confirmed' | 'needs_review' = 'confirmed') => ({
  id,
  format,
  ownership,
  reviewStatus,
});

describe('fulfillingCopy', () => {
  it('Blu-ray target is met by Blu-ray or 4K', () => {
    expect(fulfillingCopy({ targetFormat: 'bluray' }, [copy(1, 'bluray')])?.id).toBe(1);
    expect(fulfillingCopy({ targetFormat: 'bluray' }, [copy(1, 'dvd'), copy(2, 'uhd')])?.id).toBe(2);
  });

  it('4K target is not met by Blu-ray', () => {
    expect(fulfillingCopy({ targetFormat: 'uhd' }, [copy(1, 'bluray')])).toBeNull();
  });

  it('digital does not satisfy a Blu-ray target', () => {
    expect(fulfillingCopy({ targetFormat: 'bluray' }, [copy(1, 'digital')])).toBeNull();
  });

  it('pirated and unreviewed copies do not count', () => {
    expect(fulfillingCopy({ targetFormat: 'bluray' }, [copy(1, 'uhd', 'pirated')])).toBeNull();
    expect(fulfillingCopy({ targetFormat: 'bluray' }, [copy(1, 'uhd', 'owned', 'needs_review')])).toBeNull();
  });
});

describe('planWishlistItem', () => {
  it('is a new purchase when nothing legit is owned', () => {
    expect(planWishlistItem('uhd', [])).toEqual({ kind: 'new', fromCopyId: null });
    expect(planWishlistItem('uhd', [copy(1, 'uhd', 'pirated')])).toEqual({ kind: 'new', fromCopyId: null });
  });

  it('is an upgrade from the best owned copy', () => {
    expect(planWishlistItem('uhd', [copy(1, 'dvd'), copy(2, 'bluray')])).toEqual({ kind: 'upgrade', fromCopyId: 2 });
  });

  it('refuses when already satisfied', () => {
    expect(planWishlistItem('bluray', [copy(1, 'uhd')])).toBeNull();
  });
});
