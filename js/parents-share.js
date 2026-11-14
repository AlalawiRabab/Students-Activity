/**
 * parents-share.js — نموذج مشاركة ولي الأمر (بدون حساب)
 * التحقق هنا للراحة فقط؛ التحقق الفعلي والحد من الإرسال المتكرر في Edge Function parent-submit.
 */
import { bootPublicPage } from './app.js';
import { listEvents, submitParentPost } from './parents-service.js';
import { isMissingSchemaError } from './file-manager.js';
import { PARENT_MAX_IMAGES, PARENT_MAX_IMAGE_SIZE } from './config.js';
import { validateParentImage } from './validators.js';
import { setButtonLoading, field, copyShareLinkButton } from './ui.js';
import { createEl, clearElement, formatBytes, logDev } from './utils.js';
import { icon } from './icons.js';

export const CONSENT_TEXT = 'أؤكد موافقتي وامتلاكي الإذن بمشاركة الصور المرفقة للنشر في منصة المدرسة';
export const THANKS_TEXT = 'شكرًا لمشاركتكم، ستظهر بعد مراجعتها واعتمادها من رائدة النشاط';
const MAX_NAME = 80;
const MAX_COMMENT = 2000;
const MAX_SIDE = 2560;

bootPublicPage({ title: 'مشاركة الأهالي' }, async (ctx) => {
  const root = ctx.content;
  root.appendChild(
    createEl('section', { className: 'pub-page-head' }, [
      createEl('span', { className: 'pub-page-head__icon' }, [icon('camera', { size: 30 })]),
      createEl('div', { className: 'pub-page-head__text' }, [
        createEl('h1', { textContent: 'مشاركة الأهالي' }),
        createEl('p', { textContent: 'أرسلوا صوركم وانطباعاتكم عن أنشطة المدرسة ومناسباتها، دون الحاجة إلى حساب أو رقم سري.' }),
      ]),
      createEl('div', { className: 'pub-page-head__actions' }, [
        createEl('a', { href: './parents-eyes.html', className: 'btn btn--ghost' }, [
          icon('heart', { size: 18 }),
          createEl('span', { textContent: 'تصفح المشاركات' }),
        ]),
        copyShareLinkButton('btn btn--ghost'),
      ]),
    ])
  );
  const host = createEl('section', { className: 'card pe-form-card' });
  root.appendChild(host);

  let events = [];
  try {
    events = await listEvents({ openOnly: true });
  } catch (err) {
    logDev(err);
    host.appendChild(createEl('p', {
      textContent: isMissingSchemaError(err) ? 'قسم «بعيون أهالينا» غير مفعّل بعد' : 'تعذّر تحميل المناسبات، حاول لاحقاً',
    }));
    return;
  }
  if (!events.length) {
    host.appendChild(createEl('div', { className: 'fm-empty' }, [
      createEl('div', { className: 'fm-empty__icon' }, [icon('calendarSmall', { size: 30 })]),
      createEl('strong', { textContent: 'لا توجد مناسبات تستقبل المشاركات حالياً' }),
      createEl('span', { className: 'muted', textContent: 'تابعونا لاحقاً، وتصفحوا المشاركات المنشورة.' }),
    ]));
    return;
  }
  renderForm(host, events);
});

