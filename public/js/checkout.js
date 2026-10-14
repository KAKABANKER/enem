const PRICE = 3.49;
const POLL_INTERVAL = 3000; // 3s
const POLL_TIMEOUT = 15 * 60 * 1000; // 15min

const form = document.getElementById('pix-form');
const formStep = document.getElementById('form-step');
const pixStep = document.getElementById('pix-step');
const submitBtn = document.getElementById('submit-btn');
const qrImg = document.getElementById('qr-img');
const copyCode = document.getElementById('copy-code');
const copyBtn = document.getElementById('copy-btn');
const statusBox = document.getElementById('status-box');

let transactionId = null;
let pollTimer = null;
let pollStart = null;

// ---------- MÁSCARAS ----------
const phone = document.getElementById('phone');
phone.addEventListener('input', (e) => {
  let v = e.target.value.replace(/\D/g, '').slice(0, 11);
  if (v.length > 6) v = `(${v.slice(0,2)}) ${v.slice(2,7)}-${v.slice(7)}`;
  else if (v.length > 2) v = `(${v.slice(0,2)}) ${v.slice(2)}`;
  else if (v.length > 0) v = `(${v}`;
  e.target.value = v;
});

const cpf = document.getElementById('document');
cpf.addEventListener('input', (e) => {
  let v = e.target.value.replace(/\D/g, '').slice(0, 11);
  if (v.length > 9) v = `${v.slice(0,3)}.${v.slice(3,6)}.${v.slice(6,9)}-${v.slice(9)}`;
  else if (v.length > 6) v = `${v.slice(0,3)}.${v.slice(3,6)}.${v.slice(6)}`;
  else if (v.length > 3) v = `${v.slice(0,3)}.${v.slice(3)}`;
  e.target.value = v;
});

// ---------- SUBMIT ----------
form.addEventListener('submit', async (e) => {
  e.preventDefault();

  const payload = {
    name: document.getElementById('name').value.trim(),
    email: document.getElementById('email').value.trim(),
    phone: phone.value.trim(),
    document: cpf.value.trim(),
    amount: PRICE
  };

  if (!payload.name || !payload.email || !payload.phone || !payload.document) {
    alert('Preencha todos os campos.');
    return;
  }

  submitBtn.disabled = true;
  submitBtn.innerHTML = 'Gerando PIX...';

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
      submitBtn.innerHTML = 'GERAR PIX DE R$ 3,49';
      return;
    }

    transactionId = data.data.transactionId;
    const { copyPaste, qrCodeBase64 } = data.data.paymentData;

    // QR: se base64 vier, usa; senão, gera via API pública
    if (qrCodeBase64) {
      qrImg.src = qrCodeBase64.startsWith('data:')
        ? qrCodeBase64
        : `data:image/png;base64,${qrCodeBase64}`;
    } else {
      qrImg.src = `https://api.qrserver.com/v1/create-qr-code/?size=220x220&data=${encodeURIComponent(copyPaste)}`;
    }

    copyCode.textContent = copyPaste;

    formStep.style.display = 'none';
    pixStep.classList.add('show');

    startPolling();
  } catch (err) {
    console.error(err);
    alert('Erro de conexão. Tente novamente.');
    submitBtn.disabled = false;
    submitBtn.innerHTML = 'GERAR PIX DE R$ 3,49';
  }
});

// ---------- COPIAR ----------
copyBtn.addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(copyCode.textContent);
    copyBtn.classList.add('copied');
    copyBtn.innerHTML = `
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
      CÓDIGO COPIADO
    `;
    setTimeout(() => {
      copyBtn.classList.remove('copied');
      copyBtn.innerHTML = `
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
        COPIAR CÓDIGO PIX
      `;
    }, 2500);
  } catch {
    // Fallback
    const range = document.createRange();
    range.selectNode(copyCode);
    window.getSelection().removeAllRanges();
    window.getSelection().addRange(range);
    document.execCommand('copy');
  }
});

// ---------- POLLING ----------
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
      setTimeout(() => {
        window.location.href = `/sucesso?tx=${transactionId}`;
      }, 1500);
    }
  } catch (err) {
    console.warn('Polling falhou, tentando de novo...', err);
  }
}