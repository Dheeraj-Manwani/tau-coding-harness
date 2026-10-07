/**
 * Selectors a style needs spelled out in full to override the shared skin.
 *
 * Most of the shared skin addresses a component by one `data-slot` attribute,
 * and a style's own rule for the same slot wins by coming later. Tabs are the
 * exception: only a horizontal bar is reshaped, so the shared rules are keyed
 * on the bar's orientation as well, and a plain `[data-slot="tabs-list"]` in a
 * style's skin loses to them however late it comes. A style that changes the
 * tray or a tab uses these.
 */

/** The tray of a horizontal tab bar. */
export const TABS_LIST = `[data-slot="tabs"][data-orientation="horizontal"] > [data-slot="tabs-list"]`;

/** One tab in it. Add `[data-active]` for the selected one. */
export const TABS_TAB = `${TABS_LIST} > [data-slot="tabs-trigger"]`;

/** A checkbox or switch that is off, whichever primitive library drew it. */
export const UNCHECKED = `:not([data-checked], [data-state="checked"])`;