function renderForm(host, events) {
  clearElement(host);
  const startedAt = Date.now();
  const requested = new URLSearchParams(location.search).get('event');
  /** @type {{ file: File, url: string }[]} */
  let images = [];

  const form = createEl('form', { className: 'form-grid pe-form', novalidate: true });
  const alertBox = createEl('div', { className: 'alert alert--error', role: 'alert' });

  const eventSel = createEl('select', { className: 'select', required: true, 'aria-required': 'true' }, [
    createEl('option', { value: '', textContent: 'اختر المناسبة' }),
    ...events.map((ev) => createEl('option', { value: ev.id, textContent: ev.title })),
  ]);
  if (requested && events.some((e) => e.id === requested)) eventSel.value = requested;
  else if (events.length === 1) eventSel.value = events[0].id;

  const nameInput = createEl('input', {
    className: 'input',
    maxlength: String(MAX_NAME),
    autocomplete: 'name',
    placeholder: 'مثال: أم سارة',
  });

  const comment = createEl('textarea', {
    className: 'textarea',
    maxlength: String(MAX_COMMENT),
    rows: '5',
    placeholder: 'اكتب انطباعك أو وصفاً للصور...',
  });
  const counter = createEl('span', { className: 'field__hint pe-counter', textContent: `0 / ${MAX_COMMENT}` });
  comment.addEventListener('input', () => {
    counter.textContent = `${comment.value.length} / ${MAX_COMMENT}`;
  });

  const picker = createEl('input', {
    type: 'file',
    multiple: true,
    accept: 'image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp',
    className: 'visually-hidden',
    tabindex: '-1',
    'aria-hidden': 'true',
  });
  const pickBtn = createEl('button', { type: 'button', className: 'btn btn--ghost pe-pick' }, [
    icon('upload', { size: 18 }),
    createEl('span', { textContent: 'إضافة صور' }),
  ]);
  const imgCount = createEl('span', { className: 'muted' });
  const previews = createEl('div', { className: 'pe-previews', 'aria-live': 'polite' });
  pickBtn.addEventListener('click', () => picker.click());
  picker.addEventListener('change', () => {
    addImages([...(picker.files || [])]);
    picker.value = '';
  });

  function addImages(files) {
    for (const f of files) {
      if (images.length >= PARENT_MAX_IMAGES) {
        showAlert(`الحد الأقصى ${PARENT_MAX_IMAGES} صور لكل مشاركة`);
        break;
      }
      const check = validateParentImage(f);
      if (!check.ok) {
        showAlert(check.error);
        continue;
      }
      images.push({ file: f, url: URL.createObjectURL(f) });
    }
    renderPreviews();
  }

  function renderPreviews() {
    clearElement(previews);
    imgCount.textContent = `${images.length} / ${PARENT_MAX_IMAGES} صور`;
    pickBtn.disabled = images.length >= PARENT_MAX_IMAGES;
    images.forEach((it, i) => {
      const rm = createEl('button', { type: 'button', className: 'pe-preview__rm', 'aria-label': `إزالة ${it.file.name}` }, [
        icon('close', { size: 16 }),
      ]);
      rm.addEventListener('click', () => {
        URL.revokeObjectURL(it.url);
        images = images.filter((_, j) => j !== i);
        renderPreviews();
      });
      previews.appendChild(
        createEl('div', { className: 'pe-preview' }, [
          createEl('img', { src: it.url, alt: '' }),
          createEl('span', { className: 'pe-preview__size', textContent: formatBytes(it.file.size) }),
          rm,
        ])
      );
    });
  }
  renderPreviews();

  const consent = createEl('input', { type: 'checkbox', required: true, 'aria-required': 'true' });
  const consentLabel = createEl('label', { className: 'pe-consent' }, [consent, createEl('span', { textContent: CONSENT_TEXT })]);

  const honeypot = createEl('input', { type: 'text', name: 'website', tabindex: '-1', autocomplete: 'off' });
  const hp = createEl('div', { className: 'hp-field', 'aria-hidden': 'true' }, [
    createEl('label', {}, ['اترك هذا الحقل فارغاً', honeypot]),
  ]);

  const submit = createEl('button', { type: 'submit', className: 'btn btn--primary btn--lg' }, [
    icon('check', { size: 18 }),
    createEl('span', { textContent: 'إرسال المشاركة' }),
  ]);

  form.append(
    alertBox,
    field('المناسبة', eventSel),
    field('اسم المشارك (اختياري)', nameInput, 'سيظهر هذا الاسم مع مشاركتك عند نشرها. اتركه فارغاً لتظهر باسم «ولي أمر».'),
    createEl('label', { className: 'field' }, [
      createEl('span', { className: 'field__label', textContent: 'التعليق أو وصف المشاركة' }),
      comment,
      counter,
    ]),
    createEl('div', { className: 'field' }, [
      createEl('span', { className: 'field__label', textContent: 'الصور (اختياري)' }),
      createEl('div', { className: 'pe-pick-row' }, [pickBtn, imgCount]),
      createEl('span', {
        className: 'field__hint',
        textContent: `حتى ${PARENT_MAX_IMAGES} صور، بحد أقصى ${PARENT_MAX_IMAGE_SIZE / (1024 * 1024)} ميجابايت لكل صورة (JPG أو PNG أو WEBP). يلزم وجود صورة أو تعليق على الأقل.`,
      }),
      previews,
      picker,
    ]),
    consentLabel,
    hp,
    createEl('p', { className: 'pe-note muted' }, [
      icon('info', { size: 16 }),
      createEl('span', { textContent: 'تُراجع رائدة النشاط المشاركات قبل نشرها. لا يمكن تعديل المشاركة أو حذفها بعد الإرسال.' }),
    ]),
    createEl('div', { className: 'modal__actions' }, [submit])
  );
  host.appendChild(form);

  function showAlert(msg) {
    alertBox.textContent = msg;
    alertBox.classList.add('is-visible');
    alertBox.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    alertBox.classList.remove('is-visible');
    const text = comment.value.trim();
    if (!eventSel.value) return showAlert('اختر المناسبة');
    if (!text && !images.length) return showAlert('أضف صورة أو تعليقاً على الأقل');
    if (nameInput.value.trim().length > MAX_NAME) return showAlert(`الاسم يجب ألا يتجاوز ${MAX_NAME} حرفاً`);
    if (!consent.checked) return showAlert('يلزم الإقرار بالموافقة قبل الإرسال');

    setButtonLoading(submit, true, 'جارٍ الإرسال...');
    try {
      const fd = new FormData();
      fd.append('event_id', eventSel.value);
      fd.append('author_name', nameInput.value.trim());
      fd.append('comment', text);
      fd.append('consent', 'yes');
      fd.append('website', honeypot.value);
      fd.append('elapsed_ms', String(Date.now() - startedAt));
      for (const it of images) {
        const prepared = await prepareImage(it.file);
        fd.append('images', prepared, prepared.name);
      }
      await submitParentPost(fd);
      images.forEach((it) => URL.revokeObjectURL(it.url));
      renderThanks(host, events);
    } catch (err) {
      logDev(err);
      showAlert(err.message || 'تعذّر إرسال المشاركة');
      setButtonLoading(submit, false);
      submit.replaceChildren(icon('check', { size: 18 }), createEl('span', { textContent: 'إرسال المشاركة' }));
    }
  });
}

