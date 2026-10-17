// examples/use-streak-card-model.ts — a shape to imitate, not a file to copy.
// The model hook of a Tasks app's streak card (src/features/streak-card/use-streak-card-model.ts):
// it reads today, the stored streak and the countdown, builds the pure summary, and turns it into
// text through the i18n layer. The card component only renders what this returns; it never calls
// addDays, reads .streak or .byDay, or touches the clock.

import { buildStreakSummary } from '@/core/streaks/streak-summary';
import { useNextDayCountdown } from '@/hooks/use-next-day-countdown';
import { useToday } from '@/hooks/use-today';
import { formatWeekdayName } from '@/i18n/format-date';
import { useT } from '@/i18n/t-context';
import { selectStreak, useProgressStore } from '@/stores/progress/progress-store';

import type { DayMark } from '@/core/streaks/streak-summary';

/** One cell of the week strip, ready to render (a row: a right-to-left layout mirrors it). */
export type StreakCell = {
  readonly testID: string; // streak-card.week-day.<n>, n = 1 (six days ago) .. 7 (today)
  readonly mark: DayMark;
  readonly accessibilityLabel: string; // "Saturday, done" (VoiceOver and TalkBack read it)
};

export type StreakCardModel = {
  readonly streakText: string; // "5 days" in the locale's digits and plural forms
  readonly bestText: string;
  readonly newDayText: string | null; // "New day in 3 h 5 min" once today is done, else null
  readonly week: readonly StreakCell[];
};

export function useStreakCardModel(): StreakCardModel {
  const t = useT();
  const today = useToday(); // re-renders at local midnight and on foreground
  const streak = useProgressStore(selectStreak); // the stored section itself: no useShallow needed
  const countdown = useNextDayCountdown(); // called on every render: a hook never sits behind a condition
  const summary = buildStreakSummary(streak, today);
  return {
    streakText: t('streak.days', { daysCount: summary.currentStreak }),
    bestText: t('streak.best', { daysCount: summary.bestStreak }),
    newDayText: summary.isDone ? t('streak.new-day-in', { ...countdown }) : null,
    week: summary.week.map((day, index) => ({
      testID: `streak-card.week-day.${String(index + 1)}`,
      mark: day.mark,
      accessibilityLabel: t(MARK_LABEL[day.mark], { weekdayName: formatWeekdayName(day.date, t) }),
    })),
  };
}

// Literal keys in a typed table (keys are never built: i18n-strings-and-catalogs).
const MARK_LABEL = {
  done: 'streak.week.day-done.a11y-label',
  missed: 'streak.week.day-missed.a11y-label',
  today: 'streak.week.day-today.a11y-label',
} as const;
