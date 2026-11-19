// Joker : banalise UNE soirée de travail de la semaine en cours (le jour même, avant ou après).
// La soirée disparaît du temps libre du jour ; objectifs du jour et de la semaine (temps libre × %) sont donc recalculés,
// ainsi que les quêtes de travail et les caractéristiques. Stocké comme un créneau de planning de type « joker »
// (planOverrides, portée « cette semaine »), donc le planning, les objectifs et les malus le voient sans code en plus.
import { mondayOf } from '../core/calendar.js';
import { dbGet } from '../core/db.js';
import { todayKey, weekKey } from '../core/dates.js';
import { awardXp, removeXp } from '../core/xp.js';
import { recomputeCaracs } from './caracs.js';
import { PENALTIES_START, arePenaltiesActive, dailyWorkMalusXp } from './penalties.js';
import { fromMin, removeOverride, saveOverride, toMin } from './planning.js';
import { recomputeAutoQuests } from './quests.js';
import { dailyGoalHours } from './work-goals.js';

export const JOKERS_PER_WEEK = 1;
export const JOKER_TITLE = 'Joker · soirée banalisée';
const EVENING_FROM = 19 * 60;   // la soirée de travail commence au plus tôt à 19 h

export const jokerEvents = (week) => week.days.flatMap(d => d.events).filter(e => e.type === 'joker');
export const isCurrentWeek = (monday) => monday === mondayOf(todayKey());

// Soirée de travail d'un jour (créneaux de temps libre à partir de 19 h) : { start, end, minutes } ou null.
export function eveningWindow(day) {
  const blocks = day.free.filter(b => toMin(b.end) > EVENING_FROM);
  if (!blocks.length) return null;
  const minutes = blocks.reduce((s, b) => s + toMin(b.end) - Math.max(toMin(b.start), EVENING_FROM), 0);
  if (minutes < 30) return null;
  return { start: fromMin(Math.max(toMin(blocks[0].start), EVENING_FROM)), end: blocks[blocks.length - 1].end, minutes };
}

// Jours où le joker peut servir : semaine en cours, soirée de travail présente.
export function jokerChoices(week) {
  return week.days.map(d => ({ day: d, eve: eveningWindow(d) })).filter(x => x.eve);
}

// Applique un changement de planning sur un jour et remet tout d'équerre : malus quotidien d'un jour déjà évalué,
// quêtes de la semaine, caractéristiques. Les malus / bonus de la semaine en cours seront calculés à sa clôture.
async function withRecalc(date, change) {
  const lastDaily = (await dbGet('meta', 'lastDailyPenalty'))?.value || '';
  const dayFinal = arePenaltiesActive() && date >= PENALTIES_START && date < todayKey() && lastDaily >= date;
  const log = dayFinal ? await dbGet('workLog', date) : null;
  const before = dayFinal ? await dailyGoalHours(date) : 0;
  await change();
  if (dayFinal) {
    const delta = dailyWorkMalusXp(log, await dailyGoalHours(date)) - dailyWorkMalusXp(log, before);
    if (delta > 0) await removeXp(delta, { discipline: Math.round(delta * 0.08) });
    else if (delta < 0) await awardXp(-delta, { discipline: Math.round(-delta * 0.08) });
  }
  await recomputeAutoQuests(weekKey(new Date(date + 'T12:00:00')));
  recomputeCaracs().catch(err => console.error('Caracs failed', err));
}

export async function addJoker(week, date) {
  const day = week.days.find(d => d.date === date);
  const eve = day && eveningWindow(day);
  if (!eve) throw new Error('Pas de soirée de travail ce jour-là.');
  if (jokerEvents(week).length >= JOKERS_PER_WEEK) throw new Error('Joker déjà utilisé cette semaine.');
  await withRecalc(date, () => saveOverride({
    id: `jk-${Date.now()}`, scope: 'week', weekKey: week.monday, op: 'add',
    fields: { type: 'joker', date, start: eve.start, end: eve.end, title: JOKER_TITLE }, createdAt: new Date().toISOString()
  }));
}

export async function removeJoker(ev) {
  const id = String(ev.id).split(':')[1];   // `x:${id}:${date}`
  await withRecalc(ev.date, () => removeOverride(id));
}
