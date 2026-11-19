// Page Planning : emploi du temps de la semaine (cours, colles, DS, temps de travail personnel)
import { MODE_LABELS, SCHOOL_START, YEAR_END, addDays, mondayOf, parseKey } from '../core/calendar.js';

import { todayKey, weekKey } from '../core/dates.js';

import { iconHtml } from '../ui/icons.js';

import { DAY_LABELS, buildWeek, formatDuration, loadOverrides, removeOverride, saveOverride, toMin } from '../features/planning.js';

import { addBtn, el, showToast } from '../ui/helpers.js';
import { JOKER_TITLE, JOKERS_PER_WEEK, addJoker, isCurrentWeek, jokerChoices, jokerEvents, removeJoker } from '../features/joker.js';
import { loadAll } from '../features/seed.js';

import { getCaracSettings, recomputeCaracs, weekGoals } from '../features/caracs.js';
import { weekGoalsFor } from '../features/work-goals.js';
import { DEFAULT_PERIOD_BLOCKS, PLAN_CATS, PLAN_SWATCHES, applyPlanColors, periodBlocksFor, planColor, prefsNow, savePrefs } from '../features/prefs.js';


const view = { monday: null, day: null };
const MIN_MONDAY = mondayOf(SCHOOL_START);
const MAX_MONDAY = mondayOf(YEAR_END);

const fmtShort = (k) => parseKey(k).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
const hhmm = (t) => t.replace(':00', ' h').replace(':', ' h ');
const range = (a, b) => `${hhmm(a)} – ${hhmm(b)}`;

// Hauteur proportionnelle à la durée, mais compressée (plancher / plafond) pour garder une journée lisible.
const spanMin = (start, end) => Math.max(0, (end ? toMin(end) : toMin(start) + 60) - toMin(start));
const hCard = (min) => Math.round(Math.min(150, Math.max(58, 34 + min * 0.45)));
const hFree = (min) => Math.round(Math.min(150, Math.max(46, 30 + min * 0.4)));
const hPause = (min) => Math.round(Math.min(52, Math.max(30, 22 + min * 0.2)));
const nowMin = () => { const d = new Date(); return d.getHours() * 60 + d.getMinutes(); };
const live = (day, start, end) => day.date === todayKey() && nowMin() >= toMin(start) && nowMin() < (end ? toMin(end) : toMin(start) + 60);

function timeCol(start, end) {
  return el('div', { class: 'pl-time' }, [el('span', {}, hhmm(start)), el('span', { class: 'pl-time-end' }, end ? hhmm(end) : '')]);
}

function eventCard(ev, onTap, day) {
  const meta = [ev.teacher, ev.room ? `salle ${ev.room}` : null].filter(Boolean).join(' · ');
  const min = spanMin(ev.start, ev.end);
  const dur = ev.type === 'ds' ? (ev.hours ? `${ev.hours} h` : 'durée à préciser') : null;
  const isLive = live(day, ev.start, ev.end);
  return el('div', { class: `pl-card pl-${ev.type} pl-tap${isLive ? ' pl-now' : ''}`, style: `min-height:${hCard(min)}px`, onclick: () => onTap(ev) }, [
    timeCol(ev.start, ev.end),
    el('div', { class: 'pl-body' }, [
      el('div', { class: 'pl-title' }, [ev.title, dur ? el('span', { class: 'pl-chip' }, dur) : null, isLive ? el('span', { class: 'pl-chip pl-chip-live' }, 'en cours') : null]),
      meta ? el('div', { class: 'pl-meta' }, meta) : null,
      min >= 75 ? el('div', { class: 'pl-dur' }, formatDuration(min)) : null
    ])
  ]);
}

function freeCard(b, onTap, day) {
  const min = toMin(b.end) - toMin(b.start);
  const isLive = live(day, b.start, b.end);
  return el('div', { class: `pl-card pl-free${b.ev ? ' pl-tap' : ''}${isLive ? ' pl-now' : ''}`, style: `min-height:${hFree(min)}px`, onclick: b.ev ? () => onTap(b.ev) : null }, [
    timeCol(b.start, b.end),
    el('div', { class: 'pl-body' }, [el('div', { class: 'pl-title' }, [b.title || 'Travail personnel', el('span', { class: 'pl-chip' }, formatDuration(min))])])
  ]);
}

