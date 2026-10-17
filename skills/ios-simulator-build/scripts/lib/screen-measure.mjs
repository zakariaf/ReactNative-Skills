// screen-measure.mjs: measures a decoded screenshot (check-lib's readPng: { width, height, data }
// with RGBA rows top to bottom) for the failures a glance must catch (a helper, not an entry point).
//
//   dominantColour(image, { top, bottom, step })   { hex, share, distinct } of rows [top, bottom)
//   lightBannerRows(image, { top, bottom })         rows of the top band that look like a light banner

/** The RGB of pixel (x, y). */
function rgbAt(image, x, y) {
  const i = (y * image.width + x) * 4;
  return [image.data[i], image.data[i + 1], image.data[i + 2]];
}

/**
 * Share of sampled pixels in rows [top, bottom) that have the most common colour (alpha ignored).
 * Samples every `step`-th pixel, which is plenty for a whole-screen verdict.
 */
export function dominantColour(image, { top = 0, bottom = image.height, step = 3 } = {}) {
  const counts = new Map();
  let total = 0;
  for (let y = top; y < bottom; y += step) {
    for (let x = 0; x < image.width; x += step) {
      const [r, g, b] = rgbAt(image, x, y);
      const key = (r << 16) | (g << 8) | b;
      counts.set(key, (counts.get(key) ?? 0) + 1);
      total += 1;
    }
  }
  let bestKey = 0;
  let best = 0;
  for (const [key, count] of counts) {
    if (count > best) {
      best = count;
      bestKey = key;
    }
  }
  const hex = `#${bestKey.toString(16).padStart(6, '0').toUpperCase()}`;
  return { hex, share: total === 0 ? 0 : best / total, distinct: counts.size };
}

/** A light, nearly grey pixel (a light-mode iOS notification banner). */
function isLightGrey(image, x, y) {
  const [r, g, b] = rgbAt(image, x, y);
  return Math.min(r, g, b) >= 215 && Math.max(r, g, b) - Math.min(r, g, b) <= 24;
}

/**
 * Rows in the top band that look like a light system banner (a notification drawn over the app):
 * at least 97% of the row between 2.5% and 97.5% of the width is light grey, while the thin strips
 * at both edges (0.6% to 1.2% from each side, outside the banner's 8 pt inset) are not. A heuristic:
 * an app's own full-width light bar fails the edge test, a card with content fails the 97% test.
 */
export function lightBannerRows(image, { top = Math.round(image.height * 0.045), bottom = Math.round(image.height * 0.17) } = {}) {
  const innerFrom = Math.round(image.width * 0.025);
  const innerTo = Math.round(image.width * 0.975);
  const edges = [Math.round(image.width * 0.006), Math.round(image.width * 0.012)];
  let rows = 0;
  for (let y = top; y < bottom; y += 1) {
    let light = 0;
    let total = 0;
    for (let x = innerFrom; x < innerTo; x += 2) {
      total += 1;
      if (isLightGrey(image, x, y)) light += 1;
    }
    if (light / total < 0.97) continue;
    const isEdgeLight = edges.some((x) => isLightGrey(image, x, y) || isLightGrey(image, image.width - 1 - x, y));
    if (!isEdgeLight) rows += 1;
  }
  return rows;
}
