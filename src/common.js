const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const waitFor = async (fn, ms) => { const t = Date.now(); while (Date.now() - t < ms) { const v = fn(); if (v) return v; await wait(250); } return null; };
const navigate = (path) => { history.pushState({}, '', path); window.dispatchEvent(new PopStateEvent('popstate', { state: {} })); };

const makeStore = (key) => {
  const store = (() => { try { return JSON.parse(localStorage.getItem(key) || '{}'); } catch (e) { return {}; } })();
  const save = () => { try { localStorage.setItem(key, JSON.stringify(store)); } catch (e) {} };
  return { store, save };
};

// Progress box in the corner. o = { title, accent, bg, muted, font, flag }.
// ui.stop is set by the stop button; ui.finish(html) turns the button into "Close".
const makeUI = (o) => {
  const ui = { stop: false, done: false };
  const box = document.createElement('div');
  box.style.cssText = 'position:fixed;right:16px;bottom:96px;z-index:2147483647;width:300px;padding:14px 16px;background:' + o.bg + ';color:#fff;border:1px solid ' + o.accent + ';border-radius:10px;font:14px/1.4 ' + o.font + ';box-shadow:0 8px 30px rgba(0,0,0,.6)';
  box.innerHTML = '<b>' + o.title + '</b><div id="br-st" style="margin:8px 0;color:' + o.muted + '"></div><div style="height:6px;background:#333;border-radius:3px;overflow:hidden"><div id="br-bar" style="height:100%;width:0;background:' + o.accent + '"></div></div><button id="br-stop" style="margin-top:10px;padding:6px 14px;border:0;border-radius:16px;background:#fff;color:#000;font-weight:700;cursor:pointer">Зупинити</button>';
  document.body.appendChild(box);
  ui.box = box;
  ui.st = box.querySelector('#br-st');
  ui.bar = box.querySelector('#br-bar');
  ui.btn = box.querySelector('#br-stop');
  // Question with buttons instead of the progress bar. options = [{ value, label }]; resolves to value, or null on cancel.
  ui.choose = (html, options) => new Promise((resolve) => {
    ui.st.innerHTML = html;
    ui.btn.style.display = 'none';
    const row = document.createElement('div');
    const done = (v) => { row.remove(); ui.btn.style.display = ''; ui.st.textContent = ''; resolve(v); };
    options.forEach((opt, i) => {
      const b = document.createElement('button');
      b.textContent = opt.label;
      b.style.cssText = 'display:block;width:100%;margin-top:8px;padding:8px 12px;border:0;border-radius:16px;font-weight:700;cursor:pointer;text-align:left;background:' + (i ? '#fff' : o.accent) + ';color:' + (i ? '#000' : '#fff');
      b.onclick = () => done(opt.value);
      row.appendChild(b);
    });
    const c = document.createElement('button');
    c.textContent = 'Скасувати';
    c.style.cssText = 'display:block;margin-top:8px;padding:4px 0;border:0;background:none;color:' + o.muted + ';cursor:pointer;text-decoration:underline';
    c.onclick = () => { box.remove(); window[o.flag] = false; resolve(null); };
    row.appendChild(c);
    ui.st.after(row);
  });
  ui.finish = (html) => { ui.st.innerHTML = html; ui.btn.textContent = 'Закрити'; ui.done = true; };
  ui.btn.onclick = () => {
    if (ui.done || ui.stop) { box.remove(); window[o.flag] = false; return; }
    ui.stop = true;
    ui.btn.textContent = 'Зупиняю...';
  };
  return ui;
};