// Pause : pas de boîte, une simple bande en fond (modifiable au toucher comme les autres créneaux).
function pauseCard(p, onTap) {
  const min = spanMin(p.start, p.end);
  const tint = p.type === 'trajet' ? ';--ev-pause:var(--ev-trajet)' : '';   // même bande que la pause repas, couleur de la catégorie
  return el('div', { class: 'pl-card pl-pause pl-tap', style: `min-height:${hPause(min)}px${tint}`, onclick: () => onTap(p) }, [
    timeCol(p.start, p.end),
    el('div', { class: 'pl-body' }, [el('div', { class: 'pl-title' }, p.title || 'Pause repas')])
  ]);
}

function dayList(day, mode, onTap) {
  const items = [...day.events.map(e => ({ t: toMin(e.start), node: eventCard(e, onTap, day) })), ...day.free.map(b => ({ t: toMin(b.start), node: freeCard(b, onTap, day) })), ...day.pauses.map(p => ({ t: toMin(p.start), node: pauseCard(p, onTap) }))]
    .sort((a, b) => a.t - b.t).map(x => x.node);
  const wrap = el('div', { class: 'pl-list' });
  const note = day.period ? null : day.info.holiday ? `Jour férié · ${day.info.holiday}` : day.info.vacation ? `Vacances · ${day.info.vacation}` : null;
  if (note) wrap.appendChild(el('div', { class: 'pl-note' }, note));
  if (!day.events.length && !note && !day.period && mode !== 'normal') wrap.appendChild(el('div', { class: 'pl-note' }, 'Pas de cours : journée libre.'));
  items.forEach(n => wrap.appendChild(n));
  return wrap;
}

