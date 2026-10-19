// ==UserScript==
// @name         睡觉提醒 22:30
// @namespace    local.chuan.health
// @version      1.1.0
// @description  每晚到点弹出遮罩，可选下次提醒间隔，直到选择今晚结束。
// @match        http://*/*
// @match        https://*/*
// @noframes
// @run-at       document-idle
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_registerMenuCommand
// @grant        GM_addValueChangeListener
// ==/UserScript==

(() => {
  'use strict';

  const KEYS = {
    bedtime: 'sleep_reminder_bedtime',
    repeat: 'sleep_reminder_repeat_minutes',
    done: 'sleep_reminder_done_session',
    next: 'sleep_reminder_next_at',
  };
  const DEFAULT_BEDTIME = '22:30';
  const DEFAULT_REPEAT_MINUTES = 3;
  const MAX_REPEAT_MINUTES = 720;
  const MORNING_END_MINUTES = 6 * 60;
  let mode = 'closed';
  let nextCheckTimer;

  const host = document.createElement('div');
  host.id = 'chuan-sleep-reminder';
  host.hidden = true;
  const shadow = host.attachShadow({ mode: 'open' });
  shadow.innerHTML = `
    <style>
      :host([hidden]) { display: none !important; }
      * { box-sizing: border-box; }
      #screen {
        position: fixed; inset: 0; z-index: 2147483647;
        display: grid; place-items: center; padding: 24px;
        background: rgba(9, 16, 27, .91);
        color: #f7f5f0; font: 16px/1.55 -apple-system, BlinkMacSystemFont,
          "PingFang SC", "Microsoft YaHei", sans-serif;
      }
      .card {
        width: min(100%, 500px); padding: 38px 34px 30px;
        border: 1px solid rgba(255,255,255,.17); border-radius: 24px;
        background: #172333; text-align: center;
        box-shadow: 0 24px 80px rgba(0,0,0,.42);
      }
      .moon { font-size: 45px; line-height: 1; margin-bottom: 18px; }
      h1 { margin: 0 0 12px; font-size: clamp(29px, 5vw, 38px); line-height: 1.2; }
      p { margin: 0 0 27px; color: #c8d1dc; }
      .actions { display: flex; gap: 12px; justify-content: center; flex-wrap: wrap; }
      button {
        min-height: 45px; padding: 10px 18px; border: 0; border-radius: 12px;
        font: inherit; font-weight: 650; cursor: pointer;
      }
      button:focus-visible, input:focus-visible, select:focus-visible { outline: 3px solid #9bc8ff; outline-offset: 3px; }
      .primary { background: #8dc7a4; color: #10221a; }
      .secondary { background: #34455b; color: #fff; }
      .link { margin-top: 22px; padding: 4px 10px; min-height: 30px; background: none; color: #b9c8da; font-size: 14px; }
      .setting { display: block; margin: 16px auto; text-align: left; max-width: 260px; color: #e7edf4; }
      .setting span { display: block; margin-bottom: 7px; }
      input, select {
        width: 100%; min-height: 42px; padding: 8px 10px; border-radius: 9px;
        border: 1px solid #8292a5; background: #f7f9fc; color: #152130;
        font: inherit;
      }
      .hint { margin: 17px 0 0; font-size: 13px; color: #aebaca; }
      .error { min-height: 24px; margin: 10px 0; color: #ffc3bd; }
      [hidden] { display: none !important; }
    </style>
    <div id="screen">
      <section id="reminder" class="card" role="dialog" aria-modal="true" aria-labelledby="reminder-title">
        <div class="moon" aria-hidden="true">🌙</div>
        <h1 id="reminder-title">该准备睡觉了</h1>
        <p id="reminder-copy"></p>
        <label id="snooze-setting" class="setting"><span>下次什么时候再提醒？</span>
          <select id="snooze-choice">
            <option value="3">3 分钟后</option>
            <option value="30">30 分钟后</option>
            <option value="60">1 小时后</option>
            <option value="custom">自定义分钟数</option>
          </select>
        </label>
        <label id="custom-snooze-setting" class="setting" hidden><span>自定义间隔（分钟）</span>
          <input id="custom-snooze" type="number" min="1" max="720" step="1" value="3">
        </label>
        <div id="snooze-error" class="error" role="alert"></div>
        <div class="actions">
          <button id="done" class="primary" type="button">今晚结束</button>
          <button id="later" class="secondary" type="button">稍后再提醒</button>
        </div>
        <button id="open-settings" class="link" type="button">设置提醒</button>
      </section>
      <section id="settings" class="card" role="dialog" aria-modal="true" aria-labelledby="settings-title" hidden>
        <h1 id="settings-title">睡觉提醒设置</h1>
        <label class="setting"><span>每天开始提醒</span><input id="bedtime" type="time" min="18:00" max="23:59"></label>
        <label class="setting"><span>默认再次提醒间隔（分钟）</span><input id="repeat" type="number" min="1" max="720" step="1"></label>
        <div id="error" class="error" role="alert"></div>
        <div class="actions">
          <button id="save" class="primary" type="button">保存</button>
          <button id="cancel" class="secondary" type="button">取消</button>
        </div>
        <p class="hint">提醒持续到次日 06:00，或直到你选择“今晚结束”。</p>
      </section>
    </div>`;
  document.documentElement.appendChild(host);

  const $ = (selector) => shadow.querySelector(selector);
  const bedtimeInput = $('#bedtime');
  const repeatInput = $('#repeat');
  const snoozeChoice = $('#snooze-choice');
  const customSnoozeInput = $('#custom-snooze');

  function readSettings() {
    const bedtime = GM_getValue(KEYS.bedtime, DEFAULT_BEDTIME);
    const repeat = Number(GM_getValue(KEYS.repeat, DEFAULT_REPEAT_MINUTES));
    return {
      bedtime: /^([01]\d|2[0-3]):[0-5]\d$/.test(bedtime) && bedtime >= '18:00'
        ? bedtime : DEFAULT_BEDTIME,
      repeat: Number.isInteger(repeat) && repeat >= 1 && repeat <= MAX_REPEAT_MINUTES
        ? repeat : DEFAULT_REPEAT_MINUTES,
    };
  }

  function dateKey(date) {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  }

  function sessionKey(now, bedtime) {
    const minutes = now.getHours() * 60 + now.getMinutes();
    const [hour, minute] = bedtime.split(':').map(Number);
    if (minutes >= hour * 60 + minute) return dateKey(now);
    if (minutes < MORNING_END_MINUTES) {
      const yesterday = new Date(now);
      yesterday.setDate(yesterday.getDate() - 1);
      return dateKey(yesterday);
    }
    return null;
  }

  function hide() {
    mode = 'closed';
    host.hidden = true;
  }

  function setSnoozeChoice(minutes) {
    const preset = [3, 30, 60].includes(minutes);
    snoozeChoice.value = preset ? String(minutes) : 'custom';
    customSnoozeInput.value = String(minutes);
    $('#custom-snooze-setting').hidden = preset;
    $('#snooze-error').textContent = '';
  }

  function scheduleNextCheck(at) {
    clearTimeout(nextCheckTimer);
    if (Number.isFinite(at)) {
      nextCheckTimer = setTimeout(sync, Math.min(Math.max(at - Date.now(), 0), 60_000));
    }
  }

  function showReminder(preview = false) {
    mode = preview ? 'preview' : 'reminder';
    const settings = readSettings();
    $('#reminder').hidden = false;
    $('#settings').hidden = true;
    $('#reminder-title').textContent = preview ? '提醒预览' : '该准备睡觉了';
    $('#reminder-copy').textContent = preview
      ? `正式提醒将从每天 ${settings.bedtime} 开始。`
      : `现在已经过了 ${settings.bedtime}。收起网页，给自己留一点睡前放松时间。`;
    $('#done').hidden = preview;
    setSnoozeChoice(settings.repeat);
    $('#snooze-setting').hidden = preview;
    if (preview) $('#custom-snooze-setting').hidden = true;
    $('#later').textContent = preview ? '关闭预览' : '否，按所选时间再提醒';
    host.hidden = false;
    $('#later').focus();
  }

  function showSettings() {
    mode = 'settings';
    const settings = readSettings();
    bedtimeInput.value = settings.bedtime;
    repeatInput.value = String(settings.repeat);
    $('#error').textContent = '';
    $('#reminder').hidden = true;
    $('#settings').hidden = false;
    host.hidden = false;
    bedtimeInput.focus();
  }

  function sync() {
    scheduleNextCheck();
    if (mode === 'settings' || mode === 'preview') return;
    const now = new Date();
    const settings = readSettings();
    const session = sessionKey(now, settings.bedtime);
    if (!session || GM_getValue(KEYS.done, '') === session) {
      if (mode === 'reminder') hide();
      return;
    }
    const next = GM_getValue(KEYS.next, null);
    if (next && next.session === session && Number(next.at) > now.getTime()) {
      if (mode === 'reminder') hide();
      scheduleNextCheck(Number(next.at));
      return;
    }
    if (document.visibilityState === 'visible' && mode !== 'reminder') showReminder();
  }

  snoozeChoice.addEventListener('change', () => {
    $('#custom-snooze-setting').hidden = snoozeChoice.value !== 'custom';
    $('#snooze-error').textContent = '';
    if (snoozeChoice.value === 'custom') customSnoozeInput.focus();
  });

  $('#later').addEventListener('click', () => {
    if (mode === 'preview') return hide();
    const minutes = Number(snoozeChoice.value === 'custom' ? customSnoozeInput.value : snoozeChoice.value);
    if (!Number.isInteger(minutes) || minutes < 1 || minutes > MAX_REPEAT_MINUTES) {
      $('#snooze-error').textContent = '请输入 1–720 分钟。';
      return;
    }
    const session = sessionKey(new Date(), readSettings().bedtime);
    if (session) {
      const at = Date.now() + minutes * 60_000;
      GM_setValue(KEYS.next, {
        session,
        at,
      });
      scheduleNextCheck(at);
    }
    hide();
  });

  $('#done').addEventListener('click', () => {
    const session = sessionKey(new Date(), readSettings().bedtime);
    if (session) GM_setValue(KEYS.done, session);
    hide();
  });

  $('#open-settings').addEventListener('click', showSettings);
  $('#cancel').addEventListener('click', () => { hide(); sync(); });
  $('#save').addEventListener('click', () => {
    const bedtime = bedtimeInput.value;
    const repeat = Number(repeatInput.value);
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(bedtime) || bedtime < '18:00' ||
        !Number.isInteger(repeat) || repeat < 1 || repeat > MAX_REPEAT_MINUTES) {
      $('#error').textContent = '时间请设在 18:00–23:59，默认间隔为 1–720 分钟。';
      return;
    }
    GM_setValue(KEYS.bedtime, bedtime);
    GM_setValue(KEYS.repeat, repeat);
    GM_setValue(KEYS.next, null);
    hide();
    sync();
  });

  GM_registerMenuCommand('设置睡觉提醒', showSettings);
  GM_registerMenuCommand('预览睡觉提醒', () => showReminder(true));
  GM_addValueChangeListener(KEYS.done, sync);
  GM_addValueChangeListener(KEYS.next, sync);
  GM_addValueChangeListener(KEYS.bedtime, sync);
  GM_addValueChangeListener(KEYS.repeat, sync);
  document.addEventListener('visibilitychange', sync);
  window.addEventListener('focus', sync);
  window.addEventListener('pageshow', sync);
  document.addEventListener('pointerdown', sync, { passive: true });
  document.addEventListener('keydown', sync);
  setInterval(sync, 10_000);
  sync();
})();
