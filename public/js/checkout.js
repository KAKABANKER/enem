// ============================================================
// PRODUTOS E CUPONS
// ============================================================
const PRODUCTS = {
  guia: { id: 'guia', name: 'Método ENEM: Guia Completo de Redação', price: 3.49 },
  checklist: { id: 'checklist', name: 'Caderno de Treino ENEM', price: 9.90 }
};

const COUPONS = {
  'ENEM10': { type: 'percent', value: 10 },
  'PRIMEIRA': { type: 'fixed', value: 1.00 }
};

const POLL_INTERVAL = 3000;
const POLL_TIMEOUT = 15 * 60 * 1000;
const TIMER_DURATION = 15 * 60; // 15 min em segundos

// ============================================================
// NOTIFICAÇÕES AO VIVO (fake, mas realista)
// ============================================================
const NOTIF_POOL = [
  { name: 'Marina S.', city: 'Fortaleza', av: 'MS', color: '#6366F1', action: 'acabou de comprar o guia' },
  { name: 'João C.', city: 'Recife', av: 'JC', color: '#EC4899', action: 'adicionou o Checklist' },
  { name: 'Ana L.', city: 'São Paulo', av: 'AL', color: '#F59E0B', action: 'acabou de comprar o guia' },
  { name: 'Pedro H.', city: 'Belo Horizonte', av: 'PH', color: '#10B981', action: 'acabou de comprar o guia' },
  { name: 'Camila R.', city: 'Salvador', av: 'CR', color: '#8B5CF6', action: 'adicionou o Checklist' },
  { name: 'Lucas M.', city: 'Curitiba', av: 'LM', color: '#EF4444', action: 'acabou de comprar o guia' },
  { name: 'Beatriz F.', city: 'Manaus', av: 'BF', color: '#06B6D4', action: 'acabou de comprar o guia' },
  { name: 'Rafael T.', city: 'Porto Alegre', av: 'RT', color: '#F97316', action: 'adicionou o Checklist' }
];

const TIMES = ['há 30 segundos', 'há 1 minuto', 'há 2 minutos', 'há 5 minutos', 'agora mesmo'];

function showNotif() {
  const notif = document.getElementById('live-notif');
  const data = NOTIF_POOL[Math.floor(Math.random() * NOTIF_POOL.length)];
  const time = TIMES[Math.floor(Math.random() * TIMES.length)];

  document.getElementById('notif-av').textContent = data.av;
  document.getElementById('notif-av').style.background = data.color;
  document.getElementById('notif-name').textContent = data.name;
  document.getElementById('notif-action').textContent = data.action;
  document.getElementById('notif-time').textContent = time + ' · ' + data.city;

  notif.classList.add('show');
  setTimeout(() => notif.classList.remove('show'), 5000);

  // Agenda próxima
  const next = 15000 + Math.random() * 25000;
  setTimeout(showNotif, next);
}

// Inicia depois de 8s pra não ser invasivo
setTimeout(showNotif, 8000);

// ============================================================
// TIMER DE ESCASSEZ
// ============================================================
let timerSeconds = TIMER_DURATION;
const timerEl = document.getElementById('timer');

