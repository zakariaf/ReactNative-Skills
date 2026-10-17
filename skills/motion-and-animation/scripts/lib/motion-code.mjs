// motion-code.mjs: reads one app source file the way check-motion.mjs needs it (animation sites,
// moment references, navigators) and runs the per-file code rules (a helper, not an entry point).
// Text scanning on comment- and string-masked source, not a full parser: good enough for the
// patterns a reviewer would otherwise look for by eye.

import { lineOf, maskComments } from '../check-lib.mjs';
import { findCalls, findClosing, findImports, findJsxTags, functionsOf, jsxAttributes, maskCode, scanSource } from './source-scan.mjs';

const REANIMATED = 'react-native-reanimated';
const WORKLETS = 'react-native-worklets';
const GESTURE_HANDLER = 'react-native-gesture-handler';

const ANIMATION_CALL = /(?<![\w$.])with(Timing|Spring|Decay|Repeat|Sequence|Delay|Clamp)\s*\(/g;
const LAYOUT_PROP = /(?<![\w$.])(entering|exiting|layout|itemLayoutAnimation)\s*=\s*\{/g;
const KEYFRAME = /(?<![\w$.])Keyframe\s*\(/g;
const CSS_KEY = /[{,]\s*(animationName|animationDuration|transitionProperty|transitionDuration|transition)\s*:/g;
const MOMENT_REF = /\bMOTION_MOMENTS\s*(?:\.\s*([A-Za-z_$][\w$]*)|\[\s*(['"])([^'"]+)\2\s*\])/g;
const CROSSES_TO_JS = /(?<![\w$.])(scheduleOnRN|runOnJS)\s*\(/;
const REACT_SETTER = /(?<![\w$.])set[A-Z][\w$]*\s*\(/;
const LOCK_NAME = /\b(?:is|has|are|should)?[A-Za-z]*(?:Animating|AnimationRunning|AnimationPlaying|Transitioning|Celebrating|CelebrationPlaying)\b|\banimating\b/;
const LOCK_PROPS = new Set(['disabled', 'isDisabled', 'pointerEvents', 'enabled', 'scrollEnabled', 'editable', 'onPress']);
const LAYOUT_KEYS = /[{,]\s*(width|height|top|bottom|left|right|start|end|margin\w*|padding\w*|flex\w*|minWidth|maxWidth|minHeight|maxHeight|gap|rowGap|columnGap|borderWidth|fontSize|lineHeight|letterSpacing)\s*:/g;
const LAYOUT_MARKER = /\/\/\s*motion-layout:\s*(.{10,})/;
const STACK_ANIMATION_LITERAL = /[{,]\s*animation\s*:\s*(['"])([A-Za-z_]+)\1/g;

/** Splits a masked argument list on its top-level commas: [{ text, offset }]. */
export function splitArgs(masked, open, close) {
  const args = [];
  let depth = 0;
  let start = open + 1;
  for (let i = open + 1; i < close; i += 1) {
    const ch = masked[i];
    if (ch === '(' || ch === '[' || ch === '{') depth += 1;
    else if (ch === ')' || ch === ']' || ch === '}') depth -= 1;
    else if (ch === ',' && depth === 0) {
      args.push({ text: masked.slice(start, i), offset: start });
      start = i + 1;
    }
  }
  const last = masked.slice(start, close);
  if (last.trim() !== '') args.push({ text: last, offset: start });
  return args;
}

function namedImports(text) {
  const braces = /\{([^}]*)\}/.exec(text);
  if (!braces) return [];
  return braces[1].split(',').map((part) => part.trim().replace(/^type\s+/, '').split(/\s+as\s+/)[0].trim()).filter(Boolean);
}

/** Everything the rules need to know about one file. */
export function analyseFile(rel, source) {
  const masked = maskCode(source);
  const keep = maskComments(source);
  const imports = findImports(source, masked);
  const from = (spec) => imports.filter((entry) => entry.from === spec);
  const importsReanimated = from(REANIMATED).some((entry) => !/^import\s+type\b/.test(entry.text));
  const sites = [];
  if (importsReanimated) {
    for (const re of [ANIMATION_CALL, LAYOUT_PROP, KEYFRAME, CSS_KEY]) {
      for (const match of masked.matchAll(re)) sites.push({ index: match.index + match[0].search(/\w/), what: match[1] ?? match[0].trim() });
    }
  }
  const stackImport = imports.find((entry) => (entry.from === 'expo-router' && namedImports(entry.text).includes('Stack')));
  const stackTag = stackImport ? findJsxTags(source, masked).find((tag) => tag.name === 'Stack' || tag.name === 'Stack.Navigator') : null;
  const nativeStack = /(?<![\w$.])createNativeStackNavigator\s*\(/.exec(masked);
  const stackIndex = stackTag ? stackTag.start : nativeStack ? nativeStack.index : -1;
  const navigatorTag = findJsxTags(source, masked).find((tag) => tag.name === 'Stack' || tag.name === 'Stack.Navigator');
  const screenOptions = navigatorTag ? jsxAttributes(source, navigatorTag, masked).get('screenOptions') : undefined;
  const tabsImport = imports.find((entry) => entry.from === 'expo-router' && namedImports(entry.text).includes('Tabs'));
  // A stack whose screenOptions say animation: 'none' and that names no other animation never moves.
  const literals = [...keep.matchAll(STACK_ANIMATION_LITERAL)].map((match) => match[2]);
  const stackStill = screenOptions !== undefined && /[{,]\s*animation\s*:\s*(['"])none\1/.test(screenOptions.value) && literals.every((literal) => literal === 'none');
  const refs = [];
  for (const match of keep.matchAll(MOMENT_REF)) refs.push({ id: match[1] ?? match[3], index: match.index });
  sites.sort((a, b) => a.index - b.index);
  return {
    rel, source, masked, keep, imports, sites, refs, stackIndex, hasNavigatorImport: Boolean(stackImport || tabsImport) || stackIndex !== -1,
    hasNavigatorTag: Boolean(navigatorTag), screenOptions: screenOptions?.value, stackStill, tabsOnly: Boolean(tabsImport) && stackIndex === -1 && !stackImport,
    importsReanimated,
    importsGesture: from(GESTURE_HANDLER).length > 0,
    line: (index) => lineOf(source, index),
    animates: sites.length > 0 || (stackIndex !== -1 && !stackStill),
  };
}

function callBodies(file, callees) {
  const out = [];
  for (const callee of callees) for (const call of findCalls(file.masked, callee)) out.push({ ...call, callee });
  return out.sort((a, b) => a.start - b.start);
}

/** reanimated-only: React Native's LayoutAnimation (no reduce-motion handling, MotionConfig never reaches it). */
function legacyAnimationProblems(file, add) {
  for (const entry of file.imports) {
    if (entry.from === 'react-native' && namedImports(entry.text).includes('LayoutAnimation')) {
      add(entry.index, 'reanimated-only', 'imports LayoutAnimation from react-native, which no reduce-motion setting reaches', 'Animate with Reanimated: a layout animation (entering, exiting, layout={LinearTransition}) follows the root MotionConfig.');
    }
  }
}

/** worklets-api: the deprecated runOnJS / runOnUI / executeOnUIRuntimeSync. */
function workletsApiProblems(file, add) {
  for (const entry of file.imports) {
    if (entry.from !== REANIMATED && entry.from !== WORKLETS) continue;
    for (const name of namedImports(entry.text)) {
      if (['runOnJS', 'runOnUI', 'executeOnUIRuntimeSync'].includes(name)) add(entry.index, 'worklets-api', `imports ${name}, deprecated in Reanimated 4`, 'Use scheduleOnRN(fn, ...args) / scheduleOnUI(fn, ...args) / runOnUISync from react-native-worklets.');
    }
  }
}

/** no-js-per-frame: crossing to the React Native runtime inside a per-frame worklet. */
function perFrameProblems(file, add) {
  const frameCallees = ['useAnimatedStyle', 'useDerivedValue', 'useAnimatedProps', 'useFrameCallback', 'useAnimatedScrollHandler'];
  const gestureCallees = file.importsGesture ? ['\\.onUpdate', '\\.onChange', '\\.onTouchesMove'] : [];
  for (const call of callBodies(file, [...frameCallees, ...gestureCallees])) {
    const body = file.masked.slice(call.open, call.close);
    const cross = CROSSES_TO_JS.exec(body);
    const isGesture = call.callee.startsWith('\\.');
    const setter = isGesture ? REACT_SETTER.exec(body) : null;
    const hit = cross ?? setter;
    if (!hit) continue;
    const where = call.callee.replace('\\', '');
    add(call.open + hit.index, 'no-js-per-frame', `${hit[0].replace(/\s*\($/, '')} runs inside ${where}, once per frame`, 'Keep per-frame work in shared values; cross to JS once, in onEnd, or in a useAnimatedReaction when a value crosses a threshold.');
  }
}

/** compositor-props: layout properties animated frame by frame. */
function compositorProblems(file, add) {
  const lines = file.source.split('\n');
  for (const call of callBodies(file, ['useAnimatedStyle'])) {
    const body = file.masked.slice(call.open, call.close);
    for (const match of body.matchAll(LAYOUT_KEYS)) {
      const index = call.open + match.index + match[0].indexOf(match[1]);
      const line = file.line(index);
      if (LAYOUT_MARKER.test(lines[line - 1] ?? '') || LAYOUT_MARKER.test(lines[line - 2] ?? '')) continue;
      add(index, 'compositor-props', `animates ${match[1]} in useAnimatedStyle, a layout pass on every frame`, 'Animate transform and opacity (scale, translate), or a layout animation (layout={LinearTransition}); an absolutely positioned, childless fill may keep it with "// motion-layout: <reason>" on the line above.');
    }
  }
}

/** no-timer-sequencing: a JS timer that starts or stops an animation. */
function timerProblems(file, add) {
  const ANIMATES = /\.set\(\s*with[A-Z]|(?<![\w$.])with(?:Timing|Spring|Decay|Repeat|Sequence|Delay)\s*\(|(?<![\w$.])cancelAnimation\s*\(/;
  for (const call of callBodies(file, ['setTimeout', 'setInterval', 'requestAnimationFrame'])) {
    const body = file.masked.slice(call.open, call.close);
    if (!ANIMATES.test(body)) continue;
    const name = file.masked.slice(call.start, call.open).trim();
    add(call.start, 'no-timer-sequencing', `${name} starts or stops an animation from the JS thread`, 'Sequence on the UI thread: withDelay(delayOf(moment), ...) or withSequence(...); a JS timer drifts from the frames, waits out its delay under reduce motion and fires after unmount.');
  }
}

/** no-input-lock: input switched off while something moves. */
function inputLockProblems(file, add) {
  for (const tag of findJsxTags(file.source, file.masked)) {
    for (const [name, attr] of jsxAttributes(file.source, tag, file.masked)) {
      if (!LOCK_PROPS.has(name) || attr.kind !== 'expr' || !LOCK_NAME.test(attr.value)) continue;
      add(attr.index, 'no-input-lock', `${name}={${attr.value}} switches input off while an animation runs`, 'Never lock input for motion: let the next touch interrupt the animation (retarget it, or skip() a celebration) and keep the control live.');
    }
  }
  for (const match of file.masked.matchAll(/[{,]\s*pointerEvents\s*:\s*([^,}\n]*)/g)) {
    if (LOCK_NAME.test(match[1])) add(match.index, 'no-input-lock', 'pointerEvents depends on an animation flag', 'Never lock input for motion: let the next touch interrupt the animation.');
  }
}

const FOREVER = /^(-\s*\d+(\.\d+)?|0|Infinity|Number\.POSITIVE_INFINITY)$/;

/** The initialiser of a same-file `const NAME = <literal>` (an imported constant is not followed). */
function sameFileConstant(masked, name) {
  if (!/^[A-Za-z_$][\w$]*$/.test(name)) return null;
  const match = new RegExp(`(?:const|let)\\s+${name.replace(/\$/g, '\\$')}\\s*(?::[^=]+)?=\\s*([^;\\n]+)`).exec(masked);
  return match ? match[1].replace(/\s+as\s+const\s*$/, '').trim() : null;
}

/** loop-through-hook: an endless loop outside useMotionLoop. */
function loopProblems(file, add) {
  for (const call of findCalls(file.masked, 'withRepeat')) {
    const args = splitArgs(file.masked, call.open, call.close);
    const reps = args[1]?.text.trim();
    if (reps === undefined || !FOREVER.test(sameFileConstant(file.masked, reps) ?? reps)) continue;
    add(call.start, 'loop-through-hook', `withRepeat(..., ${reps}) loops forever outside useMotionLoop`, 'Declare an attention moment and play it with useMotionLoop(MOTION_MOMENTS.<id>, { isFocused }): it stops on blur, in the background and under reduce motion.');
  }
  // `keep` masks comments but keeps strings, so both the literal and a same-file string constant
  // (const ITER = 'infinite'; animationIterationCount: ITER) resolve to the quoted value.
  for (const match of file.keep.matchAll(/[{,]\s*animationIterationCount\s*:\s*([^,}\n]+)/g)) {
    const value = match[1].trim();
    if (!/^(['"`])infinite\1$/.test(sameFileConstant(file.keep, value) ?? value)) continue;
    add(match.index + match[0].indexOf('animationIterationCount'), 'loop-through-hook', `a CSS animation with animationIterationCount ${value === "'infinite'" ? "'infinite'" : `${value} ('infinite')`} loops forever and ignores reduce motion`, 'Play loops through useMotionLoop, or give the CSS animation a finite count.');
  }
}

/** no-reset-before-animate: a shared value snapped to a start value right before it animates. */
function resetProblems(file, add) {
  const re = /(?<![\w$.])([A-Za-z_$][\w$]*)\.set\(\s*([^()]*?)\s*\)\s*;?\s*\1\.set\(\s*with[A-Z]/g;
  for (const match of file.masked.matchAll(re)) {
    if (/with[A-Z]/.test(match[2])) continue;
    add(match.index, 'no-reset-before-animate', `${match[1]} is reset to ${match[2].trim() || 'a start value'} right before it animates`, 'Animate from the current value: an interrupted animation then turns around smoothly (a spring keeps its velocity) instead of snapping back to the start.');
  }
}

/** Gesture types whose end event carries a velocity (gesture-handler 2.32 GestureHandlerEventPayload.ts:
 * Pan velocityX/velocityY, Pinch and Rotation velocity; Tap, LongPress, Fling, ForceTouch, Native,
 * Manual and Hover events carry none). */
const VELOCITY_GESTURES = new Set(['Pan', 'Pinch', 'Rotation']);

/** Index of the "(" matching the ")" at `close`, walking backwards over masked code; -1 if none. */
function openingParen(masked, close) {
  let depth = 0;
  for (let i = close; i >= 0; i -= 1) {
    const ch = masked[i];
    if (ch === ')' || ch === ']' || ch === '}') depth += 1;
    else if (ch === '(' || ch === '[' || ch === '{') {
      depth -= 1;
      if (depth === 0) return ch === '(' ? i : -1;
    }
  }
  return -1;
}

/**
 * The gesture type a chained callback belongs to: walks back from ".onEnd(" over ".method(...)" links
 * to "Gesture.<Type>(", or to an identifier bound in the same file to "Gesture.<Type>(". null when the
 * chain cannot be followed (a helper's return value, a prop): the rule stays silent there.
 */
export function gestureTypeOf(masked, dotIndex) {
  let i = dotIndex - 1;
  for (let guard = 0; guard < 64; guard += 1) {
    while (i >= 0 && /\s/.test(masked[i])) i -= 1;
    if (masked[i] === ')') {
      const open = openingParen(masked, i);
      if (open === -1) return null;
      const head = /([A-Za-z_$][\w$]*)\s*$/.exec(masked.slice(Math.max(0, open - 80), open));
      if (!head) return null;
      const nameStart = open - head[0].length;
      let j = nameStart - 1;
      while (j >= 0 && /\s/.test(masked[j])) j -= 1;
      if (masked[j] !== '.') return null;
      const owner = /([A-Za-z_$][\w$]*)\s*$/.exec(masked.slice(Math.max(0, j - 80), j));
      if (owner && owner[1] === 'Gesture' && masked.slice(j - owner[0].length - 1, j - owner[0].length).trim() !== '.') return head[1];
      i = j - 1;
      continue;
    }
    const ident = /([A-Za-z_$][\w$]*)$/.exec(masked.slice(Math.max(0, i - 80), i + 1));
    if (!ident) return null;
    const bound = new RegExp(`(?:const|let|var)\\s+${ident[1]}\\s*(?::[^=]+)?=\\s*Gesture\\s*\\.\\s*([A-Za-z]+)\\s*\\(`).exec(masked);
    return bound ? bound[1] : null;
  }
  return null;
}

/** gesture-velocity: a release spring that drops the finger's velocity (Pan, Pinch and Rotation only). */
function gestureVelocityProblems(file, add) {
  if (!file.importsGesture) return;
  for (const call of callBodies(file, ['\\.onEnd', '\\.onFinalize'])) {
    const type = gestureTypeOf(file.masked, call.start);
    if (type === null || !VELOCITY_GESTURES.has(type)) continue;
    for (const spring of findCalls(file.masked.slice(0, call.close), 'withSpring')) {
      if (spring.start < call.open) continue;
      const args = file.masked.slice(spring.open, spring.close);
      if (/\bvelocity\w*\b/.test(args)) continue;
      const field = type === 'Pan' ? 'event.velocityY (or velocityX)' : 'event.velocity';
      add(spring.start, 'gesture-velocity', `a spring started when a ${type.toLowerCase()} gesture ends does not take the gesture velocity`, `Pass it on: withSpring(target, { ...springOf(moment), velocity: ${field} }), so a flick carries into the settle.`);
    }
  }
}

/** The names a file binds to useCelebration(...): play-call patterns ("celebration.play(", or a destructured "play(" / alias). */
function celebrationPlayCalls(masked) {
  const out = [];
  for (const match of masked.matchAll(/(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*(?::[^=]+)?=\s*useCelebration\s*\(/g)) out.push(`${match[1]}\\s*\\.\\s*play`);
  for (const match of masked.matchAll(/(?:const|let|var)\s*\{([^}]*)\}\s*=\s*useCelebration\s*\(/g)) {
    for (const part of match[1].split(',')) {
      const [key, alias] = part.split(':').map((text) => text.trim());
      if (key === 'play') out.push(alias || 'play');
    }
  }
  return out;
}

/** celebration-through-hook: a celebration played from a mount or focus effect (the hook's once-per-key memory resets on remount). */
function celebrationEffectProblems(file, add) {
  const calls = celebrationPlayCalls(file.masked);
  if (calls.length === 0) return;
  const play = new RegExp(`(?<![\\w$.])(?:${calls.join('|')})\\s*\\(`);
  for (const effect of callBodies(file, ['useEffect', 'useLayoutEffect', 'useFocusEffect', 'useInsertionEffect'])) {
    const hit = play.exec(file.masked.slice(effect.open, effect.close));
    if (!hit) continue;
    add(effect.open + hit.index, 'celebration-through-hook', `a celebration plays from ${effect.callee}, so it replays whenever the component remounts or refocuses`, 'Call play(eventKey) in the handler that committed the result (onPress, the save callback), right after the commit; useCelebration\'s once-per-key memory lives in the component and resets on remount.');
  }
}

const REDUCE_CONDITION = /\bisReduce\w*|\breduce\w*Motion\w*|\bReduceMotion\w*/i;

/** The object literal around `index` in masked code: { open, close } or null. */
function enclosingObject(masked, index) {
  let depth = 0;
  for (let i = index; i >= 0; i -= 1) {
    const ch = masked[i];
    if (ch === '}' || ch === ')' || ch === ']') depth += 1;
    else if (ch === '(' || ch === '[') depth = Math.max(0, depth - 1);
    else if (ch === '{') {
      if (depth === 0) {
        const close = findClosing(masked, i);
        return close === -1 ? null : { open: i, close };
      }
      depth -= 1;
    }
  }
  return null;
}

/**
 * css-motion-reduced: Reanimated CSS animations and transitions ignore every reduce-motion setting.
 * animationName, transitionProperty and the transition shorthand carry the condition themselves; a
 * transitionDuration with neither transitionProperty nor transition beside it transitions 'all'
 * (Reanimated 4.5.1 src/css/native/normalization/transition/config.ts), so it carries it (0 when reduced).
 */
function cssProblems(file, add) {
  if (!file.importsReanimated) return;
  const message = (key) => `${key} (a Reanimated CSS animation) runs whatever reduce motion says: Reanimated 4.5.1 applies no reduce-motion setting to CSS animations and transitions`;
  for (const match of file.masked.matchAll(/[{,]\s*(animationName|transitionProperty|transition|transitionDuration)\s*:\s*([^,}\n]*)/g)) {
    const key = match[1];
    const index = match.index + match[0].indexOf(key);
    if (REDUCE_CONDITION.test(match[2])) continue;
    if (key === 'transitionDuration') {
      const object = enclosingObject(file.masked, match.index + 1);
      const body = object ? file.masked.slice(object.open, object.close) : '';
      if (/[{,]\s*(transitionProperty|transition)\s*:/.test(body)) continue;
      add(index, 'css-motion-reduced', `${message(key)}; with no transitionProperty it transitions every property ('all')`, "Name what moves and gate it: transitionProperty: isReducedMotion ? 'none' : '<property>', with isReducedMotion from useReduceMotion() or the screen model.");
      continue;
    }
    add(index, 'css-motion-reduced', message(key), `Write the condition on the key itself: ${key}: isReducedMotion ? 'none' : <value>, with isReducedMotion from useReduceMotion() or the screen model.`);
  }
}

/** Whether a stack's screenOptions take the reduce-motion answer (or set nothing that moves). */
function stackOptionsReduced(file) {
  const usesHook = /(?<![\w$.])(useScreenAnimation|screenAnimationFor)\s*\(/.test(file.masked);
  const value = file.screenOptions?.trim();
  if (file.stackStill) return true;
  if (!usesHook) return false;
  if (value === undefined) return !file.hasNavigatorTag; // the static API configures the stack outside JSX
  // An object literal must set animation itself; an identifier or call (const options = { animation: useScreenAnimation() }) is trusted.
  return value.startsWith('{') ? /\banimation\b/.test(value) : true;
}

/** screen-transition-reduced: a native stack whose animation ignores reduce motion, or a fixed moving animation literal. */
function stackProblems(file, add) {
  if (file.stackIndex !== -1 && !stackOptionsReduced(file)) {
    add(file.stackIndex, 'screen-transition-reduced', 'this native stack animates screens without the reduce-motion answer (react-native-screens 4.26.2 reads no reduce-motion setting)', 'Pass screenOptions={{ animation: useScreenAnimation() }} (and useScreenAnimation(\'slide_from_bottom\') for a screen that slides), from src/ui/motion/use-screen-animation.ts.');
  }
  if (!file.hasNavigatorImport) return;
  for (const match of file.keep.matchAll(STACK_ANIMATION_LITERAL)) {
    if (match[2] === 'none' || match[2] === 'fade') continue;
    const fix = file.tabsOnly
      ? `Gate it on the answer: animation: isReducedMotion ? 'none' : '${match[2]}', with isReducedMotion from useReduceMotion() (useScreenAnimation() returns stack animations only).`
      : `Use animation: useScreenAnimation('${match[2]}') (screenAnimationFor(isReducedMotion, '${match[2]}') outside a component).`;
    add(match.index, 'screen-transition-reduced', `animation: '${match[2]}' is fixed, so it moves even when motion is reduced`, fix);
  }
}

const REDUCE_MOTION_READER = /(?<![\w$.])(useReduceMotion|useScreenAnimation)\s*\(/g;

/**
 * reduce-motion-root: a component that renders <MotionConfig> and reads the answer in its own body.
 * Context flows down only, so the read sees the default ('system'), never the preference it passes.
 * Nested components inside the body are their own scope and are left out.
 */
function providerSelfReadProblems(file, add) {
  const tags = findJsxTags(file.source, file.masked).filter((tag) => tag.name === 'MotionConfig');
  if (tags.length === 0) return;
  const components = functionsOf(scanSource(file.source)).filter((fn) => /^[A-Z]/.test(fn.name) && fn.bodyStart !== -1 && fn.bodyEnd !== -1);
  const reported = new Set();
  for (const tag of tags) {
    const owner = components.filter((fn) => fn.bodyStart < tag.start && tag.start < fn.bodyEnd).sort((a, b) => b.bodyStart - a.bodyStart)[0];
    if (!owner || reported.has(owner.bodyStart)) continue;
    const nested = components.filter((fn) => fn !== owner && fn.bodyStart > owner.bodyStart && fn.bodyEnd < owner.bodyEnd);
    const body = file.masked.slice(owner.bodyStart, owner.bodyEnd);
    for (const match of body.matchAll(REDUCE_MOTION_READER)) {
      const index = owner.bodyStart + match.index;
      if (nested.some((fn) => index > fn.bodyStart && index < fn.bodyEnd)) continue;
      reported.add(owner.bodyStart);
      add(index, 'reduce-motion-root', `${owner.name} calls ${match[1]}() and renders <MotionConfig> itself, so the call reads the context from above the provider (the 'system' default) and ignores the preference passed to it`, `Split the component: ${owner.name} renders <MotionConfig> around a child component, and that child calls ${match[1]}() (examples/root-stack.tsx renders AppStack from examples/app-stack.tsx).`);
      break;
    }
  }
}

/** Per-file rules that need no catalog. `isPrimitive` exempts the motion primitives (the hooks themselves). */
export function codeProblems(file, { isPrimitive }, add) {
  const at = (index, rule, message, fix) => add({ file: file.rel, line: file.line(index), rule, message, fix });
  legacyAnimationProblems(file, at);
  workletsApiProblems(file, at);
  perFrameProblems(file, at);
  compositorProblems(file, at);
  timerProblems(file, at);
  inputLockProblems(file, at);
  cssProblems(file, at);
  stackProblems(file, at);
  gestureVelocityProblems(file, at);
  providerSelfReadProblems(file, at);
  if (isPrimitive) return;
  celebrationEffectProblems(file, at);
  loopProblems(file, at);
  resetProblems(file, at);
}

/** ReduceMotion.Never used as an animation opt-out (not as the root ReducedMotionConfig mode). */
export function optOutIndexes(file) {
  const tags = findJsxTags(file.source, file.masked).filter((tag) => tag.name === 'ReducedMotionConfig');
  const out = [];
  for (const match of file.masked.matchAll(/\bReduceMotion\s*\.\s*Never\b/g)) {
    if (tags.some((tag) => match.index > tag.start && match.index < tag.end)) continue;
    out.push(match.index);
  }
  return out;
}

/** Completion callbacks that hand work back to JS: [{ index, callee }]. */
export function callbackCrossings(file) {
  const out = [];
  const callbackArg = { withTiming: 2, withSpring: 2, withDecay: 1, withRepeat: 3 };
  for (const [callee, position] of Object.entries(callbackArg)) {
    for (const call of findCalls(file.masked, callee)) {
      const arg = splitArgs(file.masked, call.open, call.close)[position];
      if (arg && CROSSES_TO_JS.test(arg.text)) out.push({ index: call.start, callee });
    }
  }
  for (const call of findCalls(file.masked, '\\.withCallback')) {
    if (CROSSES_TO_JS.test(file.masked.slice(call.open, call.close))) out.push({ index: call.start, callee: 'withCallback' });
  }
  return out.sort((a, b) => a.index - b.index);
}
