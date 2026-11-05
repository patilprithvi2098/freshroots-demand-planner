-- Ordering: procurement creates and issues POs in Zoho straight away; deliveries come back with their dates.
-- Additive only.

alter table public.recommendations
  -- When the PO this line is on was issued in Zoho (null while it is still a draft).
  add column zoho_issued_at timestamptz,
  -- Set while an order run is sending this line to Zoho, so two clicks can't order it twice.
  add column zoho_claimed_at timestamptz;

-- Delivery date from Zoho's purchase receives. With ordered_date it gives the backtest and the outcome loop
-- a dated PO history (docs/stress-test.md, finding 1).
alter table public.open_purchase_orders add column received_date date;
