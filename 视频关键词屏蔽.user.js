// ==UserScript==
// @name         视频关键词留白（YouTube / 哔哩哔哩）
// @namespace    local.chuan.focus
// @version      1.2.0
// @description  按视频标题关键词留白卡片；右下角随时管理关键词。
// @match        https://www.youtube.com/*
// @match        https://m.youtube.com/*
// @match        https://youtube.com/*
// @match        https://www.bilibili.com/*
// @match        https://m.bilibili.com/*
// @match        https://search.bilibili.com/*
// @noframes
// @run-at       document-idle
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_addValueChangeListener
// ==/UserScript==

(() => {
  'use strict';

  const STORE_KEY = 'video_keyword_blanker_v1';
  const DEFAULT_KEYWORDS = ['英雄联盟', 'Faker'];
  const BLANK_CLASS = 'chuan-video-keyword-blank';
  const IS_YOUTUBE = location.hostname.endsWith('youtube.com');
  const CARD_SELECTOR = IS_YOUTUBE
    ? [
        'ytd-rich-item-renderer',
        'ytd-video-renderer',
        'ytd-compact-video-renderer',
        'ytd-grid-video-renderer',
        'ytd-playlist-video-renderer',
        'ytd-reel-item-renderer',
        'ytd-rich-grid-slim-media',
        'yt-lockup-view-model',
        'ytm-media-item',
      ].join(',')
    : [
        '.bili-video-card',
        '.feed-card',
        '.video-card',
        '.video-page-card-small',
        '.video-page-card',
        '.small-item',
        '.bili-dyn-card-video',
        'a.v-card',
        '.v-card-single',
      ].join(',');
  const TITLE_SELECTOR = IS_YOUTUBE
    ? [
        '#video-title',
        'a#video-title-link',
        '.yt-lockup-metadata-view-model__title',
        '.shortsLockupViewModelHostOutsideMetadataTitle',
        '.media-item-headline',
        'a[href*="/watch?v="][aria-label]',
        'a[href^="/shorts/"][aria-label]',
      ].join(',')
    : [
        '.bili-video-card__info--tit',
        '.bili-video-card__info--title',
        '.video-name',
        '.video-page-card-small .title',
        '.video-page-card .title',
        'a[title][href*="/video/"]',
        'h3[title]',
        'h3',
        '.v-card__title',
        '.v-card-single .title',
      ].join(',');

  const normalize = (value) => String(value ?? '')
    .normalize('NFKC')
    .toLocaleLowerCase()
    .replace(/[\s\u200b-\u200d\ufeff]+/g, '');

  function cleanKeywords(values) {
    const seen = new Set();
    return values
      .map((value) => String(value).trim())
      .filter((value) => {
        const key = normalize(value);
        if (!key || seen.has(key)) return false;
        seen.add(key);
        return true;
      });
  }

  function readState() {
    const stored = GM_getValue(STORE_KEY, null);
    return {
      enabled: stored && typeof stored.enabled === 'boolean' ? stored.enabled : true,
      keywords: cleanKeywords(Array.isArray(stored?.keywords) ? stored.keywords : DEFAULT_KEYWORDS),
    };
  }

  let state = readState();
  let scanTimer = 0;
  let panelOpen = false;

  const style = document.createElement('style');
  style.textContent = `
    .${BLANK_CLASS}, .${BLANK_CLASS} * {
      visibility: hidden !important;
      pointer-events: none !important;
    }
  `;
  document.documentElement.appendChild(style);

  const host = document.createElement('div');
  host.id = 'chuan-video-keyword-control';
  const shadow = host.attachShadow({ mode: 'open' });
  const uiStyle = document.createElement('style');
  uiStyle.textContent = `
      :host { all: initial; position: fixed; right: 18px; bottom: 18px; z-index: 2147483647; }
      * { box-sizing: border-box; }
      button, textarea { font: 14px/1.4 -apple-system, BlinkMacSystemFont, "PingFang SC", sans-serif; }
      #toggle {
        min-width: 90px; min-height: 44px; padding: 9px 14px;
        border: 0; border-radius: 999px; background: #111827; color: white;
        box-shadow: 0 5px 18px #0005; cursor: pointer;
      }
      #panel {
        width: min(330px, calc(100vw - 36px)); max-height: min(65vh, 520px);
        overflow-y: auto; margin-bottom: 10px; padding: 16px;
        border: 1px solid #d1d5db; border-radius: 16px;
        background: #fff; color: #111827; box-shadow: 0 12px 35px #0004;
        font: 14px/1.5 -apple-system, BlinkMacSystemFont, "PingFang SC", sans-serif;
      }
      #panel[hidden] { display: none; }
      h2 { margin: 0 0 4px; font-size: 17px; }
      p { margin: 0 0 12px; color: #4b5563; }
      .row { display: flex; gap: 8px; margin: 10px 0; }
      textarea { width: 100%; min-height: 62px; resize: vertical; padding: 8px; border: 1px solid #9ca3af; border-radius: 8px; }
      .action { padding: 7px 10px; border: 0; border-radius: 8px; background: #1d4ed8; color: #fff; cursor: pointer; }
      #list { display: flex; flex-wrap: wrap; gap: 7px; margin: 12px 0; }
      .chip { display: inline-flex; align-items: center; gap: 5px; padding: 5px 7px 5px 10px; border-radius: 999px; background: #e5e7eb; }
      .chip button { border: 0; background: transparent; color: #374151; cursor: pointer; font-size: 18px; line-height: 1; }
      label { display: flex; align-items: center; gap: 7px; cursor: pointer; }
      button:focus-visible, textarea:focus-visible, input:focus-visible { outline: 2px solid #2563eb; outline-offset: 2px; }
      #message { min-height: 20px; color: #b91c1c; }
      @media (max-width: 600px) {
        :host { right: 12px; bottom: calc(68px + env(safe-area-inset-bottom)); }
        #toggle { min-width: 82px; min-height: 42px; padding: 8px 11px; }
        #panel { width: min(330px, calc(100vw - 24px)); max-height: 60vh; }
      }
  `;
  shadow.appendChild(uiStyle);

  // YouTube enforces Trusted Types, so create controls with DOM APIs instead of innerHTML.
  const panel = document.createElement('div');
  panel.id = 'panel';
  panel.hidden = true;
  const heading = document.createElement('h2');
  heading.textContent = '视频关键词留白';
  const description = document.createElement('p');
  description.textContent = '只按视频标题匹配；命中后卡片留空，不移除位置。';
  const enabledLabel = document.createElement('label');
  const enabledInput = document.createElement('input');
  enabledInput.id = 'enabled';
  enabledInput.type = 'checkbox';
  enabledLabel.append(enabledInput, document.createTextNode('启用屏蔽'));
  const row = document.createElement('div');
  row.className = 'row';
  const newKeywords = document.createElement('textarea');
  newKeywords.id = 'new-keywords';
  newKeywords.placeholder = '输入关键词；多个可用逗号或换行分隔';
  row.appendChild(newKeywords);
  const addButton = document.createElement('button');
  addButton.id = 'add';
  addButton.className = 'action';
  addButton.type = 'button';
  addButton.textContent = '添加关键词';
  const message = document.createElement('div');
  message.id = 'message';
  message.setAttribute('role', 'status');
  const list = document.createElement('div');
  list.id = 'list';
  panel.append(heading, description, enabledLabel, row, addButton, message, list);
  const toggle = document.createElement('button');
  toggle.id = 'toggle';
  toggle.type = 'button';
  toggle.setAttribute('aria-expanded', 'false');
  toggle.textContent = '屏蔽词';
  shadow.append(panel, toggle);
  document.documentElement.appendChild(host);

  const $ = (selector) => shadow.querySelector(selector);

  function videoTitle(card) {
    const node = card.querySelector(TITLE_SELECTOR);
    if (!node) return '';
    return node.getAttribute('title') || node.textContent || node.getAttribute('aria-label') || '';
  }

  function scan() {
    scanTimer = 0;
    const words = state.enabled ? state.keywords.map(normalize) : [];
    for (const card of document.querySelectorAll(CARD_SELECTOR)) {
      const title = normalize(videoTitle(card));
      card.classList.toggle(BLANK_CLASS, Boolean(title) && words.some((word) => title.includes(word)));
    }
  }

  function queueScan() {
    if (!scanTimer) scanTimer = window.setTimeout(scan, 150);
  }

  function saveState() {
    GM_setValue(STORE_KEY, state);
    render();
    queueScan();
  }

  function render() {
    $('#enabled').checked = state.enabled;
    $('#toggle').textContent = `屏蔽词 ${state.keywords.length}${state.enabled ? '' : '（暂停）'}`;
    $('#toggle').setAttribute('aria-expanded', String(panelOpen));
    $('#panel').hidden = !panelOpen;
    const list = $('#list');
    list.replaceChildren();
    for (const keyword of state.keywords) {
      const chip = document.createElement('span');
      chip.className = 'chip';
      chip.appendChild(document.createTextNode(keyword));
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.textContent = '×';
      remove.setAttribute('aria-label', `删除 ${keyword}`);
      remove.addEventListener('click', () => {
        state.keywords = state.keywords.filter((item) => normalize(item) !== normalize(keyword));
        saveState();
      });
      chip.appendChild(remove);
      list.appendChild(chip);
    }
  }

  $('#toggle').addEventListener('click', () => {
    panelOpen = !panelOpen;
    render();
    if (panelOpen) $('#new-keywords').focus();
  });
  $('#enabled').addEventListener('change', (event) => {
    state.enabled = event.target.checked;
    saveState();
  });
  $('#add').addEventListener('click', () => {
    const input = $('#new-keywords');
    const additions = cleanKeywords(input.value.split(/[,，、\n]+/));
    if (!additions.length) {
      $('#message').textContent = '请先输入关键词。';
      return;
    }
    state.keywords = cleanKeywords([...state.keywords, ...additions]);
    input.value = '';
    $('#message').textContent = '';
    saveState();
  });
  $('#new-keywords').addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      $('#add').click();
    }
  });
  shadow.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && panelOpen) {
      panelOpen = false;
      render();
      $('#toggle').focus();
    }
  });

  GM_addValueChangeListener(STORE_KEY, (_key, _oldValue, _newValue, remote) => {
    if (!remote) return;
    state = readState();
    render();
    queueScan();
  });
  new MutationObserver(queueScan).observe(document.documentElement, {
    subtree: true,
    childList: true,
    characterData: true,
    attributes: true,
    attributeFilter: ['title', 'aria-label'],
  });
  window.addEventListener('pageshow', queueScan);
  render();
  scan();
})();
