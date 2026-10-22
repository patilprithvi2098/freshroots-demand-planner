"use client";

import { useRef, useState, useTransition } from "react";
import type { FileType } from "@/lib/csv/loaders";
import type { UploadPreview } from "@/lib/services/uploads";
import { btn, Card } from "@/components/ui";
import { confirmUploadAction, previewUploadAction } from "../actions";
import { useRouter } from "next/navigation";

export function UploadZone({
  fileType,
  label,
  lastUpload,
  status,
  compact = false,
}: {
  fileType: FileType;
  label: string;
  lastUpload: string | null;
  status?: string | null;
  /** One-line row with an Upload button, for files that rarely change. */
  compact?: boolean;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<UploadPreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [pending, start] = useTransition();
  const inputRef = useRef<HTMLInputElement>(null);
  const inputId = `file-${fileType}`;
  const router = useRouter();

  function formFor(f: File) {
    const fd = new FormData();
    fd.set("fileType", fileType);
    fd.set("file", f);
    return fd;
  }

  function choose(f: File | undefined) {
    if (!f) return;
    setFile(f);
    setPreview(null);
    setError(null);
    setDone(null);
    start(async () => {
      const res = await previewUploadAction(formFor(f));
      if (res.ok) setPreview(res.data);
      else setError(res.error);
    });
  }

  function confirm() {
    if (!file) return;
    start(async () => {
      const res = await confirmUploadAction(formFor(file));
      if (res.ok) {
        setDone(`${res.message ?? "Saved."}${res.data.warnings.length ? ` ${res.data.warnings.length} warning(s) recorded.` : ""}`);
        setPreview(null);
        setFile(null);
        if (inputRef.current) inputRef.current.value = "";
        router.refresh();
      } else setError(res.error);
    });
  }

  function cancel() {
    setPreview(null);
    setFile(null);
    setError(null);
    if (inputRef.current) inputRef.current.value = "";
  }

  return (
    <Card className={compact ? "p-4!" : ""}>
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          choose(e.dataTransfer.files[0]);
        }}
        className={compact ? `flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl ${dragOver ? "bg-emerald-50 ring-2 ring-emerald-600" : ""}` : ""}
      >
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline justify-between gap-2">
            <h3 className="font-semibold">{label}</h3>
            {compact ? null : <code className="text-xs text-neutral-600">{fileType}.csv</code>}
          </div>
          {status ? <p className="mt-0.5 text-sm text-neutral-800">{status}</p> : null}
          <p className="mt-0.5 text-xs text-neutral-600">{lastUpload ? `Last upload: ${lastUpload}` : "No upload recorded"}</p>
        </div>
        {compact ? (
          <label htmlFor={inputId} className={`${btn.secondary} cursor-pointer focus-within:outline-2 focus-within:outline-emerald-700`}>
            Upload {fileType}.csv
            <input ref={inputRef} id={inputId} type="file" accept=".csv,text/csv" className="sr-only" onChange={(e) => choose(e.target.files?.[0])} />
          </label>
        ) : (
          <label
            htmlFor={inputId}
            className={`mt-3 flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed px-4 py-5 text-center text-sm focus-within:outline-2 focus-within:outline-emerald-700 ${dragOver ? "border-emerald-600 bg-emerald-50" : "border-neutral-300 hover:bg-neutral-50"}`}
          >
            <span className="font-medium text-emerald-800">Choose {fileType}.csv</span>
            <span className="text-neutral-600">or drag it here · up to 10 MB</span>
            <input ref={inputRef} id={inputId} type="file" accept=".csv,text/csv" className="sr-only" onChange={(e) => choose(e.target.files?.[0])} />
          </label>
        )}
      </div>

      <div aria-live="polite">
        {pending ? <p className="mt-3 text-sm text-neutral-600">Checking file…</p> : null}
        {error ? (
          <p role="alert" className="mt-3 rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800">
            {error}
          </p>
        ) : null}
        {done ? <p className="mt-3 rounded-md border border-emerald-100 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">{done}</p> : null}
      </div>

      {preview ? <PreviewPanel preview={preview} pending={pending} onConfirm={confirm} onCancel={cancel} /> : null}
    </Card>
  );
}

function PreviewPanel({ preview, pending, onConfirm, onCancel }: { preview: UploadPreview; pending: boolean; onConfirm: () => void; onCancel: () => void }) {
  return (
    <div className="mt-4 space-y-3">
      <p className="text-sm">
        <strong>{preview.filename}</strong>: {preview.rowCount.toLocaleString("en-IN")} rows,{" "}
        {preview.validRows.toLocaleString("en-IN")} valid.
      </p>
      {preview.duplicateOf ? (
        <p role="alert" className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800">
          This exact file has already been uploaded ({preview.duplicateOf}). It will not be saved again.
        </p>
      ) : null}
      {preview.errors.length ? (
        <div role="alert" className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800">
          <p className="font-medium">{preview.errors.length} problem(s) must be fixed before saving:</p>
          <ul className="mt-1 max-h-40 list-disc overflow-y-auto pl-5">
            {preview.errors.map((e, i) => (
              <li key={i}>
                Row {e.row}: {e.message}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {preview.warnings.length ? (
        <div className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          <p className="font-medium">Warnings</p>
          <ul className="mt-1 max-h-40 list-disc overflow-y-auto pl-5">
            {preview.warnings.map((w, i) => (
              <li key={i}>{w}</li>
            ))}
          </ul>
        </div>
      ) : null}
      {preview.preview.length ? (
        <div className="max-h-72 overflow-auto rounded-md border border-neutral-200" tabIndex={0} role="region" aria-label="Table (scrolls)">
          <table className="w-full text-left text-xs">
            <caption className="sr-only">First {preview.preview.length} rows</caption>
            <thead className="sticky top-0 bg-neutral-50">
              <tr>
                <th className="px-2 py-1.5 text-neutral-600">#</th>
                {preview.headers.map((h) => (
                  <th key={h} className="px-2 py-1.5 font-medium">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-100">
              {preview.preview.map((row, i) => (
                <tr key={i}>
                  <td className="px-2 py-1 text-neutral-400">{i + 2}</td>
                  {preview.headers.map((h) => (
                    <td key={h} className="tabular px-2 py-1 whitespace-nowrap">
                      {row[h]}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
      <div className="flex gap-2">
        <button type="button" className={btn.primary} disabled={!preview.canConfirm || pending} onClick={onConfirm}>
          {pending ? "Saving…" : "Confirm and save"}
        </button>
        <button type="button" className={btn.secondary} onClick={onCancel} disabled={pending}>
          Cancel
        </button>
      </div>
    </div>
  );
}