export async function renderPlanning(root) {
  if (!root.classList.contains('page')) { const pg = el('div', { class: 'page' }); root.innerHTML = ''; root.appendChild(pg); root = pg; }
  const today = todayKey();
  if (!view.monday) view.monday = mondayOf(today);
  const rerender = () => { root.innerHTML = ''; renderPlanning(root); };
  const week = await buildWeek(view.monday);
  if (view.day === null || view.day === undefined) view.day = (today >= week.monday && today <= addDays(week.monday, 6)) ? week.days.findIndex(d => d.date === today) : 0;
  root.innerHTML = '';

  const go = (delta) => {
    const next = addDays(view.monday, delta * 7);
    if (next < MIN_MONDAY || next > MAX_MONDAY) return;
    view.monday = next; view.day = 0; root.innerHTML = ''; renderPlanning(root);
  };
  const title = week.index !== null ? `Semaine ${week.index}` : 'Semaine';
  root.appendChild(el('div', { class: 'page-title' }, [
    el('h1', {}, 'Planning'),
    el('button', { class: 'btn ghost sm', 'aria-label': 'Couleurs du planning', onclick: () => openColors(rerender), html: iconHtml('target') })
  ]));
  root.appendChild(el('div', { class: 'pl-head' }, [
    el('button', { class: 'pl-nav', onclick: () => go(-1), 'aria-label': 'Semaine précédente', html: iconHtml('chevl') }),
    el('div', { class: 'pl-head-mid' }, [
      el('div', { class: 'pl-week' }, `${title !== 'Semaine' ? title + ' · ' : ''}${fmtShort(week.monday)} – ${fmtShort(addDays(week.monday, 6))}`),
      MODE_LABELS[week.mode] ? el('div', { class: 'pl-mode' }, MODE_LABELS[week.mode]) : null
    ]),
    el('button', { class: 'pl-nav', onclick: () => go(1), 'aria-label': 'Semaine suivante', html: iconHtml('chevr') })
  ]));
  // Temps libre de la semaine et travail attendu (même calcul que les quêtes : temps libre × % des Options ;
  // avant la 1re semaine « dynamique », l'ancien objectif fixe).
  const goals = await weekGoalsFor(week.monday);
  const pct = (await getCaracSettings()).workPct;
  const allRest = week.days.every(d => d.period?.kind === 'rest');   // semaine de concours : repos
  root.appendChild(el('div', { class: 'pl-stats' }, allRest ? [
    el('div', { class: 'pl-stat' }, [el('span', { class: 'pl-stat-l' }, 'Période'), el('b', { class: 'pl-stat-v' }, 'Concours')]),
    el('div', { class: 'pl-stat' }, [el('span', { class: 'pl-stat-l' }, 'Travail attendu'), el('b', { class: 'pl-stat-v accent' }, 'Repos · aucun')])
  ] : [
    el('div', { class: 'pl-stat' }, [el('span', { class: 'pl-stat-l' }, 'Temps libre'), el('b', { class: 'pl-stat-v' }, formatDuration(week.freeMinutes))]),
    el('div', { class: 'pl-stat' }, [el('span', { class: 'pl-stat-l' }, goals.dynamic ? `Travail attendu · ${pct} %` : 'Travail attendu · objectif fixe'), el('b', { class: 'pl-stat-v accent' }, formatDuration(Math.round(goals.total)))])
  ]));
  const jokers = jokerEvents(week);
  if (jokers.length) {
    const jd = week.days.find(d => d.date === jokers[0].date);
    root.appendChild(el('button', { type: 'button', class: 'pl-joker-note', onclick: () => openJoker(week, goals, rerender, jokers[0]) },
      [el('span', { html: iconHtml('star') }), `Joker : soirée du ${jd.label.toLowerCase()} ${parseKey(jd.date).getDate()} banalisée`]));
  }
  root.appendChild(el('div', { class: 'pl-days' }, week.days.map((d, i) => el('button', {
    class: `pl-day${i === view.day ? ' active' : ''}${d.date === today ? ' today' : ''}`,
    onclick: () => { view.day = i; root.innerHTML = ''; renderPlanning(root); }
  }, [el('span', {}, d.label.slice(0, 3)), el('b', {}, String(parseKey(d.date).getDate())),
      el('i', { class: (d.events.length || (d.period?.kind !== 'rest' && (d.info.vacation || d.info.holiday))) ? 'on' : '' })]))));

  root.appendChild(el('div', { class: 'pl-legend' }, PLAN_CATS.map(c => [c.label, `var(--ev-${c.key})`]).map(([l, c]) => el('span', { style: `--c:${c}` }, l))));

  if (week.unscheduled.length) {
    root.appendChild(el('div', { class: 'pl-card pl-colle pl-unsched pl-tap' }, [
      el('div', { class: 'pl-body' }, week.unscheduled.map(e => el('div', { onclick: () => openEditor(e, week, rerender) }, [
        el('div', { class: 'pl-title' }, [e.title, el('span', { class: 'pl-chip' }, 'créneau à choisir')]),
        el('div', { class: 'pl-meta' }, [e.teacher, e.note].filter(Boolean).join(' · '))
      ])))
    ]));
  }
  const banner = periodBanner(week.days[view.day], rerender);
  if (banner) root.appendChild(banner);
  root.appendChild(dayList(week.days[view.day], week.mode, (ev) => (ev.type === 'joker' ? openJoker(week, goals, rerender, ev) : openEditor(ev, week, rerender))));
  root.appendChild(addBtn('Ajouter un créneau', () => openEditor(null, week, rerender), 'pl-add'));
  if (isCurrentWeek(week.monday) && jokers.length < JOKERS_PER_WEEK && jokerChoices(week).length) {
    root.appendChild(el('button', { type: 'button', class: 'add-btn pl-add pl-joker-btn', onclick: () => openJoker(week, goals, rerender) }, [el('span', { class: 'add-plus', html: iconHtml('star') }), ' Utiliser mon joker']));
  }
}

