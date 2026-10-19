"use strict";

(() => {
  const DB_NAME = "academy-homework-db";
  const DB_VERSION = 1;
  const STORE_NAME = "assignments";
  const LEGACY_KEY = "academy-homework-assignments-v1";
  const state = { assignments: [], query: "", db: null, selectedFile: null };

  const elements = {
    grid: document.querySelector("#assignmentGrid"),
    empty: document.querySelector("#emptyState"),
    emptyTitle: document.querySelector("#emptyTitle"),
    emptyDescription: document.querySelector("#emptyDescription"),
    modal: document.querySelector("#assignmentModal"),
    form: document.querySelector("#assignmentForm"),
    title: document.querySelector("#assignmentName"),
    category: document.querySelector("#assignmentCategory"),
    description: document.querySelector("#assignmentDescription"),
    file: document.querySelector("#assignmentFile"),
    uploadArea: document.querySelector("#uploadArea"),
    uploadTitle: document.querySelector("#uploadTitle"),
    uploadHint: document.querySelector("#uploadHint"),
    search: document.querySelector("#searchInput"),
    loader: document.querySelector("#pageLoader"),
    sidebar: document.querySelector(".sidebar"),
    menuToggle: document.querySelector("#menuToggle")
  };

  const icons = {
    file: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/></svg>',
    check: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12 4 4L19 6"/></svg>',
    edit: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L8 18l-4 1 1-4Z"/></svg>',
    trash: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 6h18M8 6V4h8v2m-11 0 1 14h12l1-14M10 10v6m4-6v6"/></svg>'
  };

  function openDatabase() {
    return new Promise((resolve, reject) => {
      if (!("indexedDB" in window)) {
        reject(new Error("Этот браузер не поддерживает IndexedDB."));
        return;
      }

      const request = window.indexedDB.open(DB_NAME, DB_VERSION);

      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME, { keyPath: "id" });
        }
      };

      request.onsuccess = () => {
        const db = request.result;
        db.onversionchange = () => db.close();
        resolve(db);
      };

      request.onerror = () => reject(request.error || new Error("Не удалось открыть базу данных."));
      request.onblocked = () => reject(new Error("База данных заблокирована другой вкладкой. Закройте другие вкладки сайта и повторите попытку."));
    });
  }

  function dbRequest(mode, action) {
    return new Promise((resolve, reject) => {
      if (!state.db) {
        reject(new Error("База данных ещё не подключена."));
        return;
      }

      let result;
      let request;

      try {
        const transaction = state.db.transaction(STORE_NAME, mode);
        request = action(transaction.objectStore(STORE_NAME));

        request.onsuccess = () => {
          result = request.result;
        };
        request.onerror = () => reject(request.error || new Error("Ошибка операции с базой данных."));
        transaction.oncomplete = () => resolve(result);
        transaction.onerror = () => reject(transaction.error || new Error("Не удалось завершить сохранение."));
        transaction.onabort = () => reject(transaction.error || new Error("Сохранение было отменено."));
      } catch (error) {
        reject(error);
      }
    });
  }

  async function loadAssignments() {
    const records = await dbRequest("readonly", store => store.getAll());
    state.assignments = records
      .map(item => ({ ...item, done: Boolean(item.done), createdAt: Number(item.createdAt) || Date.now() }))
      .sort((a, b) => b.createdAt - a.createdAt);

    // Import records saved by the earlier version, if present.
    const legacy = localStorage.getItem(LEGACY_KEY);
    if (state.assignments.length === 0 && legacy) {
      try {
        const parsed = JSON.parse(legacy);
        if (Array.isArray(parsed)) {
          const migrated = parsed.map(item => ({
            ...item,
            id: String(item.id || `${Date.now()}-${Math.random().toString(16).slice(2)}`),
            fileBlob: null,
            fileName: item.fileName || "",
            done: Boolean(item.done),
            createdAt: Number(item.createdAt) || Date.now()
          }));
          for (const item of migrated) {
            await dbRequest("readwrite", store => store.put(item));
          }
          state.assignments = migrated.sort((a, b) => b.createdAt - a.createdAt);
          localStorage.removeItem(LEGACY_KEY);
        }
      } catch (error) {
        console.warn("Не удалось перенести старые задания:", error);
      }
    }
  }

  async function saveAssignment(item) {
    // First persist successfully, then mutate in-memory state.
    await dbRequest("readwrite", store => store.put(item));
    const index = state.assignments.findIndex(entry => entry.id === item.id);
    if (index >= 0) state.assignments[index] = item;
    else state.assignments.unshift(item);
    state.assignments.sort((a, b) => b.createdAt - a.createdAt);
  }

  async function deleteAssignment(id) {
    await dbRequest("readwrite", store => store.delete(id));
    state.assignments = state.assignments.filter(item => item.id !== id);
  }

  function escapeHtml(value = "") {
    return String(value).replace(/[&<>"']/g, char => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    })[char]);
  }

  function formatDate(timestamp) {
    return new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "short" }).format(new Date(timestamp));
  }

  function getVisibleAssignments() {
    const query = state.query.trim().toLocaleLowerCase("ru");
    return state.assignments.filter(item => {
      const haystack = `${item.title} ${item.category} ${item.description || ""}`.toLocaleLowerCase("ru");
      return haystack.includes(query);
    });
  }

  function render() {
    const visible = getVisibleAssignments();
    const total = state.assignments.length;

    document.querySelector("#navCount").textContent = total;


    elements.grid.innerHTML = visible.map((item, index) => {
      const fileContent = item.fileBlob
        ? `<a class="assignment-card__file" href="#" data-open-file="${item.id}" title="Открыть прикреплённый файл">${icons.file}<span>${escapeHtml(item.fileName || "Прикреплённый файл")}</span></a>`
        : `<div class="assignment-card__file">${icons.file}<span>Файл не прикреплён</span></div>`;
      return `<article class="assignment-card ${item.done ? "assignment-card--done" : ""}" style="animation-delay:${Math.min(index * 35, 245)}ms">
        <div class="assignment-card__top">
          <span class="assignment-card__category">${escapeHtml(item.category)}</span>
          <div class="assignment-card__actions">
            <button class="icon-button" type="button" data-edit="${item.id}" aria-label="Редактировать ${escapeHtml(item.title)}" title="Редактировать">${icons.edit}</button>
            <button class="icon-button" type="button" data-delete="${item.id}" aria-label="Удалить ${escapeHtml(item.title)}" title="Удалить">${icons.trash}</button>
          </div>
        </div>
        <h3 class="assignment-card__title">${escapeHtml(item.title)}</h3>
        ${item.description ? `<p class="assignment-card__description">${escapeHtml(item.description)}</p>` : ""}
        ${fileContent}
        <div class="assignment-card__footer"><span class="assignment-card__date">${formatDate(item.createdAt)}</span></div>
      </article>`;
    }).join("");

    const hasVisible = visible.length > 0;
    elements.grid.hidden = !hasVisible;
    elements.empty.classList.toggle("empty-state--visible", !hasVisible);
    if (!total) {
      elements.emptyTitle.textContent = "Пока нет заданий";
      elements.emptyDescription.textContent = "Создайте первую карточку и прикрепите файл с заданием.";
    } else {
      elements.emptyTitle.textContent = "Ничего не найдено";
      elements.emptyDescription.textContent = "Попробуйте изменить поисковый запрос.";
    }
  }

  function toast(message, isError = false) {
    const node = document.createElement("div");
    node.className = `toast${isError ? " toast--error" : ""}`;
    node.textContent = message;
    document.querySelector("#toastRegion").append(node);
    window.setTimeout(() => node.remove(), 3500);
  }

  function openModal(item = null) {
    state.selectedFile = null;
    elements.form.reset();
    elements.form.dataset.editId = item?.id || "";
    document.querySelector("#modalTitle").textContent = item ? "Редактировать задание" : "Добавить задание";
    elements.title.value = item?.title || "";
    elements.category.value = item?.category || "HTML / CSS";
    elements.description.value = item?.description || "";
    elements.uploadTitle.textContent = item?.fileName || "Прикрепить файл";
    elements.uploadHint.textContent = item?.fileName ? "Новый файл заменит текущий" : "Перетащите файл сюда или нажмите для выбора";
    elements.modal.showModal();
    window.setTimeout(() => elements.title.focus(), 50);
  }

  function closeModal() {
    elements.modal.close();
    state.selectedFile = null;
  }

  function fileSize(bytes) {
    if (bytes < 1024) return `${bytes} Б`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} КБ`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} МБ`;
  }

  async function handleSubmit(event) {
    event.preventDefault();
    const title = elements.title.value.trim();
    if (!title) {
      elements.title.focus();
      return;
    }

    const editId = elements.form.dataset.editId;
    const previous = editId ? state.assignments.find(item => item.id === editId) : null;
    const file = state.selectedFile || elements.file.files[0] || null;
    const item = {
      id: previous?.id || (window.crypto?.randomUUID ? window.crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`),
      title,
      category: elements.category.value,
      description: elements.description.value.trim(),
      fileName: file?.name || previous?.fileName || "",
      fileBlob: file || previous?.fileBlob || null,
      fileType: file?.type || previous?.fileType || "",
      fileSize: file?.size || previous?.fileSize || 0,
      done: previous?.done || false,
      createdAt: previous?.createdAt || Date.now(),
      updatedAt: Date.now()
    };

    try {
      await saveAssignment(item);
    } catch (error) {
      console.error("Ошибка сохранения задания:", error);
      const message = error?.name === "QuotaExceededError"
        ? "В браузере закончилось место для хранения. Удалите большие вложения и попробуйте снова."
        : "Не удалось сохранить задание в браузере. Проверьте настройки приватности и доступность хранилища.";
      toast(message, true);
      return;
    }

    closeModal();
    render();
    toast(previous ? "Изменения сохранены." : "Задание добавлено.");
  }

  async function handleGridClick(event) {
    const target = event.target.closest("button, a");
    if (!target) return;
    if (target.dataset.edit) {
      const item = state.assignments.find(entry => entry.id === target.dataset.edit);
      if (item) openModal(item);
    } else if (target.dataset.delete) {
      const item = state.assignments.find(entry => entry.id === target.dataset.delete);
      if (!item || !window.confirm(`Удалить задание «${item.title}»?`)) return;
      try {
        await deleteAssignment(item.id);
        render();
        toast("Задание удалено.");
      } catch (error) {
        console.error(error);
        toast("Не удалось удалить задание.", true);
      }
    } else if (target.dataset.openFile) {
      event.preventDefault();
      const item = state.assignments.find(entry => entry.id === target.dataset.openFile);
      if (!item?.fileBlob) {
        toast("Файл отсутствует. Прикрепите его заново.", true);
        return;
      }
      const url = URL.createObjectURL(item.fileBlob);
      const opened = window.open(url, "_blank", "noopener,noreferrer");
      if (!opened) {
        const link = document.createElement("a");
        link.href = url;
        link.download = item.fileName || "assignment-file";
        link.click();
      }
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
    }
  }

  function handleFileChange(file) {
    state.selectedFile = file || null;
    elements.uploadTitle.textContent = file ? file.name : "Прикрепить файл";
    elements.uploadHint.textContent = file ? `Размер файла: ${fileSize(file.size)}` : "Перетащите файл сюда или нажмите для выбора";
  }


  const quizState = { test: null, index: 0, questionIndices: [], answers: {}, results: {} };
  const quizEls = {
    assignmentView: document.querySelector('#assignments > .workspace:not(.tests-workspace)'),
    testsView: document.querySelector('#tests'),
    assignmentNav: document.querySelector('.navigation__link[href="#assignments"]'),
    testsNav: document.querySelector('[data-view="tests"]'),
    testsGrid: document.querySelector('#testsGrid'),
    catalog: document.querySelector('#testsCatalog'),
    panel: document.querySelector('#quizPanel'),
    result: document.querySelector('#quizResult'),
    counter: document.querySelector('#quizCounter'),
    topic: document.querySelector('#quizTopic'),
    progress: document.querySelector('#quizProgress'),
    question: document.querySelector('#quizQuestion'),
    hint: document.querySelector('#quizHint'),
    selectNote: document.querySelector('#quizSelectNote'),
    options: document.querySelector('#quizOptions'),
    feedback: document.querySelector('#quizFeedback'),
    previous: document.querySelector('#quizPrevious'),
    next: document.querySelector('#quizNext')
  };

  function readQuizProgress() {
    try { quizState.results = JSON.parse(localStorage.getItem('academy-quiz-results-v1') || '{}'); }
    catch { quizState.results = {}; }
  }

  function saveQuizResults() {
    localStorage.setItem('academy-quiz-results-v1', JSON.stringify(quizState.results));
  }

  function showView(view) {
    const tests = view === 'tests';
    quizEls.assignmentView.hidden = tests;
    quizEls.testsView.hidden = !tests;
    quizEls.assignmentNav.setAttribute('aria-current', String(!tests));
    quizEls.testsNav.setAttribute('aria-current', String(tests));
    document.querySelector('.breadcrumb strong').textContent = tests ? 'Тесты HTML / CSS' : 'Домашние задания';
    document.querySelector('.page-heading h1').innerHTML = tests ? 'Тесты <span>HTML / CSS</span>' : 'Домашние <span>задания</span>';
    elements.sidebar.classList.remove('sidebar--open');
    elements.menuToggle.setAttribute('aria-expanded', 'false');
  }

  function renderTestCatalog() {
    const tests = Array.isArray(window.ACADEMY_TESTS) ? window.ACADEMY_TESTS : [];
    document.querySelector('#testsNavCount').textContent = tests.length;
    quizEls.testsGrid.innerHTML = tests.map(test => {
      const result = quizState.results[test.id];
      const score = result ? `<span class="test-card__score">${result.correct === result.total ? 'Пройден без ошибок' : `Результат · ${result.correct}/${result.total}`}</span>` : 'Ещё не пройден';
      return `<button class="test-card" type="button" data-start-test="${test.id}">
        <span class="test-card__meta"><span class="test-card__number">ТЕСТ ${String(test.id).padStart(2, '0')}</span><span>${test.questions.length} вопросов</span></span>
        <h3>${escapeHtml(test.topic)}</h3><p>${escapeHtml(test.title)} · HTML / CSS</p>
        <span class="test-card__bottom"><span>${score}</span><span class="test-card__arrow" aria-hidden="true">→</span></span>
      </button>`;
    }).join('');
  }

  function startTest(id) {
    const test = (window.ACADEMY_TESTS || []).find(item => item.id === Number(id));
    if (!test || !test.questions.length) { toast('В этом тесте пока нет вопросов.', true); return; }
    quizState.test = test;
    quizState.index = 0;
    quizState.questionIndices = test.questions.map((_, index) => index);
    quizState.answers = {};
    quizEls.catalog.hidden = true;
    quizEls.panel.hidden = false;
    quizEls.result.hidden = true;
    renderQuizQuestion();
  }

  function renderQuizQuestion() {
    const test = quizState.test;
    const index = quizState.index;
    const questionIndex = quizState.questionIndices[index];
    const question = test.questions[questionIndex];
    const selected = quizState.answers[questionIndex] || [];
    quizEls.counter.textContent = `Вопрос ${index + 1} из ${quizState.questionIndices.length}`;
    quizEls.topic.textContent = test.topic;
    quizEls.progress.innerHTML = quizState.questionIndices.map((_, i) => `<span class="quiz-progress__step ${i < index ? 'quiz-progress__step--done' : ''} ${i === index ? 'quiz-progress__step--active' : ''}"></span>`).join('');
    quizEls.question.textContent = question.question;
    quizEls.hint.textContent = question.hint || 'Выбери правильный ответ.';
    quizEls.selectNote.hidden = !question.multiple;
    quizEls.options.innerHTML = question.options.map((option, i) => {
      const isSelected = selected.includes(option.label);
      return `<button type="button" class="quiz-option ${isSelected ? 'quiz-option--selected' : ''}" data-answer="${escapeHtml(option.label)}" aria-pressed="${isSelected}">
        <span class="quiz-option__letter">${escapeHtml(option.label || String.fromCharCode(65 + i))}</span><span class="quiz-option__text">${escapeHtml(option.text)}</span>
      </button>`;
    }).join('');
    quizEls.previous.disabled = index === 0;
    quizEls.next.disabled = selected.length === 0;
    quizEls.next.innerHTML = index === quizState.questionIndices.length - 1 ? 'Завершить тест <span>→</span>' : 'Далее <span>→</span>';
    quizEls.feedback.hidden = true;
    quizEls.feedback.textContent = '';
  }

  function selectAnswer(label) {
    const questionIndex = quizState.questionIndices[quizState.index];
    const question = quizState.test.questions[questionIndex];
    const current = quizState.answers[questionIndex] || [];
    quizState.answers[questionIndex] = question.multiple
      ? (current.includes(label) ? current.filter(item => item !== label) : [...current, label])
      : [label];
    renderQuizQuestion();
  }

  function normalizeAnswer(answer) {
    return [...(answer || [])].sort().join('|');
  }

  function isAnswerCorrect(question, answer) {
    return normalizeAnswer(answer) === normalizeAnswer(question.correct || []);
  }

  function finishTest() {
    const test = quizState.test;
    const incorrect = [];
    const answered = test.questions.filter((_, index) => (quizState.answers[index] || []).length > 0).length;
    test.questions.forEach((question, index) => {
      if (!isAnswerCorrect(question, quizState.answers[index])) incorrect.push(index);
    });
    const correct = test.questions.length - incorrect.length;
    quizState.results[test.id] = { answered, total: test.questions.length, correct, completedAt: Date.now() };
    saveQuizResults();
    quizEls.panel.hidden = true;
    quizEls.result.hidden = false;

    const allCorrect = incorrect.length === 0;
    const review = test.questions.map((question, index) => {
      const answer = quizState.answers[index] || [];
      const ok = isAnswerCorrect(question, answer);
      const chosen = answer.length
        ? answer.map(label => {
            const option = question.options.find(item => item.label === label);
            return `${escapeHtml(label)} ${escapeHtml(option?.text || '')}`;
          }).join(', ')
        : 'Ответ не выбран';
      return `<article class="quiz-review-card ${ok ? 'quiz-review-card--correct' : 'quiz-review-card--wrong'}">
        <span class="quiz-review-card__icon" aria-hidden="true">${ok ? '✓' : '×'}</span>
        <div class="quiz-review-card__body">
          <h3>${index + 1}. ${escapeHtml(question.question)}</h3>
          <p>${chosen}</p>
          ${ok ? '' : `<p class="quiz-review-card__hint">Подсказка: ${escapeHtml(question.hint || 'Попробуй ещё раз и выбери верный ответ.')}</p><p class="quiz-review-card__correct">Правильный ответ: ${question.correct.map(label => { const option = question.options.find(item => item.label === label); return `${escapeHtml(label)} ${escapeHtml(option?.text || '')}`; }).join(', ')}</p>`}
        </div>
      </article>`;
    }).join('');

    quizEls.result.classList.toggle('quiz-result--success', allCorrect);
    quizEls.result.classList.toggle('quiz-result--errors', !allCorrect);
    quizEls.result.innerHTML = `
      <div class="quiz-result__summary">
        <div class="quiz-result__badge ${allCorrect ? 'quiz-result__badge--success' : 'quiz-result__badge--error'}" aria-hidden="true">${allCorrect ? '✓' : '◎'}</div>
        <div class="quiz-result__intro">
          <h2>${allCorrect ? 'Без ошибок, тест пройден' : `Верно ${correct} из ${test.questions.length}`}</h2>
          <p>${allCorrect ? 'Урок засчитан. Ответы ниже, если захочешь повторить.' : `${incorrect.length} ${incorrect.length === 1 ? 'вопрос с ошибкой' : 'вопросов с ошибкой'}. Исправь ответы и проверь снова: верные останутся на месте.`}</p>
          ${allCorrect ? '' : '<span class="quiz-result__xp">+80 XP ждут, когда без ошибок</span>'}
        </div>
      </div>
      <div class="quiz-result__actions">
        ${allCorrect ? '' : `<button class="button button--primary" type="button" data-fix-errors="${test.id}">Исправить ошибки <span>→</span></button>`}
        <button class="button ${allCorrect ? 'button--primary' : 'button--secondary'}" type="button" data-retry-test="${test.id}">${allCorrect ? 'Пройти ещё раз' : 'Начать заново'}</button>
        <button class="button button--ghost" type="button" id="resultToCatalog">К списку тестов</button>
      </div>
      <h3 class="quiz-result__review-title">Твои ответы</h3>
      <div class="quiz-result__review">${review}</div>`;
    renderTestCatalog();
  }

  function fixTestErrors() {
    const test = quizState.test;
    const incorrect = test.questions.map((question, index) => index).filter(index => !isAnswerCorrect(test.questions[index], quizState.answers[index]));
    if (!incorrect.length) return;
    quizState.questionIndices = incorrect;
    quizState.index = 0;
    quizEls.result.hidden = true;
    quizEls.panel.hidden = false;
    renderQuizQuestion();
  }

  function backToCatalog() {
    quizEls.panel.hidden = true;
    quizEls.result.hidden = true;
    quizEls.catalog.hidden = false;
    quizState.test = null;
    renderTestCatalog();
  }

  function initQuizEvents() {
    readQuizProgress();
    renderTestCatalog();
    quizEls.assignmentNav.addEventListener('click', event => { event.preventDefault(); showView('assignments'); });
    quizEls.testsNav.addEventListener('click', event => { event.preventDefault(); showView('tests'); });
    quizEls.testsGrid.addEventListener('click', event => {
      const card = event.target.closest('[data-start-test]');
      if (card) startTest(card.dataset.startTest);
    });
    quizEls.options.addEventListener('click', event => {
      const option = event.target.closest('[data-answer]');
      if (option) selectAnswer(option.dataset.answer);
    });
    quizEls.previous.addEventListener('click', () => { if (quizState.index > 0) { quizState.index--; renderQuizQuestion(); } });
    quizEls.next.addEventListener('click', () => {
      const questionIndex = quizState.questionIndices[quizState.index];
      if (!(quizState.answers[questionIndex] || []).length) return;
      if (quizState.index === quizState.questionIndices.length - 1) finishTest();
      else { quizState.index++; renderQuizQuestion(); }
    });
    document.querySelector('#backToTests').addEventListener('click', backToCatalog);
    quizEls.result.addEventListener('click', event => {
      const retry = event.target.closest('[data-retry-test]');
      const fixErrors = event.target.closest('[data-fix-errors]');
      if (fixErrors) { fixTestErrors(); return; }
      if (retry) startTest(retry.dataset.retryTest);
      if (event.target.closest('#resultToCatalog')) backToCatalog();
    });
  }

  function initEvents() {
    document.querySelector("#openAddModal").addEventListener("click", () => openModal());
    document.querySelector("#emptyAddButton").addEventListener("click", () => openModal());
    document.querySelector("#closeModal").addEventListener("click", closeModal);
    document.querySelector("#cancelModal").addEventListener("click", closeModal);
    elements.form.addEventListener("submit", handleSubmit);
    elements.grid.addEventListener("click", handleGridClick);
    elements.search.addEventListener("input", () => { state.query = elements.search.value; render(); });
    elements.file.addEventListener("change", () => handleFileChange(elements.file.files[0]));
    ["dragenter", "dragover"].forEach(type => elements.uploadArea.addEventListener(type, event => {
      event.preventDefault();
      elements.uploadArea.classList.add("upload-area--drag");
    }));
    ["dragleave", "drop"].forEach(type => elements.uploadArea.addEventListener(type, event => {
      event.preventDefault();
      elements.uploadArea.classList.remove("upload-area--drag");
    }));
    elements.uploadArea.addEventListener("drop", event => {
      const file = event.dataTransfer?.files?.[0];
      if (!file) return;
      const transfer = new DataTransfer();
      transfer.items.add(file);
      elements.file.files = transfer.files;
      handleFileChange(file);
    });
    elements.modal.addEventListener("click", event => {
      if (event.target === elements.modal) closeModal();
    });
    elements.menuToggle.addEventListener("click", () => {
      const open = elements.sidebar.classList.toggle("sidebar--open");
      elements.menuToggle.setAttribute("aria-expanded", String(open));
      elements.menuToggle.setAttribute("aria-label", open ? "Закрыть меню" : "Открыть меню");
    });
    document.querySelector("#editNameButton").addEventListener("click", () => {
      const current = document.querySelector("#profileName").textContent;
      const name = window.prompt("Как вас называть?", current);
      if (name?.trim()) {
        document.querySelector("#profileName").textContent = name.trim().slice(0, 40);
        document.querySelector(".profile__avatar").textContent = name.trim().charAt(0).toLocaleUpperCase("ru");
        localStorage.setItem("academy-homework-profile-name", name.trim().slice(0, 40));
      }
    });
    const savedName = localStorage.getItem("academy-homework-profile-name");
    if (savedName) {
      document.querySelector("#profileName").textContent = savedName;
      document.querySelector(".profile__avatar").textContent = savedName.charAt(0).toLocaleUpperCase("ru");
    }
    document.addEventListener("keydown", event => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        elements.search.focus();
      }
      if (event.key === "Escape") elements.sidebar.classList.remove("sidebar--open");
    });
  }

  async function init() {
    initEvents();
    initQuizEvents();
    try {
      state.db = await openDatabase();
      await loadAssignments();
      render();
    } catch (error) {
      console.error("Ошибка инициализации хранилища:", error);
      toast("Не удалось открыть локальную базу данных. Откройте сайт через HTTPS на GitHub Pages или через локальный сервер.", true);
      elements.grid.hidden = true;
      elements.empty.classList.add("empty-state--visible");
      elements.emptyTitle.textContent = "Хранилище недоступно";
      elements.emptyDescription.textContent = "Запустите сайт через HTTPS или локальный сервер. В режиме file:// некоторые браузеры блокируют сохранение.";
    } finally {
      window.setTimeout(() => elements.loader.classList.add("page-loader--hidden"), 450);
    }
  }

  document.addEventListener("DOMContentLoaded", init);
})();
