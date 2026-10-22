import { NextResponse } from "next/server";
import { getSessionProfile } from "@/lib/auth";
import { toCsv } from "@/lib/csv/export";
import { createClient } from "@/lib/supabase/server";
import { releasedItems } from "@/lib/services/procurement";
import { audit, todayIst } from "@/lib/services/db";

export async function GET() {
  const session = await getSessionProfile();
  if (!session || (session.role !== "planner" && session.role !== "procurement")) {
    return NextResponse.json({ error: "Not allowed" }, { status: 403 });
  }
  const db = await createClient();
  const items = await releasedItems(db);
  const csv = toCsv(
    ["Released_At", "SKU_ID", "SKU_Name", "Distributor_ID", "Action", "Final_Qty"],
    items.map((i) => [i.released_at, i.sku_id, i.sku_name, i.distributor_id ?? "", i.action, i.final_qty]),
  );
  await audit(db, session.userId, "export", "recommendations", null, { rows: items.length });
  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="freshroots-approved-orders-${todayIst()}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
