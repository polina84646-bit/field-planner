(function () {
  'use strict';

  var DATA = window.APP_DATA;
  if (!DATA) {
    document.body.textContent = 'Ошибка: данные приложения не загружены.';
    return;
  }

  var STORAGE_PLANS = 'boiler_plans_v1';
  var STORAGE_HISTORY = 'boiler_history_v1';

  var $ = function (id) { return document.getElementById(id); };

  var state = {
    editingId: null,
    checked: new Set(),
    baseline: '',
    savedPlans: [],
    history: [],
    drill: null
  };

  var storageAvailable = true;
  var plansCorrupt = false;
  var historyCorrupt = false;

  /* ---------- storage ---------- */
  function testStorage() {
    try {
      var k = '__bs_test__';
      localStorage.setItem(k, '1');
      localStorage.removeItem(k);
      return true;
    } catch (e) { return false; }
  }

  function readStore(key) {
    try {
      var raw = localStorage.getItem(key);
      if (raw === null) return { ok: true, data: [] };
      var parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) throw new Error('ожидался массив');
      return { ok: true, data: parsed };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  }

  function writeStore(key, data) {
    try {
      localStorage.setItem(key, JSON.stringify(data));
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  }

  function showGlobal(msg, kind) {
    var box = $('global-status');
    if (!box) return;
    box.textContent = msg;
    box.className = 'global-status ' + (kind || 'warn');
    box.hidden = false;
  }

  function hideGlobal() {
    var box = $('global-status');
    if (box) box.hidden = true;
  }

  /* ---------- safe url ---------- */
  function safeUrl(u) {
    if (typeof u !== 'string' || !u) return null;
    try {
      var url = new URL(u);
      if (url.protocol === 'http:' || url.protocol === 'https:') return u;
    } catch (e) {}
    return null;
  }

  /* ---------- form ---------- */
  function fillSelect(select, map) {
    select.textContent = '';
    Object.keys(map).forEach(function (key) {
      var opt = document.createElement('option');
      opt.value = key;
      opt.textContent = map[key];
      select.appendChild(opt);
    });
  }

  function fillConditions() {
    var box = $('f-conditions');
    box.textContent = '';
    Object.keys(DATA.conditions).forEach(function (key) {
      var label = document.createElement('label');
      label.className = 'check';
      var input = document.createElement('input');
      input.type = 'checkbox';
      input.value = key;
      input.addEventListener('change', onFormChange);
      var span = document.createElement('span');
      span.textContent = DATA.conditions[key];
      label.appendChild(input);
      label.appendChild(span);
      box.appendChild(label);
    });
  }

  function getSelectedConditions() {
    var out = [];
    document.querySelectorAll('#f-conditions input[type="checkbox"]').forEach(function (cb) {
      if (cb.checked) out.push(cb.value);
    });
    return out;
  }

  function getFormState() {
    return {
      title: $('f-title').value,
      place: $('f-place').value,
      date: $('f-date').value,
      boilerType: $('f-boilerType').value,
      fuel: $('f-fuel').value,
      conditions: getSelectedConditions(),
      checked: Array.from(state.checked).sort()
    };
  }

  function setFormState(obj) {
    $('f-title').value = obj.title || '';
    $('f-place').value = obj.place || '';
    $('f-date').value = obj.date || '';
    $('f-boilerType').value = obj.boilerType || Object.keys(DATA.boilerTypes)[0];
    $('f-fuel').value = obj.fuel || Object.keys(DATA.fuels)[0];
    document.querySelectorAll('#f-conditions input[type="checkbox"]').forEach(function (cb) {
      cb.checked = (obj.conditions || []).indexOf(cb.value) >= 0;
    });
    state.checked = new Set(obj.checked || []);
    state.editingId = obj.id || null;
    state.baseline = JSON.stringify(getFormState());
    updateFormHeading();
    renderChecklist();
    renderSummary();
  }

  function clearForm() {
    setFormState({
      title: '', place: '', date: '',
      boilerType: Object.keys(DATA.boilerTypes)[0],
      fuel: Object.keys(DATA.fuels)[0],
      conditions: [], checked: []
    });
    setFormStatus('', '');
    hideGlobal();
  }

  function updateFormHeading() {
    $('form-heading').textContent = state.editingId ? 'Редактирование плана' : 'Новый план';
  }

  function setFormStatus(msg, kind) {
    var el = $('form-status');
    el.textContent = msg;
    el.className = 'form-status' + (kind ? ' ' + kind : '');
  }

  function validateForm() {
    var title = $('f-title').value.trim();
    if (!title) return 'Введите название плана.';
    var date = $('f-date').value;
    if (!date) return 'Выберите дату.';
    if (isNaN(Date.parse(date))) return 'Дата указана некорректно.';
    return null;
  }

  function isDirty() {
    return JSON.stringify(getFormState()) !== state.baseline;
  }

  function markChanged() {
    setFormStatus(isDirty() ? 'Есть несохранённые изменения.' : '', '');
  }

  function confirmDiscard() {
    if (!isDirty()) return true;
    return window.confirm('В текущем плане есть несохранённые изменения. Продолжить и потерять их?');
  }

  /* ---------- checklist ---------- */
  function getApplicable(stateObj) {
    return DATA.checklist.filter(function (item) {
      var a = item.applies || {};
      if (a.boilerTypes && a.boilerTypes.length && a.boilerTypes.indexOf(stateObj.boilerType) < 0) return false;
      if (a.fuels && a.fuels.length && a.fuels.indexOf(stateObj.fuel) < 0) return false;
      if (a.conditions && a.conditions.length) {
        var all = a.conditions.every(function (c) { return stateObj.conditions.indexOf(c) >= 0; });
        if (!all) return false;
      }
      return true;
    });
  }

  function renderChecklist() {
    var stateObj = getFormState();
    var items = getApplicable(stateObj);
    var box = $('checklist');
    box.textContent = '';
    var empty = $('checklist-empty');

    if (items.length === 0) {
      empty.hidden = false;
      return;
    }
    empty.hidden = true;

    items.forEach(function (item) {
      var label = document.createElement('label');
      label.className = 'checklist-item';

      var cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.checked = state.checked.has(item.id);
      cb.addEventListener('change', function () {
        if (cb.checked) state.checked.add(item.id);
        else state.checked.delete(item.id);
        renderSummary();
        markChanged();
      });

      var text = document.createElement('span');
      text.className = 'checklist-text';
      text.textContent = item.text;

      var src = document.createElement('span');
      src.className = 'checklist-source';
      var s = DATA.sources[item.source];
      src.textContent = s ? 'Источник: ' + s.org + ', ' + s.title : 'Источник не указан';

      var wrap = document.createElement('span');
      wrap.className = 'checklist-wrap';
      wrap.appendChild(text);
      wrap.appendChild(src);

      label.appendChild(cb);
      label.appendChild(wrap);
      box.appendChild(label);
    });
  }

  function renderSummary() {
    var stateObj = getFormState();
    var items = getApplicable(stateObj);
    var summary = $('summary');
    summary.textContent = '';

    var missing = [];
    if (!$('f-title').value.trim()) missing.push('название');
    if (!$('f-date').value) missing.push('дата');
    if (missing.length) {
      var pm = document.createElement('p');
      pm.className = 'summary-warn';
      pm.textContent = 'Не хватает сведений: ' + missing.join(', ') + '.';
      summary.appendChild(pm);
    }

    if (items.length === 0) {
      var p0 = document.createElement('p');
      p0.textContent = 'Применимых пунктов нет. Выберите тип котла, топливо или условия.';
      summary.appendChild(p0);
      return;
    }

    var checked = items.filter(function (i) { return state.checked.has(i.id); });
    var remaining = items.filter(function (i) { return !state.checked.has(i.id); });

    var head = document.createElement('p');
    head.className = 'summary-head';
    head.textContent = 'Выполнено ' + checked.length + ' из ' + items.length + ' применимых пунктов.';
    summary.appendChild(head);

    if (remaining.length) {
      var h = document.createElement('p');
      h.textContent = 'Осталось:';
      summary.appendChild(h);
      var ul = document.createElement('ul');
      remaining.forEach(function (i) {
        var li = document.createElement('li');
        li.textContent = i.text;
        ul.appendChild(li);
      });
      summary.appendChild(ul);
    }

    var warn = document.createElement('p');
    warn.className = 'summary-warn';
    warn.textContent = 'Количество отметок не означает, что работы безопасны. Решение принимает ответственный человек по производственной инструкции.';
    summary.appendChild(warn);
  }

  function onFormChange() {
    renderChecklist();
    renderSummary();
    markChanged();
  }

  function onSimpleChange() {
    renderSummary();
    markChanged();
  }

  /* ---------- plans ---------- */
  function formatStamp(iso) {
    if (!iso) return '—';
    var d = new Date(iso);
    if (isNaN(d.getTime())) return iso;
    return d.toLocaleString('ru-RU');
  }

  function renderPlans() {
    var box = $('plans-list');
    box.textContent = '';
    if (!state.savedPlans.length) {
      var p = document.createElement('p');
      p.className = 'muted';
      p.textContent = 'Сохранённых планов пока нет. Создайте первый план и нажмите «Сохранить план».';
      box.appendChild(p);
      return;
    }
    state.savedPlans.slice().sort(function (a, b) {
      return String(b.savedAt || '').localeCompare(String(a.savedAt || ''));
    }).forEach(function (plan) {
      var card = document.createElement('div');
      card.className = 'plan-card';

      var info = document.createElement('div');
      info.className = 'plan-info';

      var title = document.createElement('strong');
      title.textContent = plan.title || '(без названия)';
      info.appendChild(title);

      var meta = document.createElement('span');
      meta.className = 'plan-meta';
      var parts = [];
      if (plan.date) parts.push('Дата: ' + plan.date);
      if (plan.boilerType && DATA.boilerTypes[plan.boilerType]) parts.push(DATA.boilerTypes[plan.boilerType]);
      if (plan.savedAt) parts.push('Сохранён: ' + formatStamp(plan.savedAt));
      meta.textContent = parts.join(' · ');
      info.appendChild(meta);

      var actions = document.createElement('div');
      actions.className = 'plan-actions';

      var openBtn = document.createElement('button');
      openBtn.type = 'button';
      openBtn.className = 'btn small';
      openBtn.textContent = 'Открыть';
      openBtn.addEventListener('click', function () { openPlan(plan.id); });

      var delBtn = document.createElement('button');
      delBtn.type = 'button';
      delBtn.className = 'btn small danger';
      delBtn.textContent = 'Удалить';
      delBtn.addEventListener('click', function () { deletePlan(plan.id); });

      actions.appendChild(openBtn);
      actions.appendChild(delBtn);
      card.appendChild(info);
      card.appendChild(actions);
      box.appendChild(card);
    });
  }

  function savePlan() {
    if (plansCorrupt) {
      setFormStatus('Сохранённые планы повреждены. Сохранение отключено, чтобы не потерять данные.', 'error');
      return;
    }
    if (!storageAvailable) {
      setFormStatus('Хранилище браузера недоступно. Сохранение невозможно.', 'error');
      return;
    }
    var err = validateForm();
    if (err) { setFormStatus(err, 'error'); return; }

    var form = getFormState();
    var now = new Date().toISOString();

    if (state.editingId) {
      var idx = state.savedPlans.findIndex(function (p) { return p.id === state.editingId; });
      if (idx >= 0) {
        state.savedPlans[idx] = Object.assign({}, state.savedPlans[idx], form, { savedAt: now });
      } else {
        form.id = state.editingId;
        form.savedAt = now;
        state.savedPlans.push(form);
      }
    } else {
      form.id = 'plan-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8);
      form.savedAt = now;
      state.savedPlans.push(form);
      state.editingId = form.id;
    }

    var res = writeStore(STORAGE_PLANS, state.savedPlans);
    if (!res.ok) {
      setFormStatus('Не удалось сохранить план: ' + res.error, 'error');
      return;
    }
    state.baseline = JSON.stringify(getFormState());
    updateFormHeading();
    setFormStatus('План сохранён. Время: ' + formatStamp(now) + '.', 'ok');
    renderPlans();
  }

  function openPlan(id) {
    var plan = state.savedPlans.find(function (p) { return p.id === id; });
    if (!plan) return;
    if (!confirmDiscard()) return;
    setFormState(plan);
    setFormStatus('План открыт. Изменения сохраняются кнопкой «Сохранить план».', 'ok');
  }

  function deletePlan(id) {
    var plan = state.savedPlans.find(function (p) { return p.id === id; });
    if (!plan) return;
    if (state.editingId === id && !confirmDiscard()) return;
    if (!window.confirm('Удалить план «' + (plan.title || 'без названия') + '»? Действие необратимо.')) return;

    state.savedPlans = state.savedPlans.filter(function (p) { return p.id !== id; });
    var res = writeStore(STORAGE_PLANS, state.savedPlans);
    if (!res.ok) {
      showGlobal('Не удалось обновить хранилище после удаления: ' + res.error, 'error');
      return;
    }
    if (state.editingId === id) {
      clearForm();
      setFormStatus('План удалён.', 'ok');
    }
    renderPlans();
  }

  function newPlan() {
    if (!confirmDiscard()) return;
    clearForm();
    setFormStatus('Создан новый пустой план.', 'ok');
  }

  /* ---------- print ---------- */
  function section(title, build) {
    var s = document.createElement('section');
    var h = document.createElement('h2');
    h.textContent = title;
    s.appendChild(h);
    build(s);
    return s;
  }

  function renderReport() {
    var form = getFormState();
    var items = getApplicable(form);
    var checked = items.filter(function (i) { return state.checked.has(i.id); });
    var remaining = items.filter(function (i) { return !state.checked.has(i.id); });

    var box = $('print-report');
    box.textContent = '';

    var h1 = document.createElement('h1');
    h1.textContent = 'Отчёт: ' + (form.title || '(без названия)');
    box.appendChild(h1);

    var meta = document.createElement('p');
    meta.textContent = 'Сформирован: ' + formatStamp(new Date().toISOString());
    box.appendChild(meta);

    var dl = document.createElement('dl');
    var rows = [
      ['Место', form.place || '—'],
      ['Дата', form.date || '—'],
      ['Тип котла', DATA.boilerTypes[form.boilerType] || '—'],
      ['Топливо', DATA.fuels[form.fuel] || '—'],
      ['Условия', form.conditions.length ? form.conditions.map(function (c) { return DATA.conditions[c]; }).join(', ') : 'не выбраны']
    ];
    rows.forEach(function (r) {
      var dt = document.createElement('dt'); dt.textContent = r[0];
      var dd = document.createElement('dd'); dd.textContent = r[1];
      dl.appendChild(dt); dl.appendChild(dd);
    });
    box.appendChild(dl);

    box.appendChild(section('Чек-лист (выполнено ' + checked.length + ' из ' + items.length + ')', function (parent) {
      if (!items.length) {
        var p = document.createElement('p');
        p.textContent = 'Применимых пунктов нет.';
        parent.appendChild(p);
        return;
      }
      var ul = document.createElement('ul');
      items.forEach(function (i) {
        var li = document.createElement('li');
        li.textContent = (state.checked.has(i.id) ? '☑ ' : '☐ ') + i.text;
        ul.appendChild(li);
      });
      parent.appendChild(ul);
      if (remaining.length) {
        var p = document.createElement('p');
        p.textContent = 'Осталось выполнить: ' + remaining.length + ' п.';
        parent.appendChild(p);
      }
    }));

    box.appendChild(section('Источники', function (parent) {
      var ul = document.createElement('ul');
      Object.keys(DATA.sources).forEach(function (key) {
        var s = DATA.sources[key];
        var li = document.createElement('li');
        li.textContent = s.org + '. ' + s.title + '. Проверено: ' + s.checked + '.';
        var url = safeUrl(s.url);
        if (url) {
          var a = document.createElement('a');
          a.href = url;
          a.textContent = ' Открыть';
          a.target = '_blank';
          a.rel = 'noopener noreferrer';
          li.appendChild(a);
        }
        ul.appendChild(li);
      });
      parent.appendChild(ul);
    }));

    box.appendChild(section('Ограничения', function (parent) {
      var p = document.createElement('p');
      p.textContent = 'Учебный отчёт. Не является разрешением на проведение работ. Решение принимает ответственный человек по производственной инструкции. Планы хранятся в localStorage этого браузера.';
      parent.appendChild(p);
    }));
  }

  function doPrint() {
    var err = validateForm();
    if (err) { setFormStatus(err, 'error'); return; }
    renderReport();
    var pr = $('print-report');
    pr.hidden = false;
    window.print();
    setTimeout(function () { pr.hidden = true; }, 500);
  }

  /* ---------- drill ---------- */
  function renderScenarios() {
    var box = $('scenario-list');
    box.textContent = '';
    DATA.scenarios.forEach(function (sc) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'scenario-btn';
      b.textContent = sc.title;
      b.addEventListener('click', function () { startDrill(sc.id); });
      box.appendChild(b);
    });
  }

  function startDrill(id) {
    var sc = DATA.scenarios.find(function (s) { return s.id === id; });
    if (!sc) return;
    state.drill = { scenario: sc, nodeId: sc.start, log: [], finished: false };
    $('drill-panel').hidden = false;
    renderDrill();
  }

  function renderDrill() {
    var d = state.drill;
    if (!d) return;
    $('drill-title').textContent = d.scenario.title;
    var node = d.scenario.nodes[d.nodeId];
    if (!node) return;
    $('drill-text').textContent = node.text;

    var opts = $('drill-options');
    opts.textContent = '';

    if (!node.options || !node.options.length) {
      if (!d.finished) {
        d.finished = true;
        recordHistory();
      }
      var done = document.createElement('p');
      done.className = 'drill-done';
      done.textContent = 'Сценарий завершён.';
      opts.appendChild(done);
    } else {
      node.options.forEach(function (opt, idx) {
        var b = document.createElement('button');
        b.type = 'button';
        b.className = 'btn option';
        b.textContent = opt.text;
        b.addEventListener('click', function () { chooseOption(idx); });
        opts.appendChild(b);
      });
    }

    renderDrillLog();
  }

  function chooseOption(idx) {
    var d = state.drill;
    if (!d || d.finished) return;
    var node = d.scenario.nodes[d.nodeId];
    var opt = node.options[idx];
    if (!opt) return;
    if (!d.scenario.nodes[opt.next]) { console.error('Нет узла:', opt.next); return; }
    d.log.push({
      nodeId: d.nodeId,
      optionText: opt.text,
      explanation: opt.explanation,
      source: opt.source
    });
    d.nodeId = opt.next;
    renderDrill();
  }

  function renderDrillLog() {
    var d = state.drill;
    var box = $('drill-log');
    box.textContent = '';
    if (!d || !d.log.length) return;
    var h = document.createElement('h3');
    h.textContent = 'Ваши решения';
    box.appendChild(h);
    var ol = document.createElement('ol');
    d.log.forEach(function (entry) {
      var li = document.createElement('li');
      var p1 = document.createElement('p');
      p1.textContent = entry.optionText;
      li.appendChild(p1);
      if (entry.explanation) {
        var p2 = document.createElement('p');
        p2.className = 'drill-exp';
        p2.textContent = entry.explanation;
        li.appendChild(p2);
      }
      if (entry.source && DATA.sources[entry.source]) {
        var s = DATA.sources[entry.source];
        var p3 = document.createElement('p');
        p3.className = 'drill-src';
        p3.textContent = 'Источник: ' + s.org + ', ' + s.title;
        li.appendChild(p3);
      }
      ol.appendChild(li);
    });
    box.appendChild(ol);
  }

  function recordHistory() {
    if (historyCorrupt) {
      showGlobal('История повреждена. Новые прохождения не сохраняются, чтобы не потерять старые записи.', 'error');
      return;
    }
    if (!storageAvailable) {
      showGlobal('Хранилище недоступно. История не сохраняется.', 'warn');
      return;
    }
    var d = state.drill;
    if (!d) return;
    var node = d.scenario.nodes[d.nodeId];
    var entry = {
      id: 'h-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8),
      scenarioId: d.scenario.id,
      scenarioTitle: d.scenario.title,
      outcome: node.text,
      log: d.log.slice(),
      savedAt: new Date().toISOString()
    };
    state.history.push(entry);
    var res = writeStore(STORAGE_HISTORY, state.history);
    if (!res.ok) showGlobal('Не удалось сохранить историю: ' + res.error, 'error');
    renderHistory();
  }

  function renderHistory() {
    var box = $('history-list');
    box.textContent = '';
    if (!state.history.length) {
      var p = document.createElement('p');
      p.className = 'muted';
      p.textContent = 'История пуста. Пройдите сценарий, чтобы сохранить результат.';
      box.appendChild(p);
      return;
    }
    state.history.slice().sort(function (a, b) {
      return String(b.savedAt || '').localeCompare(String(a.savedAt || ''));
    }).forEach(function (entry) {
      var card = document.createElement('div');
      card.className = 'history-card';

      var info = document.createElement('div');
      info.className = 'plan-info';
      var strong = document.createElement('strong');
      strong.textContent = entry.scenarioTitle || '(без названия)';
      info.appendChild(strong);
      var meta = document.createElement('span');
      meta.className = 'plan-meta';
      meta.textContent = formatStamp(entry.savedAt) + ' · ' + (entry.outcome || '');
      info.appendChild(meta);

      var actions = document.createElement('div');
      actions.className = 'plan-actions';

      var openBtn = document.createElement('button');
      openBtn.type = 'button';
      openBtn.className = 'btn small';
      openBtn.textContent = 'Разбор';
      openBtn.addEventListener('click', function () { showHistoryDetail(entry.id); });

      var delBtn = document.createElement('button');
      delBtn.type = 'button';
      delBtn.className = 'btn small danger';
      delBtn.textContent = 'Удалить';
      delBtn.addEventListener('click', function () { deleteHistory(entry.id); });

      actions.appendChild(openBtn);
      actions.appendChild(delBtn);
      card.appendChild(info);
      card.appendChild(actions);
      box.appendChild(card);
    });
  }

  function showHistoryDetail(id) {
    var entry = state.history.find(function (e) { return e.id === id; });
    if (!entry) return;
    var box = $('history-detail');
    box.textContent = '';
    box.hidden = false;

    var h = document.createElement('h3');
    h.textContent = 'Разбор: ' + entry.scenarioTitle;
    box.appendChild(h);

    var meta = document.createElement('p');
    meta.className = 'muted';
    meta.textContent = 'Пройдено: ' + formatStamp(entry.savedAt) + '. Исход: ' + entry.outcome;
    box.appendChild(meta);

    var ol = document.createElement('ol');
    (entry.log || []).forEach(function (step) {
      var li = document.createElement('li');
      var p1 = document.createElement('p');
      p1.textContent = step.optionText;
      li.appendChild(p1);
      if (step.explanation) {
        var p2 = document.createElement('p');
        p2.className = 'drill-exp';
        p2.textContent = step.explanation;
        li.appendChild(p2);
      }
      if (step.source && DATA.sources[step.source]) {
        var s = DATA.sources[step.source];
        var p3 = document.createElement('p');
        p3.className = 'drill-src';
        p3.textContent = 'Источник: ' + s.org + ', ' + s.title;
        li.appendChild(p3);
      }
      ol.appendChild(li);
    });
    box.appendChild(ol);

    var close = document.createElement('button');
    close.type = 'button';
    close.className = 'btn small';
    close.textContent = 'Скрыть разбор';
    close.addEventListener('click', function () { box.hidden = true; });
    box.appendChild(close);
  }

  function deleteHistory(id) {
    if (!window.confirm('Удалить это прохождение из истории?')) return;
    state.history = state.history.filter(function (e) { return e.id !== id; });
    var res = writeStore(STORAGE_HISTORY, state.history);
    if (!res.ok) {
      showGlobal('Не удалось обновить историю: ' + res.error, 'error');
      return;
    }
    renderHistory();
    $('history-detail').hidden = true;
  }

  /* ---------- sources ---------- */
  function renderSources() {
    var box = $('sources-list');
    box.textContent = '';
    Object.keys(DATA.sources).forEach(function (key) {
      var s = DATA.sources[key];
      var card = document.createElement('article');
      card.className = 'source-card';

      var h = document.createElement('h3');
      h.textContent = key + '. ' + s.title;
      card.appendChild(h);

      var org = document.createElement('p');
      org.textContent = 'Организация: ' + s.org;
      card.appendChild(org);

      var note = document.createElement('p');
      note.className = 'muted';
      note.textContent = s.note;
      card.appendChild(note);

      var checked = document.createElement('p');
      checked.className = 'muted';
      checked.textContent = 'Дата проверки: ' + s.checked;
      card.appendChild(checked);

      var url = safeUrl(s.url);
      if (url) {
        var a = document.createElement('a');
        a.href = url;
        a.textContent = 'Открыть источник';
        a.target = '_blank';
        a.rel = 'noopener noreferrer';
        card.appendChild(a);
      }

      box.appendChild(card);
    });
  }

  /* ---------- navigation ---------- */
  function showView(name) {
    document.querySelectorAll('.view').forEach(function (v) {
      v.hidden = v.id !== 'view-' + name;
    });
    document.querySelectorAll('.nav-btn').forEach(function (b) {
      var active = b.dataset.view === name;
      b.classList.toggle('is-active', active);
      if (active) b.setAttribute('aria-current', 'page');
      else b.removeAttribute('aria-current');
    });
  }

  /* ---------- init ---------- */
  function init() {
    storageAvailable = testStorage();
    if (!storageAvailable) {
      showGlobal('Хранилище браузера недоступно. Сохранение планов и истории работать не будет. Проверьте настройки приватности.', 'warn');
    }

    fillSelect($('f-boilerType'), DATA.boilerTypes);
    fillSelect($('f-fuel'), DATA.fuels);
    fillConditions();

    ['f-title', 'f-place', 'f-date'].forEach(function (id) {
      $(id).addEventListener('input', onSimpleChange);
    });
    ['f-boilerType', 'f-fuel'].forEach(function (id) {
      $(id).addEventListener('change', onFormChange);
    });

    $('btn-save').addEventListener('click', savePlan);
    $('btn-new').addEventListener('click', newPlan);
    $('btn-print').addEventListener('click', doPrint);
    $('btn-drill-restart').addEventListener('click', function () {
      if (state.drill) startDrill(state.drill.scenario.id);
    });

    document.querySelectorAll('.nav-btn').forEach(function (b) {
      b.addEventListener('click', function () { showView(b.dataset.view); });
    });

    var plansRes = readStore(STORAGE_PLANS);
    if (plansRes.ok) {
      state.savedPlans = plansRes.data;
    } else {
      plansCorrupt = true;
      showGlobal('Не удалось прочитать сохранённые планы: ' + plansRes.error + '. Создание новых планов отключено, чтобы не перезаписать повреждённые данные.', 'error');
      $('btn-save').disabled = true;
    }

    var histRes = readStore(STORAGE_HISTORY);
    if (histRes.ok) {
      state.history = histRes.data;
    } else {
      historyCorrupt = true;
      showGlobal('Не удалось прочитать историю тренажёра: ' + histRes.error + '. Новые прохождения не сохраняются, чтобы не потерять старые записи.', 'error');
    }

    clearForm();
    renderPlans();
    renderScenarios();
    renderHistory();
    renderSources();
    showView('plans');
  }

  init();
})();