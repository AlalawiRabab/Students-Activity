/**
 * parents-ui.js — عناصر عرض مشتركة لـ «بعيون أهالينا»: صور كسولة + عارض صور
 */
import { createEl, clearElement, logDev } from './utils.js';
import { icon } from './icons.js';

let observer = null;
const starters = new WeakMap();

function lazy(el, start) {
  if (typeof IntersectionObserver === 'undefined') {
    start();
    return;
  }
  if (!observer) {
    observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((e) => {
          if (!e.isIntersecting) return;
          observer.unobserve(e.target);
          const fn = starters.get(e.target);
          starters.delete(e.target);
          if (fn) fn();
        });
      },
      { rootMargin: '300px 0px' }
    );
  }
  starters.set(el, start);
  observer.observe(el);
}

/**
 * صورة تُحمَّل عند اقترابها من الشاشة
 * @param {{ getUrl: () => Promise<string>, alt?: string, className?: string, fit?: 'cover'|'contain' }} opts
 */
export function lazyImage({ getUrl, alt = '', className = 'pe-img', fit = 'cover' }) {
  const box = createEl('div', { className: `${className} ${className}--loading`, 'aria-busy': 'true' }, [
    createEl('span', { className: 'spinner spinner--dark', 'aria-hidden': 'true' }),
  ]);
  lazy(box, async () => {
    try {
      const url = await getUrl();
      const img = createEl('img', { alt, decoding: 'async', src: url, style: `object-fit:${fit}` });
      img.addEventListener('load', () => {
        box.replaceChildren(img);
        box.classList.remove(`${className}--loading`);
        box.removeAttribute('aria-busy');
      });
      img.addEventListener('error', () => markFailed(box, className));
    } catch (err) {
      logDev('image', err);
      markFailed(box, className);
    }
  });
  return box;
}

function markFailed(box, className) {
  box.classList.remove(`${className}--loading`);
  box.classList.add(`${className}--failed`);
  box.removeAttribute('aria-busy');
  box.replaceChildren(icon('image', { size: 26 }));
}

/**
 * عارض صور بملء الشاشة مع التنقل
 * @param {{ getUrl: () => Promise<string>, alt?: string }[]} items
 * @param {number} start
 * @param {string} [caption]
 */
export function openLightbox(items, start = 0, caption = '') {
  if (!items.length) return;
  let index = start;
  const stage = createEl('div', { className: 'preview-stage' });
  const counter = createEl('span', { className: 'muted' });
  const actions = createEl('div', { className: 'preview-head__actions' });
  const overlay = createEl('div', { className: 'preview-overlay', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'عرض الصورة' }, [
    createEl('div', { className: 'preview-box' }, [
      createEl('div', { className: 'preview-head' }, [
        createEl('div', { className: 'preview-head__titles' }, [
          createEl('strong', { dir: 'auto', textContent: caption || 'صورة' }),
          counter,
        ]),
        actions,
      ]),
      stage,
    ]),
  ]);

  const btn = (label, iconName, fn, cls = 'btn btn--ghost btn--sm') => {
    const b = createEl('button', { type: 'button', className: cls }, [
      icon(iconName, { size: 18 }),
      createEl('span', { className: 'btn__label', textContent: label }),
    ]);
    b.addEventListener('click', fn);
    return b;
  };
  const close = () => {
    document.removeEventListener('keydown', onKey);
    overlay.remove();
  };
  const go = (d) => {
    if (items.length < 2) return;
    index = (index + d + items.length) % items.length;
    render();
  };
  const onKey = (e) => {
    if (e.key === 'Escape') close();
    else if (e.key === 'ArrowLeft') go(1);
    else if (e.key === 'ArrowRight') go(-1);
  };
  if (items.length > 1) actions.append(btn('السابق', 'chevronRight', () => go(-1)), btn('التالي', 'chevronLeft', () => go(1)));
  actions.append(btn('إغلاق', 'close', close, 'btn btn--primary btn--sm'));

  async function render() {
    const cur = items[index];
    counter.textContent = items.length > 1 ? `${index + 1} / ${items.length}` : '';
    clearElement(stage);
    stage.appendChild(createEl('div', { className: 'preview-loading' }, [
      createEl('span', { className: 'spinner spinner--dark', 'aria-hidden': 'true' }),
      createEl('span', { textContent: 'جارٍ تحميل الصورة...' }),
    ]));
    try {
      const url = await cur.getUrl();
      if (items[index] !== cur || !overlay.isConnected) return;
      clearElement(stage);
      stage.appendChild(createEl('img', { className: 'preview-image', src: url, alt: cur.alt || '' }));
    } catch (err) {
      logDev(err);
      clearElement(stage);
      stage.appendChild(createEl('p', { className: 'muted', textContent: 'تعذّر تحميل الصورة' }));
    }
  }

  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) close();
  });
  document.addEventListener('keydown', onKey);
  document.body.appendChild(overlay);
  render();
}

/** شبكة صور المشاركة: صورة كبيرة + مصغرات */
export function postGallery(images, { getUrl, caption }) {
  if (!images.length) return null;
  const items = images.map((img, i) => ({ getUrl: () => getUrl(img), alt: `صورة ${i + 1}` }));
  const grid = createEl('div', { className: `pe-gallery pe-gallery--${Math.min(images.length, 5)}` });
  images.forEach((img, i) => {
    const b = createEl('button', { type: 'button', className: 'pe-gallery__item', 'aria-label': `عرض الصورة ${i + 1}` }, [
      lazyImage({ getUrl: () => getUrl(img), className: 'pe-img' }),
    ]);
    b.addEventListener('click', () => openLightbox(items, i, caption));
    grid.appendChild(b);
  });
  return grid;
}
