/* eslint-disable @next/next/no-img-element -- small static pack shots; next/image adds nothing here */
"use client";

import { useEffect, useRef, useState } from "react";

const SIZES = {
  xs: "h-12 w-12",
  sm: "h-14 w-14",
  md: "h-16 w-16 sm:h-20 sm:w-20",
  lg: "h-32 w-32",
  hero: "h-28 w-28 sm:h-40 sm:w-40",
};

/**
 * Pack shot for a SKU. Tries the product photo (public/skus/<SKU_ID>.webp), then the drawn
 * pack shot (public/skus/<SKU_ID>.svg), then a branded placeholder.
 */
export function SkuImage({ skuId, size = "sm" }: { skuId: string; name?: string; size?: keyof typeof SIZES }) {
  const id = encodeURIComponent(skuId);
  const sources = [`/skus/${id}.webp`, `/skus/${id}.svg`, "/skus/_placeholder.svg"];
  const [attempt, setAttempt] = useState(0);
  const ref = useRef<HTMLImageElement>(null);
  // A missing photo can fail before React attaches onError (server-rendered <img>); catch that case too.
  useEffect(() => {
    const img = ref.current;
    if (img && img.complete && img.naturalWidth === 0) setAttempt((a) => Math.min(a + 1, sources.length - 1));
  }, [attempt, sources.length]);
  return (
    <img
      ref={ref}
      src={sources[attempt]}
      alt=""
      loading="lazy"
      onError={() => setAttempt((a) => Math.min(a + 1, sources.length - 1))}
      className={`${SIZES[size]} shrink-0 rounded-xl bg-white object-contain ring-1 ring-neutral-200`}
    />
  );
}