function updateTimer() {
  const m = Math.floor(timerSeconds / 60);
  const s = timerSeconds % 60;
  timerEl.textContent = `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  if (timerSeconds > 0) timerSeconds--;
}
updateTimer();
setInterval(updateTimer, 1000);

// ============================================================
// ESTADO
// ============================================================
let state = {
  items: ['guia'],
  coupon: null,
  discount: 0
};

// ============================================================
// ELEMENTOS
// ============================================================
const form = document.getElementById('pix-form');
const formStep = document.getElementById('form-step');
const pixStep = document.getElementById('pix-step');
const submitBtn = document.getElementById('submit-btn');
const btnTotal = document.getElementById('btn-total');
const qrImg = document.getElementById('qr-img');
const copyCode = document.getElementById('copy-code');
const copyBtn = document.getElementById('copy-btn');
const statusBox = document.getElementById('status-box');
const bump = document.getElementById('bump');
const subtotalEl = document.getElementById('subtotal');
const totalEl = document.getElementById('total');
const discountRow = document.getElementById('discount-row');
const discountValue = document.getElementById('discount-value');
const pixTotalValue = document.getElementById('pix-total-value');
const stickyTotal = document.getElementById('sticky-total');
const stickyBtn = document.getElementById('sticky-btn');
const progressFill = document.getElementById('progress-fill');
const step1 = document.getElementById('step-1');
const step2 = document.getElementById('step-2');

let transactionId = null;
let pollTimer = null;
let pollStart = null;

// ============================================================
// HELPERS
// ============================================================
function formatBRL(n) {
  return 'R$ ' + n.toFixed(2).replace('.', ',');
}

function calcTotals() {
  const subtotal = state.items.reduce((acc, id) => acc + PRODUCTS[id].price, 0);
  const total = Math.max(0, subtotal - state.discount);
  return { subtotal, total };
}

function updateUI() {
  const { subtotal, total } = calcTotals();

  subtotalEl.textContent = formatBRL(subtotal);
  totalEl.textContent = formatBRL(total);
  btnTotal.textContent = formatBRL(total);
  pixTotalValue.textContent = formatBRL(total);
  stickyTotal.textContent = formatBRL(total);

  if (state.discount > 0) {
    discountRow.style.display = 'flex';
    discountValue.textContent = '- ' + formatBRL(state.discount);
  } else {
    discountRow.style.display = 'none';
  }

  bump.classList.toggle('selected', state.items.includes('checklist'));
}

// ============================================================
// MÁSCARAS + VALIDAÇÃO
// ============================================================
const phone = document.getElementById('phone');
phone.addEventListener('input', (e) => {
  let v = e.target.value.replace(/\D/g, '').slice(0, 11);
  if (v.length > 6) v = `(${v.slice(0,2)}) ${v.slice(2,7)}-${v.slice(7)}`;
  else if (v.length > 2) v = `(${v.slice(0,2)}) ${v.slice(2)}`;
  else if (v.length > 0) v = `(${v}`;
  e.target.value = v;
  validateField('phone');
});

const cpf = document.getElementById('document');
cpf.addEventListener('input', (e) => {
  let v = e.target.value.replace(/\D/g, '').slice(0, 11);
  if (v.length > 9) v = `${v.slice(0,3)}.${v.slice(3,6)}.${v.slice(6,9)}-${v.slice(9)}`;
  else if (v.length > 6) v = `${v.slice(0,3)}.${v.slice(3,6)}.${v.slice(6)}`;
  else if (v.length > 3) v = `${v.slice(0,3)}.${v.slice(3)}`;
  e.target.value = v;
  validateField('document');
});

const nameInput = document.getElementById('name');
nameInput.addEventListener('blur', () => validateField('name'));

const emailInput = document.getElementById('email');
emailInput.addEventListener('blur', () => validateField('email'));

function validateField(field) {
  const fieldEl = document.getElementById('field-' + field);
  if (!fieldEl) return true;

  let value = '';
  let valid = false;

  if (field === 'name') {
    value = nameInput.value.trim();
    valid = value.length >= 3 && value.includes(' ');
  } else if (field === 'email') {
    value = emailInput.value.trim();
    valid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
  } else if (field === 'phone') {
    value = phone.value.replace(/\D/g, '');
    valid = value.length >= 10;
  } else if (field === 'document') {
    value = cpf.value.replace(/\D/g, '');
    valid = value.length === 11 && isValidCPF(value);
  }

  fieldEl.classList.toggle('valid', valid);
  fieldEl.classList.toggle('invalid', !valid && value.length > 0);
  return valid;
}

function isValidCPF(cpf) {
  cpf = String(cpf).replace(/\D/g, '');
  if (cpf.length !== 11) return false;
  if (/^(\d)\1{10}$/.test(cpf)) return false;
  let add = 0;
  for (let i = 0; i < 9; i++) add += parseInt(cpf[i]) * (10 - i);
  let rev = 11 - (add % 11);
  if (rev >= 10) rev = 0;
  if (rev !== parseInt(cpf[9])) return false;
  add = 0;
  for (let i = 0; i < 10; i++) add += parseInt(cpf[i]) * (11 - i);
  rev = 11 - (add % 11);
  if (rev >= 10) rev = 0;
  return rev === parseInt(cpf[10]);
}

// ============================================================
// BUMP
// ============================================================
bump.addEventListener('click', () => {
  if (state.items.includes('checklist')) {
    state.items = state.items.filter(i => i !== 'checklist');
  } else {
    state.items.push('checklist');
  }
  updateUI();
});

// ============================================================
// CUPOM
// ============================================================
const couponToggle = document.getElementById('coupon-toggle');
const couponBox = document.getElementById('coupon-box');
const couponInput = document.getElementById('coupon-input');
const couponApply = document.getElementById('coupon-apply');
const couponMsg = document.getElementById('coupon-msg');

couponToggle.addEventListener('click', () => {
  couponBox.classList.toggle('show');
  if (couponBox.classList.contains('show')) couponInput.focus();
});

couponApply.addEventListener('click', () => {
  const code = couponInput.value.trim().toUpperCase();
  if (!code) return;

  const coupon = COUPONS[code];
  if (!coupon) {
    couponMsg.textContent = 'Cupom inválido.';
    couponMsg.className = 'coupon-msg show err';
    state.coupon = null;
    state.discount = 0;
    updateUI();
    return;
  }

  const { subtotal } = calcTotals();
  let discount = 0;
  if (coupon.type === 'percent') {
    discount = subtotal * (coupon.value / 100);
  } else if (coupon.type === 'fixed') {
    discount = Math.min(coupon.value, subtotal);
  }

  state.coupon = code;
  state.discount = Number(discount.toFixed(2));

  couponMsg.textContent = `Cupom "${code}" aplicado.`;
  couponMsg.className = 'coupon-msg show ok';
  updateUI();
});

couponInput.addEventListener('keypress', (e) => {
  if (e.key === 'Enter') { e.preventDefault(); couponApply.click(); }
});

// ============================================================
// SUBMIT
// ============================================================
form.addEventListener('submit', async (e) => {
  e.preventDefault();

  const fields = ['name', 'email', 'phone', 'document'];
  const allValid = fields.every(f => validateField(f));

  if (!allValid) {
    const firstInvalid = document.querySelector('.field.invalid input');
    if (firstInvalid) {
      firstInvalid.focus();
      firstInvalid.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
    return;
  }

  const { total } = calcTotals();
  const payload = {
    name: nameInput.value.trim(),
    email: emailInput.value.trim(),
    phone: phone.value.trim(),
    document: cpf.value.trim(),
    amount: total,
    items: state.items.map(id => ({
      id, name: PRODUCTS[id].name, price: PRODUCTS[id].price
    })),
    coupon: state.coupon,
    discount: state.discount
  };

  submitBtn.disabled = true;
  submitBtn.classList.add('loading');
  submitBtn.innerHTML = '<span class="spinner"></span> Gerando PIX...';

  try {
    const res = await fetch('/api/create-pix', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await res.json();

    if (!data.success) {
      alert(data.message || 'Erro ao gerar PIX.');
      submitBtn.disabled = false;
      submitBtn.classList.remove('loading');
      submitBtn.innerHTML = `GERAR PIX DE <span id="btn-total">${formatBRL(total)}</span>`;
      return;
    }

    transactionId = data.data.transactionId;
    const { copyPaste, qrCodeBase64 } = data.data.paymentData;

    if (qrCodeBase64) {
      qrImg.src = qrCodeBase64.startsWith('data:') ? qrCodeBase64 : `data:image/png;base64,${qrCodeBase64}`;
    } else {
      qrImg.src = `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(copyPaste)}`;
    }

    copyCode.textContent = copyPaste;
    pixTotalValue.textContent = formatBRL(total);

    formStep.style.display = 'none';
    pixStep.classList.add('show');

    // Atualiza progresso
    progressFill.classList.add('active');
    step1.classList.remove('active');
    step2.classList.add('active');

    window.scrollTo({ top: 0, behavior: 'smooth' });
    startPolling();
  } catch (err) {
    console.error(err);
    alert('Erro de conexão. Tente novamente.');
    submitBtn.disabled = false;
    submitBtn.classList.remove('loading');
    submitBtn.innerHTML = `GERAR PIX DE ${formatBRL(total)}`;
  }
});

// Sticky button (mobile) — scrolla pro form
stickyBtn.addEventListener('click', () => {
  document.getElementById('name').focus();
  document.getElementById('pix-form').scrollIntoView({ behavior: 'smooth', block: 'center' });
});

// ============================================================
// COPIAR
// ============================================================
copyBtn.addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(copyCode.textContent);
    copyBtn.classList.add('copied');
    copyBtn.innerHTML = `
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
      Código copiado
    `;
    setTimeout(() => {
      copyBtn.classList.remove('copied');
      copyBtn.innerHTML = `
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
        Copiar código PIX
      `;
    }, 2500);
  } catch {
    const range = document.createRange();
    range.selectNode(copyCode);
    window.getSelection().removeAllRanges();
    window.getSelection().addRange(range);
    document.execCommand('copy');
  }
});

// ============================================================
// POLLING
// ============================================================
function startPolling() {
  pollStart = Date.now();
  pollTimer = setInterval(checkStatus, POLL_INTERVAL);
}

async function checkStatus() {
  if (Date.now() - pollStart > POLL_TIMEOUT) {
    clearInterval(pollTimer);
    statusBox.className = 'status';
    statusBox.style.background = '#FEF2F2';
    statusBox.style.color = '#991B1B';
    statusBox.style.border = '1px solid #FECACA';
    statusBox.textContent = 'Sessão expirada. Recarregue a página para tentar novamente.';
    return;
  }

  try {
    const res = await fetch(`/api/pix-status?transactionId=${transactionId}`);
    const data = await res.json();

    if (data.success && data.data.status === 'PAID') {
      clearInterval(pollTimer);
      statusBox.className = 'status';
      statusBox.style.background = '#F0FDF4';
      statusBox.style.color = '#166534';
      statusBox.style.border = '1px solid #BBF7D0';
      statusBox.textContent = 'Pagamento confirmado. Redirecionando...';

      // Atualiza progresso pra etapa 3
      step2.classList.remove('active');
      document.getElementById('step-3').classList.add('active');
      progressFill.style.width = '100%';

      setTimeout(() => {
        window.location.href = `/sucesso?tx=${transactionId}`;
      }, 1500);
    }
  } catch (err) {
    console.warn('Polling falhou, tentando de novo...', err);
  }
}

// ============================================================
// INIT
// ============================================================
updateUI();
