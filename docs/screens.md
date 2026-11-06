# Dashboard and motion design

This records the screens as built. It starts from the decision made on each screen, as the framework asks.
Screens were shaped by feedback on the first version ("overview first, click for a pop-up") and a design critique.

## Screens and fields

| Screen | Who opens it, and when | The decision they make | Fields shown | Actions | Never has to hunt for |
|---|---|---|---|---|---|
| **Overview** | Raghav, start of each cycle | Is this cycle ready, and what's most urgent? | Cycle progress, SKUs running low (units short), overstocked (units over), demand rising, stock health by SKU, data freshness | Run planning, open a SKU | Whether the data is fresh, and how many SKUs need him |
| **Review** | Raghav, twice a week | Approve, change or reject each line | SKU and pack image, situation, weeks of cover, trend, suggested quantity, judgement badge, status | Approve, Change, Reject, bulk approve, search, send to procurement | What's left to decide, and which lines need judgement |
| **SKU pop-up** | Raghav, on any SKU | Is this quantity right for this SKU? | One-line summary, suggested order, cover against the safe range, 16-week sales, Claude's explanation and what to check first, rule trace, past results | Approve, Change, Reject, move to next SKU | Why the rules said this, and what happened last time |
| **Orders** | Procurement, after a send; Raghav to check status | Is each order right to issue? | SKU, final quantity, distributor, order status, delivery date | Preview, confirm large quantities, create and issue in Zoho, refresh status, export CSV | Which lines aren't ordered yet |
| **Data** | Raghav, before a run | Is the data good enough to plan on? | Preview of first 20 rows, row count, warnings with row numbers, run history, optional checks that are on or off | Upload, confirm, run planning | What's stale or failed validation |
| **Performance** | Deepa and Raghav, weekly | Keep going, or stop? | Kill-criteria lights, estimated loss against ₹25 lakh, accept and override rates, stockout weeks, write-offs, rule against override results, AI spend | Open the backtest | Whether a kill criterion has tripped |
| **Backtest** | Raghav or Deepa, when checking the rules | Do the rules match past decisions? | Flags per week, festival against non-festival share, agreement % | Run backtest | The agreement figure against 75% |
| **Rules** | Raghav, occasionally | Should a rule change? | Current settings, version history, plain-language rules, proposed changes with evidence | Save a new version, accept or dismiss a proposal | The rules in words, as the Excel fallback |

## Empty, error and phone states

| State | What happens |
|---|---|
| **Empty** | Each screen says what's missing and what to do next, such as "Nothing to review yet" or "No outcomes measured yet" |
| **Slow** | A loading placeholder appears straight away while a screen fetches its data |
| **Screen error** | "This screen didn't load", with reassurance that saved decisions are safe, and a Try again button |
| **Database asleep** | A "waking up" page that retries by itself every 20 seconds |
| **AI failure** | The plan still works; the SKU shows its rule-based explanation or "Rationale unavailable" |
| **Bad upload** | Nothing is saved; errors list the row number |
| **Unknown address** | "Page not found" with a link back |
| **Phone** | Browser tests confirm no sideways page scrolling at 375px wide on every screen |

## First ten seconds

The Overview leads with the result from the [Build Requirements Brief](build-requirements.md): how many SKUs need
review and how many need judgement.

## Visual direction

**No Pinterest references were supplied.** The look came from direct feedback and the design critique:

- **Layout:** overview first, details in a pop-up, navigation down the side (across the top on phones)
- **Colour roles:** green for brand and primary actions; red, amber and blue for stockout, overstock and rising demand. Status always has a text label too, so colour is never the only signal
- **Density:** cards and summaries first, tables one level down
- **Numbers:** Indian formatting and the ₹ symbol

## Motion

**No motion references were supplied,** so motion is limited to what helps someone understand a change:

| Where | What it explains | Feel | With reduced motion |
|---|---|---|---|
| Review progress bar | How much of the cycle is decided | Short slide | Changes instantly |
| Overview card arrow on hover | The card can be opened | Short nudge | Changes instantly |
| Loading placeholder | The screen is on its way | Slow pulse, only while waiting | Holds still |

All of it is CSS, so it adds nothing noticeable to page weight.
