/**
 * parents-share.js — نموذج مشاركة ولي الأمر (بدون حساب)
 * التحقق هنا للراحة فقط؛ التحقق الفعلي في Edge Function parent-submit.
 */
import { bootPublicPage } from './app.js';
import {
  listEvents,
  submitParentPost,
  imageObjectUrl,
  bindMediaBlobLifecycle,
  MEDIA_LOCAL_COPY_NOTE,
} from './parents-service.js';
import { isMissingSchemaError } from './file-manager.js';
import {
  PARENT_MAX_IMAGES,
  PARENT_MAX_IMAGE_SIZE,
  PARENT_MAX_VIDEO_SIZE,
  PARENT_MAX_AUDIO_SIZE,
  PARENT_VIDEO_ACCEPT,
  PARENT_AUDIO_ACCEPT,
} from './config.js';
import { validateParentImage, validateParentVideo, validateParentAudio } from './validators.js';
import { setButtonLoading, field, copyShareLinkButton } from './ui.js';
import { createEl, clearElement, formatBytes, logDev } from './utils.js';
import { icon } from './icons.js';

export const CONSENT_TEXT =
  'أؤكد موافقتي وامتلاكي الإذن بمشاركة الصور والفيديو والتسجيلات الصوتية المرفقة للنشر في منصة المدرسة';
export const THANKS_TEXT = 'شكرًا لمشاركتكم، ستظهر بعد مراجعتها واعتمادها من رائدة النشاط';
export const NAME_REQUIRED_MSG = 'يرجى كتابة اسم الطالبة أو ولية أمر الطالبة';
const MAX_NAME = 80;
const MAX_COMMENT = 2000;
const MAX_SIDE = 2560;

