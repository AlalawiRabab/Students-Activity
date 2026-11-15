/**
 * parents-ui.js — عناصر عرض مشتركة لـ «بعيون أهالينا»: صور كسولة + عارض صور
 */
import { createEl, clearElement, logDev } from './utils.js';
import { icon } from './icons.js';

let observer = null;
const starters = new WeakMap();

function runOnce(el) {
  const fn = starters.get(el);
  if (!fn) return;
  starters.delete(el);
  if (observer) observer.unobserve(el);
  fn();
}

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
          runOnce(e.target);
        });
      },
      { rootMargin: '300px 0px', threshold: 0.01 }
    );
  }
  starters.set(el, start);
  observer.observe(el);
  // عناصر أعلى الصفحة قد لا تُبلَّغ فوراً في بعض البيئات — ابدأ إن كانت ظاهرة
  requestAnimationFrame(() => {
    if (!starters.has(el) || !el.isConnected) return;
    const rect = el.getBoundingClientRect();
    const vh = window.innerHeight || document.documentElement.clientHeight || 0;
    if (rect.bottom >= -300 && rect.top <= vh + 300) runOnce(el);
  });
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
      // لا نضع loading=lazy هنا: الصورة تُنشأ خارج الـ DOM حتى يكتمل التحميل،
      // والتحميل الكسول يتم مسبقاً عبر IntersectionObserver.
      const img = createEl('img', {
        alt,
        decoding: 'async',
        src: url,
        style: `object-fit:${fit}`,
      });
      img.addEventListener('load', () => {
        box.replaceChildren(img);
        box.classList.remove(`${className}--loading`);
        box.removeAttribute('aria-busy');
      });
      img.addEventListener('error', () => markFailed(box, className));
      if (img.complete && img.naturalWidth) {
        box.replaceChildren(img);
        box.classList.remove(`${className}--loading`);
        box.removeAttribute('aria-busy');
      }
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
 * عارض صور بملء الشاشة مع التنقل (يدعم الجوال)
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
  const overlay = createEl('div', {
    className: 'preview-overlay pe-lightbox',
    role: 'dialog',
    'aria-modal': 'true',
    'aria-label': 'عرض الصورة',
  }, [
    createEl('div', { className: 'preview-box' }, [
      createEl('div', { className: 'preview-head' }, [
        createEl('div', { className: 'preview-head__titles' }, [
          createEl('strong', { dir: 'auto', textContent: caption || 'صورة' }),
          counter,
        ]),
        actions,
      ]),
      stage,
      createEl('div', { className: 'pe-lightbox__nav' }, [
        // تُملأ أدناه إن وُجدت عدة صور
      ]),
    ]),
  ]);

  const navBar = overlay.querySelector('.pe-lightbox__nav');

  const btn = (label, iconName, fn, cls = 'btn btn--ghost btn--sm pe-lightbox__btn') => {
    const b = createEl('button', { type: 'button', className: cls }, [
      icon(iconName, { size: 20 }),
      createEl('span', { className: 'btn__label', textContent: label }),
    ]);
    b.addEventListener('click', (e) => {
      e.stopPropagation();
      fn();
    });
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
  if (items.length > 1) {
    actions.append(
      btn('السابق', 'chevronRight', () => go(-1)),
      btn('التالي', 'chevronLeft', () => go(1))
    );
    navBar.append(
      btn('السابق', 'chevronRight', () => go(-1), 'btn btn--ghost pe-lightbox__fab'),
      btn('التالي', 'chevronLeft', () => go(1), 'btn btn--ghost pe-lightbox__fab')
    );
  } else {
    navBar.remove();
  }
  actions.append(btn('إغلاق', 'close', close, 'btn btn--primary btn--sm pe-lightbox__btn'));

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
      stage.appendChild(createEl('img', {
        className: 'preview-image',
        src: url,
        alt: cur.alt || '',
        decoding: 'async',
      }));
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

/** شبكة صور مصغّرة (لوحة الإدارة) */
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

/**
 * عرض كبير للمشاركات المنشورة: صورة بعرض البطاقة دون قص،
 * مع تنقّل ومؤشر عند تعدد الصور، وفتح عارض عند الضغط.
 */
export function postMediaLarge(images, { getUrl, caption }) {
  if (!images.length) return null;
  const items = images.map((img, i) => ({ getUrl: () => getUrl(img), alt: `صورة ${i + 1}` }));
  let index = 0;

  const frame = createEl('div', { className: 'pe-media' });
  const stage = createEl('button', {
    type: 'button',
    className: 'pe-media__stage',
    'aria-label': 'تكبير الصورة',
  });
  const counter = createEl('span', { className: 'pe-media__counter', hidden: images.length < 2 });
  const dots = createEl('div', { className: 'pe-media__dots', hidden: images.length < 2, role: 'tablist', 'aria-label': 'صور المشاركة' });
  const prev = createEl('button', {
    type: 'button',
    className: 'pe-media__nav pe-media__nav--prev',
    'aria-label': 'الصورة السابقة',
    hidden: images.length < 2,
  }, [icon('chevronRight', { size: 22 })]);
  const next = createEl('button', {
    type: 'button',
    className: 'pe-media__nav pe-media__nav--next',
    'aria-label': 'الصورة التالية',
    hidden: images.length < 2,
  }, [icon('chevronLeft', { size: 22 })]);

  if (images.length > 1) {
    images.forEach((_, i) => {
      const dot = createEl('button', {
        type: 'button',
        className: 'pe-media__dot',
        role: 'tab',
        'aria-label': `الصورة ${i + 1}`,
      });
      dot.addEventListener('click', (e) => {
        e.stopPropagation();
        index = i;
        show();
      });
      dots.appendChild(dot);
    });
  }

  function show() {
    clearElement(stage);
    stage.appendChild(
      lazyImage({
        getUrl: () => getUrl(images[index]),
        className: 'pe-media__img',
        alt: `صورة ${index + 1}`,
        fit: 'contain',
      })
    );
    if (images.length > 1) {
      counter.hidden = false;
      counter.textContent = `${index + 1} / ${images.length}`;
      [...dots.children].forEach((d, i) => {
        d.classList.toggle('is-active', i === index);
        d.setAttribute('aria-selected', i === index ? 'true' : 'false');
      });
    }
  }

  prev.addEventListener('click', (e) => {
    e.stopPropagation();
    index = (index - 1 + images.length) % images.length;
    show();
  });
  next.addEventListener('click', (e) => {
    e.stopPropagation();
    index = (index + 1) % images.length;
    show();
  });
  stage.addEventListener('click', () => openLightbox(items, index, caption));

  frame.append(stage, prev, next, counter, dots);
  show();
  return frame;
}