// ── Joker : banalise une soirée de travail de la semaine en cours ───────────
async function openJoker(week, goals, rerender, ev = null) {
  const close = () => overlay.remove();
  const body = el('div', { class: 'pl-form' });
  const overlay = el('div', { class: 'gpx-preview-overlay', onclick: (e) => { if (e.target === overlay) close(); } });
  const modal = el('div', { class: 'gpx-preview-modal' }, [
    el('div', { class: 'gpx-preview-head' }, [
      el('div', { class: 'gpx-preview-title' }, [el('span', { class: 'gpx-preview-icon', html: iconHtml('star') }), el('span', {}, 'Joker')]),
      el('button', { class: 'gpx-preview-close', 'aria-label': 'Fermer', onclick: close, html: iconHtml('close') })
    ]),
    body
  ]);
  overlay.appendChild(modal);
  document.body.appendChild(overlay);
  const fail = (e) => showToast({ type: 'err', title: 'Joker', text: e.message }, 3500);

  if (ev) {   // joker déjà posé : on peut le retirer
    const d = week.days.find(x => x.date === ev.date);
    body.append(
      el('div', { class: 'pl-hint' }, `Soirée du ${d.label.toLowerCase()} ${parseKey(d.date).getDate()} banalisée (${range(ev.start, ev.end)}).`),
      el('button', { class: 'btn full danger', onclick: async () => {
        try { await removeJoker(ev); await loadAll(); close(); rerender(); showToast({ type: 'xp', title: 'Joker retiré', text: 'Objectifs recalculés.' }, 3000); } catch (e) { fail(e); }
      } }, 'Retirer le joker')
    );
    return;
  }

  const choices = jokerChoices(week);
  let pick = (choices.find(c => c.day.date === todayKey()) || choices[0]).day.date;
  const cfg = await getCaracSettings();
  const info = el('div', { class: 'pl-hint' });
  const catBox = el('div', { class: 'pl-cats', role: 'radiogroup', 'aria-label': 'Soirée à banaliser' });
  const paint = () => {
    catBox.replaceChildren(...choices.map(({ day, eve }) => el('button', {
      type: 'button', role: 'radio', class: 'pl-cat' + (day.date === pick ? ' on' : ''), 'aria-checked': String(day.date === pick),
      onclick: () => { pick = day.date; paint(); }
    }, `${day.label.slice(0, 3)} ${parseKey(day.date).getDate()} · ${formatDuration(eve.minutes)}`)));
    const eve = choices.find(c => c.day.date === pick).eve;
    if (goals.dynamic) {
      const after = Math.round(weekGoals(cfg, week.monday, Math.max(0, week.freeMinutes - eve.minutes)).total);
      info.textContent = `Temps libre −${formatDuration(eve.minutes)} · travail attendu ${formatDuration(Math.round(goals.total))} → ${formatDuration(after)}`;
    } else info.textContent = `Temps libre −${formatDuration(eve.minutes)}`;
  };
  paint();
  body.append(
    el('div', { class: 'pl-hint' }, `Banalise une soirée de travail de cette semaine (${JOKERS_PER_WEEK} par semaine).`),
    catBox, info,
    el('button', { class: 'btn full', onclick: async (e) => {
      e.currentTarget.disabled = true;
      try { await addJoker(week, pick); await loadAll(); close(); rerender(); showToast({ type: 'xp', icon: 'star', title: JOKER_TITLE, text: 'Objectifs de la semaine recalculés.' }, 3500); }
      catch (err) { fail(err); e.currentTarget.disabled = false; }
    } }, 'Utiliser le joker')
  );
}

// ── Édition d'un créneau (sans jamais toucher à l'emploi du temps de base) ───
const field = (label, input) => el('label', { class: 'pl-field' }, [el('span', {}, label), input]);

