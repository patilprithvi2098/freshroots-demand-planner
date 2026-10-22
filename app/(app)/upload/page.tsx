import { requireRole } from "@/lib/auth";
import { FILE_TYPES } from "@/lib/csv/loaders";
import { createClient } from "@/lib/supabase/server";
import { fmtDateTime, fmtInt } from "@/lib/format";
import { Card, PageHeader } from "@/components/ui";
import { UploadZone } from "./UploadZone";

export default async function UploadPage() {
  await requireRole(["planner"]);
  const db = await createClient();
  const { data: batches } = await db
    .from("upload_batches")
    .select("id, file_type, filename, row_count, created_at, warnings")
    .eq("status", "confirmed")
    .order("created_at", { ascending: false })
    .limit(30);
  const lastByType = new Map<string, { filename: string; created_at: string; row_count: number }>();
  for (const b of batches ?? []) if (!lastByType.has(b.file_type)) lastByType.set(b.file_type, b);

  return (
    <>
      <PageHeader
        title="Upload data"
        description="Choose a CSV export from SAP for each file type. You will see a preview and any problems before anything is saved. Nothing is stored until you click Confirm."
      />
      <div className="grid gap-4 lg:grid-cols-2">
        {FILE_TYPES.map((f) => {
          const last = lastByType.get(f.type);
          return (
            <UploadZone
              key={f.type}
              fileType={f.type}
              label={f.label}
              lastUpload={last ? `${last.filename} · ${fmtInt(last.row_count)} rows · ${fmtDateTime(last.created_at)}` : null}
            />
          );
        })}
      </div>
      <Card className="mt-8">
        <h2 className="mb-3 font-semibold">Upload history</h2>
        {batches && batches.length > 0 ? (
          <div className="overflow-x-auto focus-visible:outline-2 focus-visible:outline-brand-700" tabIndex={0} role="region" aria-label="Table (scrolls sideways)">
            <table className="w-full text-left text-sm">
              <thead className="text-xs uppercase text-neutral-600">
                <tr>
                  <th className="py-2 pr-4">When</th>
                  <th className="py-2 pr-4">File type</th>
                  <th className="py-2 pr-4">File</th>
                  <th className="py-2 pr-4 text-right">Rows saved</th>
                  <th className="py-2">Warnings</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-100">
                {batches.map((b) => {
                  const w = (b.warnings as string[] | null) ?? [];
                  return (
                    <tr key={b.id}>
                      <td className="py-2 pr-4 whitespace-nowrap">{fmtDateTime(b.created_at)}</td>
                      <td className="py-2 pr-4">{FILE_TYPES.find((f) => f.type === b.file_type)?.label ?? b.file_type}</td>
                      <td className="py-2 pr-4">{b.filename}</td>
                      <td className="tabular py-2 pr-4 text-right">{fmtInt(b.row_count)}</td>
                      <td className="py-2 text-neutral-600">{w.length ? w.join(" ") : "None"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-sm text-neutral-600">No files uploaded yet. Start with the distributor master and SKU master.</p>
        )}
      </Card>
    </>
  );
}
