// src/ui/component-specs.ts
import specs from './component-specs.json';

/**
 * Component measurements in pt, generated from the token file's components block by
 * write-component-specs.mjs (token references resolved, the catalogue's reasoned overrides applied).
 * Components take every size, padding, gap, radius, border and elevation from here or from the
 * theme tokens; the JSON is never edited by hand, so a measurement changes only with the design.
 */
export const COMPONENT_SPECS = specs;
