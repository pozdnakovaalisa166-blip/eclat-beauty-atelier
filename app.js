/* ÉCLAT Beauty Atelier — клиентская логика (учебная версия).
   Данные каталога: window.ECLAT_CATALOG (assets/catalog.js), заявки: localStorage. */
(function () {
  'use strict';

  var CATALOG = window.ECLAT_CATALOG || { salon: {}, services: [], masters: [] };
  var SERVICES = CATALOG.services || [];
  var MASTERS = CATALOG.masters || [];
  var SALON = CATALOG.salon || {};
  var BOOKING_DAYS = SALON.bookingDays || 30;
  var LEAD_MINUTES = typeof SALON.leadMinutes === 'number' ? SALON.leadMinutes : 60;
  var STORAGE_KEY = 'eclat-bookings';
  var STATUS_LABELS = { new: 'Новая', confirmed: 'Подтверждена', cancelled: 'Отменена', completed: 'Выполнена' };

  var state = freshState();
  var catalogState = { category: 'Все', query: '', sort: 'default' };
  var memoryBookings = null; // запасное хранилище, если localStorage недоступен
  var lastFocus = null;

  function freshState() {
    return { step: 1, serviceId: null, masterId: null, date: '', time: '', name: '', phone: '', consent: false, created: null };
  }

  /* ---------- вспомогательные функции ---------- */
  function $(id) { return document.getElementById(id); }

  function esc(value) {
    return String(value).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function money(n) { return Number(n).toLocaleString('ru-RU') + ' ₽'; }
  function pad(n) { return String(n).padStart(2, '0'); }

  // Дата в локальном часовом поясе в формате YYYY-MM-DD (toISOString даёт UTC и может сдвинуть день)
  function toIsoDate(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }

  function parseIsoDate(iso) {
    var p = String(iso).split('-');
    return new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2]));
  }

  function formatDate(iso) {
    return parseIsoDate(iso).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' });
  }

  function findService(id) { return SERVICES.filter(function (s) { return s.id === id; })[0] || null; }
  function findMaster(id) { return MASTERS.filter(function (m) { return m.id === id; })[0] || null; }

  function showToast(text) {
    var t = $('toast');
    if (!t) return;
    t.textContent = text;
    t.classList.add('show');
    clearTimeout(showToast.timer);
    showToast.timer = setTimeout(function () { t.classList.remove('show'); }, 3200);
  }

  /* ---------- хранилище заявок ---------- */
  function getBookings() {
    if (memoryBookings) return memoryBookings;
    try {
      var data = JSON.parse(localStorage.getItem(STORAGE_KEY));
      return Array.isArray(data) ? data : [];
    } catch (error) {
      return []; // повреждённое значение или недоступное хранилище не должно ломать страницу
    }
  }

  function saveBookings(bookings) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(bookings));
      memoryBookings = null;
      return true;
    } catch (error) {
      memoryBookings = bookings; // приватный режим или переполнение: работаем до закрытия вкладки
      return false;
    }
  }

  function isSlotBusy(masterId, date, time) {
    return getBookings().some(function (b) {
      return b.masterId === masterId && b.date === date && b.time === time && b.status !== 'cancelled';
    });
  }

  function createBooking() {
    var booking = {
      id: 'booking-' + Date.now() + '-' + Math.floor(Math.random() * 1000),
      serviceId: state.serviceId,
      masterId: state.masterId,
      date: state.date,
      time: state.time,
      name: state.name.trim(),
      phone: state.phone.trim(),
      status: 'new',
      createdAt: new Date().toISOString()
    };
    var list = getBookings().slice();
    list.push(booking);
    var persisted = saveBookings(list);
    return { booking: booking, persisted: persisted };
  }

  function activeCount() {
    return getBookings().filter(function (b) { return b.status !== 'cancelled'; }).length;
  }

  function updateCounter() {
    var el = $('bookingCount');
    if (el) el.textContent = String(activeCount());
  }

  /* ---------- расписание ---------- */
  // Базовый набор времени: пн–сб 10:00–19:00, вс 10:00–17:00 (салон закрывается в 20:00 / 18:00)
  function timesForDate(iso) {
    var isSunday = parseIsoDate(iso).getDay() === 0;
    var last = isSunday ? 17 : 19;
    var list = [];
    for (var h = 10; h <= last; h++) list.push(pad(h) + ':00');
    return list;
  }

  function isPast(iso, time) {
    var parts = time.split(':');
    var d = parseIsoDate(iso);
    d.setHours(Number(parts[0]), Number(parts[1]), 0, 0);
    return d.getTime() < Date.now() + LEAD_MINUTES * 60000;
  }

  function dateBounds() {
    var min = new Date();
    var max = new Date();
    max.setDate(max.getDate() + BOOKING_DAYS);
    return { min: toIsoDate(min), max: toIsoDate(max) };
  }

  /* ---------- каталог услуг ---------- */
  function renderFilters() {
    var box = $('filters');
    if (!box) return;
    var cats = ['Все'];
    SERVICES.forEach(function (s) { if (cats.indexOf(s.category) === -1) cats.push(s.category); });
    box.innerHTML = cats.map(function (c) {
      return '<button type="button" class="filter" data-category="' + esc(c) + '" aria-pressed="' +
        (c === catalogState.category) + '">' + esc(c) + '</button>';
    }).join('');
  }

  function renderServices() {
    var grid = $('serviceGrid');
    if (!grid) return;
    if (!SERVICES.length) {
      grid.innerHTML = '<p class="empty">Каталог услуг временно недоступен. Обновите страницу или вернитесь позже.</p>';
      return;
    }
    var q = catalogState.query.trim().toLowerCase();
    var list = SERVICES.filter(function (s) {
      var okCat = catalogState.category === 'Все' || s.category === catalogState.category;
      var okText = !q || (s.name + ' ' + s.description).toLowerCase().indexOf(q) !== -1;
      return okCat && okText;
    });
    if (catalogState.sort === 'asc') list.sort(function (a, b) { return a.price - b.price; });
    if (catalogState.sort === 'desc') list.sort(function (a, b) { return b.price - a.price; });

    if (!list.length) {
      grid.innerHTML = '<p class="empty">По вашему запросу ничего не найдено. Измените категорию или текст поиска.</p>';
      return;
    }
    grid.innerHTML = list.map(function (s) {
      return '<article class="service-card">' +
        '<div class="card-top"><span class="card-symbol" aria-hidden="true">✳</span><span class="category">' + esc(s.category) + '</span></div>' +
        '<h3>' + esc(s.name) + '</h3><p>' + esc(s.description) + '</p>' +
        '<div class="card-bottom"><div><span class="price">' + money(s.price) + '</span> · <span class="duration">' + esc(s.duration) + ' мин</span></div>' +
        '<button type="button" class="card-book" data-service="' + esc(s.id) + '" aria-label="Записаться: ' + esc(s.name) + '">↗</button></div></article>';
    }).join('');
  }

  function renderTeam() {
    var grid = $('teamGrid');
    if (!grid) return;
    if (!MASTERS.length) {
      grid.innerHTML = '<p class="empty">Список мастеров временно недоступен.</p>';
      return;
    }
    grid.innerHTML = MASTERS.map(function (m) {
      return '<article class="team-card"><div class="portrait" style="--portrait:' + esc(m.color || '#dcc9be') + '"><span aria-hidden="true">' + esc(m.initials || '') + '</span></div>' +
        '<h3>' + esc(m.name) + '</h3><p>' + esc(m.role) + ' · ' + esc(m.experience) + '</p>' +
        '<button type="button" class="text-link nav-link" data-master="' + esc(m.id) + '">Записаться ↗</button></article>';
    }).join('');
  }

  /* ---------- диалоги ---------- */
  function openDialog(id) {
    var d = $(id);
    if (!d) return;
    lastFocus = document.activeElement;
    if (typeof d.showModal === 'function') { if (!d.open) d.showModal(); } else { d.setAttribute('open', ''); }
  }

  function closeDialog(id) {
    var d = $(id);
    if (!d) return;
    if (typeof d.close === 'function') { if (d.open) d.close(); } else { d.removeAttribute('open'); }
    if (id === 'bookingDialog') state = freshState();
    if (lastFocus && typeof lastFocus.focus === 'function') lastFocus.focus();
  }

  /* ---------- форма записи ---------- */
  function openBooking(serviceId, masterId) {
    state = freshState();
    if (serviceId && findService(serviceId)) state.serviceId = serviceId;
    if (masterId && findMaster(masterId)) {
      state.masterId = masterId;
      // у мастера один из услуг предвыбирается, если услуга ещё не выбрана
      var m = findMaster(masterId);
      if (!state.serviceId && m.services.length === 1) state.serviceId = m.services[0];
    }
    if (state.serviceId && state.masterId && findMaster(state.masterId).services.indexOf(state.serviceId) === -1) state.masterId = null;
    renderBooking();
    openDialog('bookingDialog');
  }

  function mastersFor(serviceId) {
    return MASTERS.filter(function (m) { return m.services.indexOf(serviceId) !== -1; });
  }

  function renderStepLabels() {
    for (var i = 1; i <= 3; i++) {
      var li = $('stepLabel' + i);
      if (!li) continue;
      li.classList.toggle('active', i === Math.min(state.step, 3));
      if (i === state.step && state.step <= 3) li.setAttribute('aria-current', 'step'); else li.removeAttribute('aria-current');
    }
  }

  function summaryHtml() {
    var s = findService(state.serviceId);
    var m = findMaster(state.masterId);
    var rows = [];
    if (s) rows.push('<p><strong>Услуга:</strong> ' + esc(s.name) + ' — ' + money(s.price) + ', ' + esc(s.duration) + ' мин</p>');
    if (m) rows.push('<p><strong>Мастер:</strong> ' + esc(m.name) + '</p>');
    if (state.date && state.time) rows.push('<p><strong>Время:</strong> ' + esc(formatDate(state.date)) + ', ' + esc(state.time) + '</p>');
    return rows.length ? '<div class="booking-summary">' + rows.join('') + '</div>' : '';
  }

  function renderBooking() {
    var panel = $('bookingPanel');
    var back = $('backButton');
    var next = $('nextButton');
    $('formError').textContent = '';
    renderStepLabels();
    back.hidden = state.step === 1 || state.step === 4;

    if (state.step === 1) {
      var masters = state.serviceId ? mastersFor(state.serviceId) : [];
      panel.innerHTML =
        '<label class="field">Услуга<select id="fService" required><option value="">Выберите услугу</option>' +
        SERVICES.map(function (s) {
          return '<option value="' + esc(s.id) + '"' + (s.id === state.serviceId ? ' selected' : '') + '>' + esc(s.name) + ' — ' + money(s.price) + '</option>';
        }).join('') + '</select></label>' +
        '<label class="field">Мастер<select id="fMaster"' + (state.serviceId ? '' : ' disabled') + ' required><option value="">' +
        (state.serviceId ? 'Выберите мастера' : 'Сначала выберите услугу') + '</option>' +
        masters.map(function (m) {
          return '<option value="' + esc(m.id) + '"' + (m.id === state.masterId ? ' selected' : '') + '>' + esc(m.name) + ' — ' + esc(m.role) + '</option>';
        }).join('') + '</select></label>' + summaryHtml();
      next.textContent = 'Продолжить →';
    } else if (state.step === 2) {
      var b = dateBounds();
      panel.innerHTML =
        '<label class="field">Дата визита<input type="date" id="fDate" min="' + b.min + '" max="' + b.max + '" value="' + esc(state.date) + '" required>' +
        '<small>Запись доступна на ' + BOOKING_DAYS + ' дней вперёд; за ' + LEAD_MINUTES + ' минут до начала запись закрывается.</small></label>' +
        '<div id="slotsBox" role="group" aria-label="Свободное время"></div>' + summaryHtml();
      renderSlots();
      next.textContent = 'Продолжить →';
    } else if (state.step === 3) {
      panel.innerHTML = summaryHtml() +
        '<label class="field">Имя<input id="fName" autocomplete="name" maxlength="60" value="' + esc(state.name) + '" required></label>' +
        '<label class="field">Телефон<input id="fPhone" type="tel" autocomplete="tel" inputmode="tel" placeholder="+7 900 000-00-00" value="' + esc(state.phone) + '" required>' +
        '<small>Используйте вымышленные данные: сайт учебный.</small></label>' +
        '<label class="consent"><input type="checkbox" id="fConsent"' + (state.consent ? ' checked' : '') + '> Понимаю, что данные сохраняются только в этом браузере и не отправляются на сервер.</label>';
      next.textContent = 'Подтвердить запись';
    } else {
      var s = findService(state.created.serviceId), m = findMaster(state.created.masterId);
      panel.innerHTML = '<h3>Запись создана</h3><div class="booking-summary">' +
        '<p><strong>Услуга:</strong> ' + esc(s ? s.name : '') + '</p><p><strong>Мастер:</strong> ' + esc(m ? m.name : '') + '</p>' +
        '<p><strong>Время:</strong> ' + esc(formatDate(state.created.date)) + ', ' + esc(state.created.time) + '</p>' +
        '<p><strong>Статус:</strong> ' + esc(STATUS_LABELS[state.created.status]) + '</p></div>' +
        '<p class="muted">Запись можно посмотреть и отменить в разделе «Мои записи».</p>';
      next.textContent = 'Готово';
    }
  }

  function renderSlots() {
    var box = $('slotsBox');
    if (!box) return;
    if (!state.date) { box.innerHTML = '<p class="muted">Выберите дату, чтобы увидеть свободное время.</p>'; return; }
    var times = timesForDate(state.date);
    var html = '<div class="slots">' + times.map(function (t) {
      var busy = isSlotBusy(state.masterId, state.date, t);
      var past = isPast(state.date, t);
      var off = busy || past;
      return '<button type="button" class="slot" data-time="' + t + '" aria-pressed="' + (state.time === t) + '"' + (off ? ' disabled' : '') + '>' +
        t + (off ? '<small style="display:block;font-size:9px">' + (busy ? 'занято' : 'прошло') + '</small>' : '') + '</button>';
    }).join('') + '</div>';
    box.innerHTML = html;
  }

  function validateStep() {
    var err = '';
    if (state.step === 1) {
      if (!state.serviceId) err = 'Выберите услугу.';
      else if (!state.masterId) err = 'Выберите мастера.';
    } else if (state.step === 2) {
      var b = dateBounds();
      if (!state.date) err = 'Выберите дату визита.';
      else if (state.date < b.min || state.date > b.max) err = 'Выберите дату в пределах ближайших ' + BOOKING_DAYS + ' дней.';
      else if (!state.time) err = 'Выберите свободное время.';
      else if (isPast(state.date, state.time)) err = 'Это время уже недоступно, выберите другое.';
      else if (isSlotBusy(state.masterId, state.date, state.time)) err = 'Это время уже занято, выберите другое.';
    } else if (state.step === 3) {
      var digits = state.phone.replace(/\D/g, '');
      if (!/^[A-Za-zА-Яа-яЁё][A-Za-zА-Яа-яЁё\s'’.-]{1,59}$/.test(state.name.trim())) err = 'Введите имя: от 2 символов, только буквы.';
      else if (!(digits.length === 11 && /^[78]/.test(digits)) && digits.length !== 10) err = 'Введите телефон в формате +7 900 000-00-00.';
      else if (!state.consent) err = 'Подтвердите, что понимаете, где хранятся данные.';
      else if (isSlotBusy(state.masterId, state.date, state.time)) err = 'Это время только что заняли. Вернитесь назад и выберите другое.';
    }
    $('formError').textContent = err;
    return !err;
  }

  function readStep() {
    if (state.step === 3) {
      state.name = $('fName').value;
      state.phone = $('fPhone').value;
      state.consent = $('fConsent').checked;
    }
  }

  function onNext(e) {
    e.preventDefault();
    if (state.step === 4) { closeDialog('bookingDialog'); return; }
    readStep();
    if (!validateStep()) return;
    if (state.step === 3) {
      var res = createBooking();
      state.created = res.booking;
      state.step = 4;
      updateCounter();
      renderBooking();
      if (!res.persisted) $('formError').textContent = 'Браузер не разрешил сохранение: запись будет доступна только до закрытия вкладки.';
      showToast('Запись создана');
      return;
    }
    state.step += 1;
    renderBooking();
  }

  function onBack() {
    readStep();
    if (state.step > 1 && state.step < 4) { state.step -= 1; renderBooking(); }
  }

  function onPanelChange(e) {
    var t = e.target;
    if (t.id === 'fService') {
      state.serviceId = t.value || null;
      var allowed = state.serviceId ? mastersFor(state.serviceId) : [];
      if (!allowed.some(function (m) { return m.id === state.masterId; })) { state.masterId = null; state.time = ''; }
      if (allowed.length === 1) state.masterId = allowed[0].id;
      renderBooking();
    } else if (t.id === 'fMaster') {
      state.masterId = t.value || null;
      state.time = '';
      $('formError').textContent = '';
    } else if (t.id === 'fDate') {
      state.date = t.value;
      state.time = '';
      $('formError').textContent = '';
      renderSlots();
    } else if (t.id === 'fConsent') {
      state.consent = t.checked;
    }
  }

  function onPanelClick(e) {
    var slot = e.target.closest('.slot');
    if (slot && !slot.disabled) {
      state.time = slot.getAttribute('data-time');
      $('formError').textContent = '';
      renderSlots();
    }
  }

  /* ---------- мои записи ---------- */
  function renderAppointments() {
    var box = $('appointmentsList');
    var list = getBookings().slice().sort(function (a, b) { return (a.date + a.time).localeCompare(b.date + b.time); });
    if (!list.length) {
      box.innerHTML = '<p class="empty">Записей пока нет. Нажмите «Записаться», выберите услугу, мастера и время — запись появится здесь.</p>';
      return;
    }
    box.innerHTML = list.map(function (b) {
      var s = findService(b.serviceId), m = findMaster(b.masterId);
      return '<article class="appointment"><h3>' + esc(s ? s.name : 'Услуга удалена из каталога') + '</h3>' +
        '<span class="badge' + (b.status === 'cancelled' ? ' cancelled' : '') + '">' + esc(STATUS_LABELS[b.status] || b.status) + '</span>' +
        '<p>' + esc(formatDate(b.date)) + ', ' + esc(b.time) + ' · ' + esc(m ? m.name : '—') + (s ? ' · ' + money(s.price) : '') + '</p>' +
        '<p class="muted">Клиент: ' + esc(b.name) + ', ' + esc(b.phone) + '</p>' +
        (b.status === 'cancelled' ? '' : '<button type="button" class="button secondary" data-cancel="' + esc(b.id) + '">Отменить запись</button>') +
        '</article>';
    }).join('');
  }

  function cancelBooking(id) {
    if (!window.confirm('Отменить эту запись?')) return;
    var list = getBookings().map(function (b) {
      return b.id === id && b.status !== 'cancelled' ? Object.assign({}, b, { status: 'cancelled' }) : b;
    });
    saveBookings(list);
    updateCounter();
    renderAppointments();
    showToast('Запись отменена');
  }

  /* ---------- конфиденциальность ---------- */
  function updateStorageStatus() {
    var el = $('storageStatus');
    if (!el) return;
    var n = getBookings().length;
    el.textContent = n ? 'Сохранено записей в этом браузере: ' + n + '.' : 'Сохранённых записей нет.';
  }

  function clearData() {
    if (!window.confirm('Удалить все демонстрационные записи в этом браузере?')) return;
    memoryBookings = null;
    try { localStorage.removeItem(STORAGE_KEY); } catch (error) { /* хранилище недоступно */ }
    updateCounter();
    updateStorageStatus();
    showToast('Демоданные удалены');
  }

  /* ---------- инициализация ---------- */
  function init() {
    renderFilters();
    renderServices();
    renderTeam();
    updateCounter();

    $('filters').addEventListener('click', function (e) {
      var btn = e.target.closest('.filter');
      if (!btn) return;
      catalogState.category = btn.getAttribute('data-category');
      renderFilters();
      renderServices();
    });
    $('search').addEventListener('input', function (e) { catalogState.query = e.target.value; renderServices(); });
    $('sort').addEventListener('change', function (e) { catalogState.sort = e.target.value; renderServices(); });

    document.addEventListener('click', function (e) {
      var book = e.target.closest('[data-book]');
      if (book) { openBooking(); return; }
      var svc = e.target.closest('[data-service]');
      if (svc) { openBooking(svc.getAttribute('data-service')); return; }
      var mst = e.target.closest('[data-master]');
      if (mst) { openBooking(null, mst.getAttribute('data-master')); return; }
      var close = e.target.closest('[data-close]');
      if (close) { closeDialog(close.getAttribute('data-close')); return; }
      var cancel = e.target.closest('[data-cancel]');
      if (cancel) cancelBooking(cancel.getAttribute('data-cancel'));
    });

    $('myBookings').addEventListener('click', function () { renderAppointments(); openDialog('appointmentsDialog'); });
    $('privacyButton').addEventListener('click', function () { updateStorageStatus(); openDialog('privacyDialog'); });
    $('clearData').addEventListener('click', clearData);

    var form = $('bookingForm');
    form.addEventListener('submit', onNext);
    $('backButton').addEventListener('click', onBack);
    $('bookingPanel').addEventListener('change', onPanelChange);
    $('bookingPanel').addEventListener('click', onPanelClick);

    // Закрытие окна клавишей Esc или кликом по фону отменяет незавершённый сценарий
    ['bookingDialog', 'appointmentsDialog', 'privacyDialog'].forEach(function (id) {
      var d = $(id);
      d.addEventListener('close', function () { if (id === 'bookingDialog') state = freshState(); });
      d.addEventListener('click', function (e) {
        if (e.target !== d) return;
        var r = d.getBoundingClientRect();
        var outside = e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom;
        if (outside) closeDialog(id);
      });
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