bootPublicPage({ title: 'مشاركة الأهالي' }, async (ctx) => {
  bindMediaBlobLifecycle();
  const root = ctx.content;
  root.appendChild(
    createEl('section', { className: 'pub-page-head' }, [
      createEl('span', { className: 'pub-page-head__icon' }, [icon('camera', { size: 30 })]),
      createEl('div', { className: 'pub-page-head__text' }, [
        createEl('h1', { textContent: 'مشاركة الأهالي' }),
        createEl('p', {
          textContent:
            'أرسلوا صوركم أو فيديو أو تسجيلاً صوتياً وانطباعاتكم عن أنشطة المدرسة، دون الحاجة إلى حساب أو رقم سري.',
        }),
      ]),
      createEl('div', { className: 'pub-page-head__actions' }, [
        createEl('a', {
          href: './parents-eyes.html',
          className: 'btn btn--primary',
          title: 'مشاهدة المشاركات المنشورة',
        }, [
          icon('eye', { size: 18 }),
          createEl('span', { textContent: 'مشاهدة المشاركات المنشورة' }),
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
  /** @type {{ file: File, url: string }|null} */
  let video = null;
  /** @type {{ file: File, url: string }|null} */
  let audio = null;
  let coverToken = 0;
  /** @type {MediaRecorder|null} */
  let recorder = null;
  /** @type {MediaStream|null} */
  let micStream = null;
  /** @type {Blob[]} */
  let recordChunks = [];

  const form = createEl('form', { className: 'form-grid pe-form', novalidate: true });
  const alertBox = createEl('div', { className: 'alert alert--error', role: 'alert' });
  const progressBox = createEl('div', { className: 'pe-upload-progress', hidden: true, 'aria-live': 'polite' });
  const progressBar = createEl('div', { className: 'pe-upload-progress__bar' });
  const progressLabel = createEl('span', { className: 'muted', textContent: '' });
  progressBox.append(
    createEl('div', { className: 'pe-upload-progress__track' }, [progressBar]),
    progressLabel
  );

  const eventSel = createEl('select', { className: 'select', required: true, 'aria-required': 'true' }, [
    createEl('option', { value: '', textContent: 'اختر المناسبة' }),
    ...events.map((ev) => createEl('option', { value: ev.id, textContent: ev.title })),
  ]);
  if (requested && events.some((e) => e.id === requested)) eventSel.value = requested;
  else if (events.length === 1) eventSel.value = events[0].id;

  const eventPreview = createEl('div', {
    className: 'pe-event-preview',
    hidden: true,
    'aria-live': 'polite',
  });

  function renderEventPreview() {
    const token = ++coverToken;
    clearElement(eventPreview);
    const ev = events.find((e) => e.id === eventSel.value);
    if (!ev) {
      eventPreview.hidden = true;
      return;
    }
    eventPreview.hidden = false;
    const body = createEl('div', { className: 'pe-event-preview__body' }, [
      createEl('strong', { className: 'pe-event-preview__title', textContent: ev.title }),
      ev.description
        ? createEl('p', { className: 'pe-event-preview__desc', textContent: ev.description })
        : null,
    ]);
    if (!ev.cover_path) {
      eventPreview.appendChild(body);
      return;
    }
    const media = createEl('div', {
      className: 'pe-event-preview__cover pe-event-preview__cover--loading',
      'aria-busy': 'true',
    }, [createEl('span', { className: 'spinner spinner--dark', 'aria-hidden': 'true' })]);
    eventPreview.append(media, body);
    (async () => {
      try {
        const url = await imageObjectUrl(ev.cover_path);
        if (token !== coverToken || !eventPreview.isConnected) return;
        const img = createEl('img', { src: url, alt: `صورة مناسبة ${ev.title}`, decoding: 'async' });
        const show = () => {
          if (token !== coverToken || !media.isConnected) return;
          media.replaceChildren(img);
          media.classList.remove('pe-event-preview__cover--loading');
          media.removeAttribute('aria-busy');
        };
        img.addEventListener('load', show);
        img.addEventListener('error', () => { if (token === coverToken) media.remove(); });
        if (img.complete && img.naturalWidth) show();
      } catch (err) {
        logDev('event cover', err);
        if (token === coverToken) media.remove();
      }
    })();
  }
  eventSel.addEventListener('change', renderEventPreview);

  const nameInput = createEl('input', {
    className: 'input',
    maxlength: String(MAX_NAME),
    autocomplete: 'name',
    required: true,
    'aria-required': 'true',
  });

  const comment = createEl('textarea', {
    className: 'textarea',
    maxlength: String(MAX_COMMENT),
    rows: '5',
    placeholder: 'اكتب انطباعك أو وصفاً للمرفقات...',
  });
  const counter = createEl('span', { className: 'field__hint pe-counter', textContent: `0 / ${MAX_COMMENT}` });
  comment.addEventListener('input', () => {
    counter.textContent = `${comment.value.length} / ${MAX_COMMENT}`;
  });

  const imgPicker = createEl('input', {
    type: 'file',
    multiple: true,
    accept: 'image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp',
    className: 'visually-hidden',
    tabindex: '-1',
    'aria-hidden': 'true',
  });
  const videoPicker = createEl('input', {
    type: 'file',
    accept: PARENT_VIDEO_ACCEPT,
    className: 'visually-hidden',
    tabindex: '-1',
    'aria-hidden': 'true',
  });
  const audioPicker = createEl('input', {
    type: 'file',
    accept: PARENT_AUDIO_ACCEPT,
    className: 'visually-hidden',
    tabindex: '-1',
    'aria-hidden': 'true',
  });

  const imgBtn = createEl('button', { type: 'button', className: 'btn btn--ghost pe-pick' }, [
    icon('camera', { size: 18 }),
    createEl('span', { textContent: 'إضافة صور' }),
  ]);
  const videoBtn = createEl('button', { type: 'button', className: 'btn btn--ghost pe-pick' }, [
    icon('video', { size: 18 }),
    createEl('span', { textContent: 'إضافة فيديو' }),
  ]);
  const audioBtn = createEl('button', { type: 'button', className: 'btn btn--ghost pe-pick' }, [
    icon('upload', { size: 18 }),
    createEl('span', { textContent: 'إضافة تسجيل صوتي' }),
  ]);
  const recordBtn = createEl('button', { type: 'button', className: 'btn btn--ghost pe-pick' }, [
    icon('mic', { size: 18 }),
    createEl('span', { textContent: 'تسجيل من الميكروفون' }),
  ]);
  const canRecord = typeof MediaRecorder !== 'undefined' && !!navigator.mediaDevices?.getUserMedia;
  if (!canRecord) recordBtn.hidden = true;

  const imgCount = createEl('span', { className: 'muted' });
  const mediaHint = createEl('span', {
    className: 'field__hint',
    textContent: `حتى ${PARENT_MAX_IMAGES} صور (5 م.ب لكل صورة)، وفيديو واحد حتى ${PARENT_MAX_VIDEO_SIZE / (1024 * 1024)} م.ب، وملف صوتي واحد حتى ${PARENT_MAX_AUDIO_SIZE / (1024 * 1024)} م.ب. يلزم تعليق أو مرفق واحد على الأقل.`,
  });
  const previews = createEl('div', { className: 'pe-media-previews', 'aria-live': 'polite' });

  imgBtn.addEventListener('click', () => imgPicker.click());
  videoBtn.addEventListener('click', () => videoPicker.click());
  audioBtn.addEventListener('click', () => audioPicker.click());
  imgPicker.addEventListener('change', () => {
    addImages([...(imgPicker.files || [])]);
    imgPicker.value = '';
  });
  videoPicker.addEventListener('change', () => {
    const f = videoPicker.files?.[0];
    videoPicker.value = '';
    if (f) setVideo(f);
  });
  audioPicker.addEventListener('change', () => {
    const f = audioPicker.files?.[0];
    audioPicker.value = '';
    if (f) setAudio(f);
  });

  function stopMic() {
    if (recorder && recorder.state !== 'inactive') {
      try { recorder.stop(); } catch { /* ignore */ }
    }
    recorder = null;
    micStream?.getTracks().forEach((t) => t.stop());
    micStream = null;
    recordChunks = [];
    recordBtn.classList.remove('is-recording');
    recordBtn.replaceChildren(icon('mic', { size: 18 }), createEl('span', { textContent: 'تسجيل من الميكروفون' }));
  }

  recordBtn.addEventListener('click', async () => {
    if (recorder && recorder.state === 'recording') {
      recorder.stop();
      return;
    }
    try {
      micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      recordChunks = [];
      const mime = MediaRecorder.isTypeSupported('audio/webm')
        ? 'audio/webm'
        : MediaRecorder.isTypeSupported('audio/mp4')
        ? 'audio/mp4'
        : '';
      recorder = mime ? new MediaRecorder(micStream, { mimeType: mime }) : new MediaRecorder(micStream);
      recorder.ondataavailable = (e) => {
        if (e.data?.size) recordChunks.push(e.data);
      };
      recorder.onstop = () => {
        const type = recorder?.mimeType || recordChunks[0]?.type || 'audio/webm';
        const blob = new Blob(recordChunks, { type });
        micStream?.getTracks().forEach((t) => t.stop());
        micStream = null;
        recorder = null;
        recordBtn.classList.remove('is-recording');
        recordBtn.replaceChildren(icon('mic', { size: 18 }), createEl('span', { textContent: 'تسجيل من الميكروفون' }));
        const ext = type.includes('mp4') ? 'm4a' : type.includes('ogg') ? 'ogg' : 'webm';
        const file = new File([blob], `recording.${ext}`, { type });
        setAudio(file);
      };
      recorder.start();
      recordBtn.classList.add('is-recording');
      recordBtn.replaceChildren(icon('mic', { size: 18 }), createEl('span', { textContent: 'إيقاف التسجيل' }));
    } catch (err) {
      logDev('mic', err);
      stopMic();
      showAlert('تعذّر الوصول إلى الميكروفون. يمكنك رفع ملف صوتي بدلًا من ذلك.');
    }
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

  function setVideo(file) {
    const check = validateParentVideo(file);
    if (!check.ok) return showAlert(check.error);
    if (video) URL.revokeObjectURL(video.url);
    video = { file, url: URL.createObjectURL(file) };
    renderPreviews();
  }

  function setAudio(file) {
    const check = validateParentAudio(file);
    if (!check.ok) return showAlert(check.error);
    if (audio) URL.revokeObjectURL(audio.url);
    audio = { file, url: URL.createObjectURL(file) };
    renderPreviews();
  }

  function renderPreviews() {
    clearElement(previews);
    imgCount.textContent = `${images.length} / ${PARENT_MAX_IMAGES} صور`;
    imgBtn.disabled = images.length >= PARENT_MAX_IMAGES;
    videoBtn.disabled = !!video;
    audioBtn.disabled = !!audio;

    images.forEach((it, i) => {
      const rm = createEl('button', { type: 'button', className: 'pe-preview__rm', 'aria-label': 'إزالة الصورة' }, [
        icon('close', { size: 16 }),
      ]);
      rm.addEventListener('click', () => {
        URL.revokeObjectURL(it.url);
        images = images.filter((_, j) => j !== i);
        renderPreviews();
      });
      previews.appendChild(
        createEl('div', { className: 'pe-preview pe-preview--image' }, [
          createEl('img', { src: it.url, alt: '' }),
          createEl('span', { className: 'pe-preview__size', textContent: formatBytes(it.file.size) }),
          rm,
        ])
      );
    });

    if (video) {
      const rm = createEl('button', { type: 'button', className: 'pe-preview__rm', 'aria-label': 'إزالة الفيديو' }, [
        icon('close', { size: 16 }),
      ]);
      rm.addEventListener('click', () => {
        URL.revokeObjectURL(video.url);
        video = null;
        renderPreviews();
      });
      const replace = createEl('button', { type: 'button', className: 'btn btn--ghost btn--sm', textContent: 'استبدال الفيديو' });
      replace.addEventListener('click', () => videoPicker.click());
      previews.appendChild(
        createEl('div', { className: 'pe-preview pe-preview--av' }, [
          createEl('video', { src: video.url, controls: true, playsInline: true, preload: 'metadata' }),
          createEl('div', { className: 'pe-preview__av-meta' }, [
            createEl('strong', { textContent: 'فيديو' }),
            createEl('span', { className: 'muted', textContent: formatBytes(video.file.size) }),
            replace,
          ]),
          rm,
        ])
      );
    }

    if (audio) {
      const rm = createEl('button', { type: 'button', className: 'pe-preview__rm', 'aria-label': 'إزالة الصوت' }, [
        icon('close', { size: 16 }),
      ]);
      rm.addEventListener('click', () => {
        URL.revokeObjectURL(audio.url);
        audio = null;
        renderPreviews();
      });
      const replace = createEl('button', { type: 'button', className: 'btn btn--ghost btn--sm', textContent: 'استبدال الصوت' });
      replace.addEventListener('click', () => audioPicker.click());
      previews.appendChild(
        createEl('div', { className: 'pe-preview pe-preview--av' }, [
          createEl('audio', { src: audio.url, controls: true, preload: 'metadata' }),
          createEl('div', { className: 'pe-preview__av-meta' }, [
            createEl('strong', { textContent: 'تسجيل صوتي' }),
            createEl('span', { className: 'muted', textContent: formatBytes(audio.file.size) }),
            replace,
          ]),
          rm,
        ])
      );
    }
  }
  renderPreviews();

  const consent = createEl('input', { type: 'checkbox', required: true, 'aria-required': 'true' });
  const consentLabel = createEl('label', { className: 'pe-consent' }, [
    consent,
    createEl('span', { textContent: CONSENT_TEXT }),
  ]);

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
    progressBox,
    field('المناسبة', eventSel),
    eventPreview,
    field('اسم الطالبة / ولية أمر الطالبة', nameInput, 'سيظهر الاسم مع المشاركة بعد اعتمادها'),
    createEl('label', { className: 'field' }, [
      createEl('span', { className: 'field__label', textContent: 'التعليق أو وصف المشاركة' }),
      comment,
      counter,
    ]),
    createEl('div', { className: 'field' }, [
      createEl('span', { className: 'field__label', textContent: 'المرفقات' }),
      createEl('div', { className: 'pe-pick-row' }, [imgBtn, videoBtn, audioBtn, recordBtn, imgCount]),
      mediaHint,
      previews,
      imgPicker,
      videoPicker,
      audioPicker,
    ]),
    consentLabel,
    hp,
    createEl('p', { className: 'pe-note muted' }, [
      icon('info', { size: 16 }),
      createEl('span', {
        textContent:
          'تُراجع رائدة النشاط المشاركات قبل نشرها. لا يمكن تعديل المشاركة أو حذفها بعد الإرسال. ' +
          MEDIA_LOCAL_COPY_NOTE,
      }),
    ]),
    createEl('div', { className: 'modal__actions' }, [submit])
  );
  host.appendChild(form);
  renderEventPreview();

  function showAlert(msg) {
    alertBox.textContent = msg;
    alertBox.classList.add('is-visible');
    alertBox.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    alertBox.classList.remove('is-visible');
    stopMic();
    const text = comment.value.trim();
    const authorName = nameInput.value.trim();
    if (!eventSel.value) return showAlert('اختر المناسبة');
    if (!authorName) return showAlert(NAME_REQUIRED_MSG);
    if (authorName.length > MAX_NAME) return showAlert(`الاسم يجب ألا يتجاوز ${MAX_NAME} حرفاً`);
    if (!text && !images.length && !video && !audio) return showAlert('أضف تعليقاً أو مرفقاً على الأقل');
    if (!consent.checked) return showAlert('يلزم الإقرار بالموافقة قبل الإرسال');

    setButtonLoading(submit, true, 'جارٍ الإرسال...');
    progressBox.hidden = false;
    progressBar.style.width = '0%';
    progressLabel.textContent = 'جارٍ تجهيز المرفقات...';
    try {
      const fd = new FormData();
      fd.append('event_id', eventSel.value);
      fd.append('author_name', authorName);
      fd.append('comment', text);
      fd.append('consent', 'yes');
      fd.append('website', honeypot.value);
      fd.append('elapsed_ms', String(Date.now() - startedAt));
      for (const it of images) {
        const prepared = await prepareImage(it.file);
        fd.append('images', prepared, prepared.name);
      }
      progressLabel.textContent = video || audio
        ? 'جارٍ رفع الفيديو/الصوت مباشرة...'
        : 'جارٍ رفع المشاركة...';
      await submitParentPost(fd, {
        video: video?.file || null,
        audio: audio?.file || null,
        onProgress: (pct) => {
          progressBar.style.width = `${pct}%`;
          progressLabel.textContent = `جارٍ الرفع... ${pct}%`;
        },
      });
      images.forEach((it) => URL.revokeObjectURL(it.url));
      if (video) URL.revokeObjectURL(video.url);
      if (audio) URL.revokeObjectURL(audio.url);
      renderThanks(host, events);
    } catch (err) {
      logDev(err);
      showAlert(err.message || 'تعذّر إرسال المشاركة');
      progressBox.hidden = true;
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
        createEl('a', { href: './parents-eyes.html', className: 'btn btn--primary' }, [
          icon('eye', { size: 18 }),
          createEl('span', { textContent: 'مشاهدة المشاركات المنشورة' }),
        ]),
      ]),
    ])
  );
  host.scrollIntoView({ block: 'start', behavior: 'smooth' });
}

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