function openEditor(ev, week, rerender) {
  const isNew = !ev;
  const cur = ev || { title: '', start: '', end: '', teacher: '', room: '', date: week.days[view.day].date };
  const dayIdx = cur.date ? Math.max(0, Math.round((parseKey(cur.date) - parseKey(week.monday)) / 86400000)) : view.day;
  const close = () => overlay.remove();
  const inTitle = el('input', { type: 'text', value: cur.title || '', placeholder: 'Intitulé' });
  const inDay = el('select', {}, DAY_LABELS.map((l, i) => el('option', i === dayIdx ? { value: i + 1, selected: 'selected' } : { value: i + 1 }, l)));
  const inStart = el('input', { type: 'time', value: cur.start || '' });
  const inEnd = el('input', { type: 'time', value: cur.end || '' });
  let curCat = PLAN_CATS.some(c => c.key === cur.type) ? cur.type : 'autre';
  // Catégories : pastille de couleur à gauche du nom ; les champs proposés dépendent de la catégorie.
  const catBox = el('div', { class: 'pl-cats', role: 'radiogroup', 'aria-label': 'Catégorie' }, PLAN_CATS.map(c => el('button', {
    type: 'button', role: 'radio', 'data-k': c.key, class: 'pl-cat' + (c.key === curCat ? ' on' : ''), 'aria-checked': String(c.key === curCat), onclick: () => setCat(c.key)
  }, [el('span', { class: 'pl-cat-dot', style: `background:var(--ev-${c.key})` }), c.label])));
  const inTeacher = el('input', { type: 'text', value: cur.teacher || '', placeholder: 'Professeur' });
  const inRoom = el('input', { type: 'text', value: cur.room || '', placeholder: 'Salle' });
  const fTeacher = field('Professeur', inTeacher), fRoom = field('Salle', inRoom);
  const showsTeacher = () => curCat === 'cours' || curCat === 'colle';
  const showsRoom = () => curCat === 'cours' || curCat === 'colle' || curCat === 'ds';
  function setCat(k) {
    const prev = curCat; curCat = k;
    catBox.querySelectorAll('.pl-cat').forEach(b => { const on = b.dataset.k === k; b.classList.toggle('on', on); b.setAttribute('aria-checked', String(on)); });
    fTeacher.hidden = !showsTeacher(); fRoom.hidden = !showsRoom();
    const DEF = { pause: 'Pause repas', trajet: 'Retour à la maison' };   // intitulé proposé pour ces catégories
    if (DEF[k] && (!inTitle.value.trim() || inTitle.value.trim() === DEF[prev])) inTitle.value = DEF[k];
    else if (!DEF[k] && DEF[prev] && inTitle.value.trim() === DEF[prev]) inTitle.value = '';
  }
  const recurring = isNew || !!ev.recurKey;
  let scope = 'week';
  const scopeBox = recurring ? el('div', { class: 'pl-scope' }, [
    el('button', { class: 'pl-seg active', onclick: (e) => setScope('week', e) }, 'Cette semaine'),
    el('button', { class: 'pl-seg', onclick: (e) => setScope('all', e) }, 'Toutes les semaines')
  ]) : null;
  function setScope(v, e) { scope = v; scopeBox.querySelectorAll('.pl-seg').forEach(b => b.classList.toggle('active', b === e.currentTarget)); }

  const fields = () => ({ type: curCat, day: Number(inDay.value), start: inStart.value, end: inEnd.value, title: inTitle.value.trim(), teacher: showsTeacher() ? (inTeacher.value.trim() || null) : null, room: showsRoom() ? (inRoom.value.trim() || null) : null });
  const stamp = () => new Date().toISOString();
  const done = () => { close(); rerender(); };

  const save = async () => {
    const f = fields();
    if (!f.title || !f.start || !f.end || f.end <= f.start) { inEnd.classList.add('pl-bad'); return; }
    const id = `ov-${Date.now()}`;
    if (isNew) await saveOverride({ id, scope, weekKey: week.monday, op: 'add', fields: f, createdAt: stamp() });
    else await saveOverride({ id, scope, weekKey: week.monday, op: 'modify', targetId: scope === 'all' ? ev.recurKey : ev.id, fields: f, createdAt: stamp() });
    done();
  };
  const remove = async () => {
    await saveOverride({ id: `ov-${Date.now()}`, scope, weekKey: week.monday, op: 'delete', targetId: scope === 'all' ? ev.recurKey : ev.id, createdAt: stamp() });
    done();
  };
  const revert = async () => {
    for (const ov of await loadOverrides()) {
      if ((ov.scope === 'week' && ov.targetId === ev.id) || (ov.scope === 'all' && ov.targetId === ev.recurKey)) await removeOverride(ov.id);
    }
    done();
  };

  const overlay = el('div', { class: 'gpx-preview-overlay', onclick: (e) => { if (e.target === overlay) close(); } });
  const modal = el('div', { class: 'gpx-preview-modal' }, [
    el('div', { class: 'gpx-preview-head' }, [
      el('div', { class: 'gpx-preview-title' }, isNew ? 'Nouveau créneau' : 'Modifier le créneau'),
      el('button', { class: 'gpx-preview-close', 'aria-label': 'Fermer', onclick: close, html: iconHtml('close') })
    ]),
    el('div', { class: 'pl-form' }, [
      el('div', { class: 'pl-field' }, [el('span', {}, 'Catégorie'), catBox]), field('Intitulé', inTitle), field('Jour', inDay),
      el('div', { class: 'pl-row2' }, [field('Début', inStart), field('Fin', inEnd)]),
      fTeacher, fRoom,
      scopeBox ? el('div', { class: 'pl-hint' }, 'S\u2019applique à :') : null, scopeBox,
      el('button', { class: 'btn full', onclick: save }, 'Enregistrer'),
      !isNew ? el('button', { class: 'btn full danger', onclick: remove }, 'Supprimer') : null,
      (!isNew && ev.modified) ? el('button', { class: 'btn full', onclick: revert }, 'Rétablir l\u2019original') : null
    ])
  ]);
  fTeacher.hidden = !showsTeacher(); fRoom.hidden = !showsRoom();
  overlay.appendChild(modal);
  document.body.appendChild(overlay);
}