function renderThanks(host, events) {
  clearElement(host);
  const again = createEl('button', { type: 'button', className: 'btn btn--ghost' }, [
    icon('plus', { size: 18 }),
    createEl('span', { textContent: 'مشاركة أخرى' }),
  ]);
  again.addEventListener('click', () => renderForm(host, events));
  host.appendChild(
    createEl('div', { className: 'pe-thanks', role: 'status' }, [
      createEl('div', { className: 'pe-thanks__icon' }, [icon('check', { size: 36 })]),
      createEl('h2', { textContent: THANKS_TEXT }),
      createEl('div', { className: 'row-actions row-actions--center' }, [
        again,
        createEl('a', { href: './parents-eyes.html', className: 'btn btn--primary', textContent: 'تصفح المشاركات المنشورة' }),
      ]),
    ])
  );
  host.scrollIntoView({ block: 'start', behavior: 'smooth' });
}

/**
 * إعادة ترميز الصورة في المتصفح: تُزال البيانات الوصفية (مثل موقع GPS) ويُصغَّر الحجم للعرض.
 * عند التعذّر يُرسل الأصل (الخادم يتحقق منه في كل الأحوال).
 */
async function prepareImage(file) {
  if (typeof createImageBitmap !== 'function') return file;
  try {
    const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
    const scale = Math.min(1, MAX_SIDE / Math.max(bmp.width, bmp.height));
    const w = Math.max(1, Math.round(bmp.width * scale));
    const h = Math.max(1, Math.round(bmp.height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx2d = canvas.getContext('2d');
    const keepPng = file.type === 'image/png';
    if (!keepPng) {
      ctx2d.fillStyle = '#ffffff';
      ctx2d.fillRect(0, 0, w, h);
    }
    ctx2d.drawImage(bmp, 0, 0, w, h);
    if (bmp.close) bmp.close();
    const type = keepPng ? 'image/png' : 'image/jpeg';
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, type, 0.9));
    if (!blob || blob.size > PARENT_MAX_IMAGE_SIZE) return file;
    const base = file.name.replace(/\.[^.]+$/, '') || 'photo';
    return new File([blob], `${base}.${keepPng ? 'png' : 'jpg'}`, { type });
  } catch (err) {
    logDev('prepare image', err);
    return file;
  }
}
