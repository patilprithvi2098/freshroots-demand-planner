/* eslint-disable @next/next/no-img-element -- static SVG pack shots; next/image adds nothing here */
"use client";

import { useState } from "react";

const SIZES = { xs: "h-9 w-9", sm: "h-11 w-11", md: "h-14 w-14", lg: "h-24 w-24", hero: "h-16 w-16 sm:h-24 sm:w-24" };

/** Pack shot for a SKU (public/skus/<SKU_ID>.svg), with a branded placeholder if it is missing. */
export function SkuImage({ skuId, size = "sm" }: { skuId: string; name?: string; size?: keyof typeof SIZES }) {
  const [src, setSrc] = useState(`/skus/${encodeURIComponent(skuId)}.svg`);
  return (
    <img
      src={src}
      alt=""
      loading="lazy"
      onError={() => setSrc("/skus/_placeholder.svg")}
      className={`${SIZES[size]} shrink-0 rounded-xl bg-white object-cover ring-1 ring-neutral-200`}
    />
  );
}