// ── Couleurs du planning : une couleur par catégorie (cours, colle, DS, temps libre, autre) ──
function openColors(rerender) {
  const close = () => { overlay.remove(); rerender(); };
  const body = el('div', { class: 'pl-form' });
  const draw = () => {
    body.innerHTML = '';
    for (const c of PLAN_CATS) {
      const cur = planColor(c.key);
      const set = async (v) => { await savePrefs({ planColors: { ...prefsNow().planColors, [c.key]: v } }); applyPlanColors(); draw(); };
      const picker = el('input', { type: 'color', class: 'pl-color-in', value: cur, 'aria-label': `Couleur personnalisée : ${c.label}` });
      picker.addEventListener('change', () => set(picker.value));
      body.appendChild(el('div', { class: 'pl-color-row' }, [
        el('div', { class: 'pl-color-name' }, [el('span', { class: 'pl-color-dot', style: `background:${cur}` }), c.label]),
        el('div', { class: 'pl-swatches' }, [
          ...PLAN_SWATCHES.map(h => el('button', { type: 'button', class: 'pl-sw' + (h.toLowerCase() === cur.toLowerCase() ? ' on' : ''), style: `background:${h}`, 'aria-label': h, onclick: () => set(h) })),
          picker
        ])
      ]));
    }
    body.appendChild(el('button', { class: 'btn full', onclick: async () => { await savePrefs({ planColors: {} }); applyPlanColors(); draw(); } }, 'Couleurs d\u2019origine'));
  };
  draw();
  const overlay = el('div', { class: 'gpx-preview-overlay', onclick: (e) => { if (e.target === overlay) close(); } });
  overlay.appendChild(el('div', { class: 'gpx-preview-modal' }, [
    el('div', { class: 'gpx-preview-head' }, [
      el('div', { class: 'gpx-preview-title' }, 'Couleurs du planning'),
      el('button', { class: 'gpx-preview-close', 'aria-label': 'Fermer', onclick: close, html: iconHtml('close') })
    ]), body
  ]));
  document.body.appendChild(overlay);
}

// ── Périodes à horaires particuliers : bandeau du jour + réglage des horaires ───
// Concours : repos, aucun objectif. Vacances / révisions : planning simplifié, modèle commun + réglage jour par jour.
function periodBanner(day, rerender) {
  const per = day.period;
  if (!per) return null;
  if (per.kind === 'rest') {
    return el('div', { class: 'pl-banner' }, [
      el('div', { class: 'pl-banner-t' }, 'Concours · repos'),
      el('div', { class: 'pl-banner-s' }, 'Aucun objectif de travail. Ce que tu travailles malgré tout compte en bonus.')
    ]);
  }
  const hasDay = !!prefsNow().periodDays?.[day.date];
  return el('div', { class: 'pl-banner' }, [
    el('div', { class: 'pl-banner-t' }, `${per.label} · horaires simplifiés`),
    el('div', { class: 'pl-banner-s' }, hasDay ? 'Ce jour a ses propres horaires.' : 'Le modèle commun à toutes les vacances et révisions s’applique.'),
    el('div', { class: 'pl-banner-a' }, [
      el('button', { class: 'btn sm', onclick: () => openBlocks({ title: 'Horaires de la période', sub: 'S’appliquent à tous les jours des vacances et des révisions (sauf ceux que tu as modifiés un par un).', blocks: prefsNow().periodTemplate || DEFAULT_PERIOD_BLOCKS, save: async (b) => { await savePrefs({ periodTemplate: b }); }, reset: async () => { await savePrefs({ periodTemplate: null }); }, resetLabel: 'Revenir aux horaires par défaut', rerender }) }, 'Horaires de la période'),
      el('button', { class: 'btn sm', onclick: () => openBlocks({ title: 'Modifier ce jour', sub: `Uniquement le ${parseKey(day.date).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' })}.`, blocks: periodBlocksFor(day.date), save: async (b) => { await savePrefs({ periodDays: { ...prefsNow().periodDays, [day.date]: b } }); }, reset: hasDay ? async () => { const d = { ...prefsNow().periodDays }; delete d[day.date]; await savePrefs({ periodDays: d }); } : null, resetLabel: 'Rétablir le modèle commun', rerender }) }, 'Modifier ce jour')
    ])
  ]);
}

