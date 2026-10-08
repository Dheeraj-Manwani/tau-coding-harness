# Data guide — dashboards, tables and figures

For any screen whose job is to show numbers: a dashboard, a report, a list of records, a table. This is where generated apps look most alike, so the rules here are about what to *leave out*.

## Start from the question, not the grid
Write down what the person came to find out — "who is behind on payments", "is this week better than last" — before choosing anything to draw. Every figure, chart and column earns its place by answering it. Four figures that answer one question beat twelve that describe everything.

## Figures
- A figure is a **label, a number and one change**: `Check-ins this week · 1,286 · +9% on last week`. The number is the largest thing in the card; the label is small and quiet.
- Show a number the way the person says it: `$18.4k`, `74%`, `3 days`. Units sit beside the number in the muted colour. Never `18420.3333`.
- A change is marked with an arrow **and** a word or sign, not colour alone. Green and red come from the theme's tokens, and only where up or down means good or bad; a rise in cancellations is not green.
- Three to five figures in a row is plenty. More than that is a table.

## Charts
- `recharts` is **not** installed. Add it when you need it: `bun add recharts`. Colour every series with `var(--chart-1)` … `var(--chart-5)` (as `stroke="var(--chart-1)"`), never a hex value.
- One chart, one message. Give it a title that says the message ("Revenue is up since March"), not the field name ("Revenue").
- A line for change over time, bars for comparing categories, a donut only for parts of a whole with five slices or fewer. No 3D, no gradient fills, no more than five series.
- Label the axes lightly: the first and last tick of a time axis, a few values on the other. Remove grid lines you can do without. Draw the chart at a fixed height (`h-64`) inside `ResponsiveContainer`, so it does not collapse.
- A chart with no data says so in words, and what to do next. Do not draw an empty frame.

## Tables
- Use the `Table` components. Put the **identifying column first**, the number columns last and right-aligned with `tabular-nums` so digits line up.
- Header cells are short nouns in the skin's label style. Do not add casing or size classes; the skin sets them.
- Rows are scannable: one line each, the main text in the foreground colour, secondary facts in `text-muted-foreground`, a status as a `Badge`. Truncate long text with `truncate` and a `max-w-*`, and put the full text in a `title`.
- More than about 12 rows needs one of: a search box, a filter, sorting on the columns people compare, or pages. Pick the one the question needs; do all four only if it asks for all four.
- On a phone, a table with more than three columns becomes a stack of cards (`md:hidden` cards, `hidden md:table` table) showing the two or three columns that matter. A table that merely scrolls sideways is acceptable only for data that has to be compared across many columns, and then inside `overflow-x-auto` with the first column kept in view (`sticky left-0 bg-card`).
- Totals sit in a footer row, set apart with a heavier rule, not in the body.

## The states people actually see
Build all of these. They are most of what a first visitor meets:
- **Empty:** a sentence on what will appear here and the one action that makes it appear. No illustration of a cardboard box.
- **Loading:** skeletons the same size as what is coming (`Skeleton`), so the page does not jump.
- **Error:** what failed, in plain words, and a retry.
- **One row, and ten thousand:** a list of one should still look intended; a list of thousands must page or search.

## Data
- Real-looking, specific and varied: names that belong to the subject, amounts that are not all round, dates spread over weeks. Not `Item 1, Item 2`, not `$100, $200, $300`.
- Keep the numbers consistent with each other: the figures at the top are the sums of the table below, the percentages add to 100.
- Dates relative where it helps ("2 days ago"), absolute where it matters ("14 Nov"). Use `date-fns`.
- Sample data lives in one module (`src/data/…`) so replacing it with the real thing is one change.
