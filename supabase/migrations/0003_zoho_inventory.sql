-- Zoho Inventory purchase orders for released recommendations.
-- Zoho needs its own ids, so SKUs and distributors carry a mapping; recommendations record the PO they went on.

alter table public.skus add column zoho_item_id text;
create unique index skus_zoho_item_idx on public.skus (zoho_item_id) where zoho_item_id is not null;

alter table public.distributors add column zoho_vendor_id text;
create unique index distributors_zoho_vendor_idx on public.distributors (zoho_vendor_id) where zoho_vendor_id is not null;

alter table public.recommendations
  add column zoho_po_id text,
  add column zoho_po_number text,
  add column zoho_po_reference text,
  add column zoho_ordered_at timestamptz,
  add column zoho_error text check (char_length(zoho_error) <= 500),
  -- A PO only for something procurement can see: released, with a quantity to order.
  add constraint recommendations_zoho_po_released check (zoho_po_id is null or (released_at is not null and final_qty > 0));
create index recommendations_zoho_po_idx on public.recommendations (zoho_po_id) where zoho_po_id is not null;

-- POs created here also become open purchase orders, so the next run counts them as stock on order.
alter table public.open_purchase_orders add column source text not null default 'upload'
  check (source in ('upload', 'zoho'));

-- Procurement may record a Zoho order in the audit log, as it already may for exports.
drop policy procurement_audit_insert on public.audit_log;
create policy procurement_audit_insert on public.audit_log
  for insert to authenticated
  with check (public.app_role() = 'procurement' and actor = auth.uid() and action in ('export', 'zoho_po_create'));