// Éditeur de blocs : travail / pause. Tout ce qui est après le dernier bloc est de la soirée libre (ni affichée, ni comptée).
function openBlocks({ title, sub, blocks, save, reset, resetLabel, rerender }) {
  let rows = blocks.map(b => ({ ...b }));
  const body = el('div', { class: 'pl-form' });
  const close = () => overlay.remove();
  const total = () => rows.filter(r => r.kind === 'work' && r.start && r.end && r.end > r.start).reduce((t, r) => t + toMin(r.end) - toMin(r.start), 0);
  const msg = el('div', { class: 'pl-blocks-msg dim text-xs' });
  const draw = () => {
    body.innerHTML = '';
    body.appendChild(el('div', { class: 'dim text-xs' }, sub));
    rows.forEach((r, i) => {
      const kind = el('select', { 'aria-label': 'Type' }, [el('option', r.kind === 'work' ? { value: 'work', selected: 'selected' } : { value: 'work' }, 'Travail'), el('option', r.kind === 'pause' ? { value: 'pause', selected: 'selected' } : { value: 'pause' }, 'Pause')]);
      const st = el('input', { type: 'time', value: r.start, 'aria-label': 'Début' }), en = el('input', { type: 'time', value: r.end, 'aria-label': 'Fin' });
      kind.addEventListener('change', () => { r.kind = kind.value; upd(); });
      st.addEventListener('change', () => { r.start = st.value; upd(); }); en.addEventListener('change', () => { r.end = en.value; upd(); });
      body.appendChild(el('div', { class: 'pl-block-row' }, [
        el('span', { class: 'pl-cat-dot', style: `background:var(--ev-${r.kind === 'work' ? 'libre' : 'pause'})` }),
        kind, st, en,
        el('button', { type: 'button', class: 'btn ghost sm', 'aria-label': 'Supprimer ce bloc', onclick: () => { rows.splice(i, 1); draw(); }, html: iconHtml('close') })
      ]));
    });
    body.appendChild(el('button', { type: 'button', class: 'btn full', onclick: () => { const last = rows[rows.length - 1]; const s0 = last ? last.end : '08:00'; const e0 = s0 < '22:00' ? fromMinSafe(Math.min(toMin(s0) + 120, 23 * 60 + 59)) : '23:59'; rows.push({ kind: 'work', start: s0, end: e0 }); draw(); } }, '+ Ajouter un bloc'));
    body.appendChild(msg);
    upd();
    body.appendChild(el('div', { class: 'pl-blocks-note dim text-xs' }, 'Après le dernier bloc : soirée libre (non comptée comme travail).'));
    body.appendChild(el('button', { class: 'btn primary full', onclick: submit }, 'Enregistrer'));
    if (reset) body.appendChild(el('button', { class: 'btn full', onclick: async () => { await reset(); finish(); } }, resetLabel));
  };
  const upd = () => { msg.textContent = `Temps de travail : ${formatDuration(total())}`; msg.classList.remove('pl-bad-t'); };
  const fromMinSafe = (m) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
  const finish = () => { close(); recomputeCaracs().catch(() => {}); rerender(); };
  const submit = async () => {
    const ok = rows.every(r => r.start && r.end && r.end > r.start);
    const sorted = [...rows].sort((a, b) => a.start.localeCompare(b.start));
    const overlap = sorted.some((r, i) => i > 0 && r.start < sorted[i - 1].end);
    if (!ok || overlap) { msg.textContent = !ok ? 'Chaque bloc doit finir après son début.' : 'Les blocs ne doivent pas se chevaucher.'; msg.classList.add('pl-bad-t'); return; }
    await save(sorted.map(r => ({ start: r.start, end: r.end, kind: r.kind })));
    finish();
  };
  const overlay = el('div', { class: 'gpx-preview-overlay', onclick: (e) => { if (e.target === overlay) close(); } });
  overlay.appendChild(el('div', { class: 'gpx-preview-modal' }, [
    el('div', { class: 'gpx-preview-head' }, [el('div', { class: 'gpx-preview-title' }, title), el('button', { class: 'gpx-preview-close', 'aria-label': 'Fermer', onclick: close, html: iconHtml('close') })]),
    body
  ]));
  draw();
  document.body.appendChild(overlay);
}
