import { requireRole } from "@/lib/auth";
import { resolveParams } from "@/lib/rules/config";
import { rulesInPlainLanguage } from "@/lib/rules/plainLanguage";
import type { RuleParams } from "@/lib/rules/types";
import { createClient } from "@/lib/supabase/server";
import { fmtDateTime } from "@/lib/format";
import { Card, PageHeader } from "@/components/ui";
import { ConfigForm } from "./ConfigForm";
import { CopyRules } from "./CopyRules";

export default async function SettingsPage() {
  await requireRole(["planner"]);
  const db = await createClient();
  const { data: versions } = await db.from("rule_config").select("version, params, active, created_at, created_by").order("version", { ascending: false });
  const active = versions?.find((v) => v.active);
  const params = resolveParams((active?.params ?? null) as Partial<RuleParams> | null);
  const plain = rulesInPlainLanguage(params, active?.version ?? 1);

  return (
    <>
      <PageHeader
        title="Rules"
        description="Every save creates a new version. Old versions are never edited, and each run records the version it used."
      />
      <div className="grid gap-6 lg:grid-cols-[1fr_1fr]">
        <Card>
          <h2 className="mb-1 font-semibold">Parameters (version {active?.version})</h2>
          <p className="mb-4 text-sm text-neutral-600">Changes apply to the next run.</p>
          <ConfigForm params={params} />
        </Card>
        <div className="space-y-6">
          <Card>
            <div className="mb-2 flex items-center justify-between gap-2">
              <h2 className="font-semibold">The rules in plain language</h2>
              <CopyRules text={plain.join("\n")} />
            </div>
            <p className="mb-3 text-sm text-neutral-600">If the system is switched off, this is the logic to follow in the monthly Excel process.</p>
            <ol className="space-y-2 text-sm">
              {plain.map((line, i) => (
                <li key={i}>{line}</li>
              ))}
            </ol>
          </Card>
          <Card>
            <h2 className="mb-3 font-semibold">Version history</h2>
            <ul className="divide-y divide-neutral-100 text-sm">
              {(versions ?? []).map((v) => (
                <li key={v.version} className="flex justify-between py-2">
                  <span>
                    Version {v.version} {v.active ? <strong className="text-brand-700">(active)</strong> : null}
                  </span>
                  <span className="text-neutral-600">{v.created_by ? fmtDateTime(v.created_at) : "Default"}</span>
                </li>
              ))}
            </ul>
          </Card>
        </div>
      </div>
    </>
  );
}
