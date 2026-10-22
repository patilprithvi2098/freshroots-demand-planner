"use client";

import { useState } from "react";
import { btn } from "@/components/ui";

export function CopyRules({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex gap-2">
      <button
        type="button"
        className={btn.secondary}
        onClick={async () => {
          await navigator.clipboard.writeText(text);
          setCopied(true);
          setTimeout(() => setCopied(false), 2000);
        }}
      >
        {copied ? "Copied" : "Copy"}
      </button>
      <a className={btn.secondary} href={`data:text/plain;charset=utf-8,${encodeURIComponent(text)}`} download="freshroots-rules.txt">
        Download
      </a>
    </div>
  );
}
