// ── SelamatLah Auth Client ────────────────────────────────────────────────────

// ── Utilities ─────────────────────────────────────────────────────────────────
function setError(id, msg) {
  const el = document.getElementById(id);
  if (el) el.textContent = msg;
}
function clearError(id) { setError(id, ''); }

function setLoading(btn, loading) {
  if (loading) {
    btn.disabled = true;
    btn.dataset.origText = btn.textContent;
    btn.innerHTML = '<span class="spinner"></span> Tunggu...';
  } else {
    btn.disabled = false;
    btn.textContent = btn.dataset.origText || btn.textContent;
  }
}

function togglePw(inputId, btn) {
  const input = document.getElementById(inputId);
  if (!input) return;
  const show = input.type === 'password';
  input.type = show ? 'text' : 'password';
  btn.textContent = show ? '🙈' : '👁';
}

function copyCode() {
  const code = document.getElementById('guardianCodeDigits').textContent.replace(/\s/g, '');
  navigator.clipboard.writeText(code).then(() => {
    const btn = event.target;
    const orig = btn.textContent;
    btn.textContent = '✅ Tersalin!';
    setTimeout(() => { btn.textContent = orig; }, 2000);
  });
}

function goToLogin() { switchTab('login'); }

// ── Tab switching ─────────────────────────────────────────────────────────────
function switchTab(which) {
  document.querySelectorAll('.tab').forEach(t => {
    t.classList.toggle('active', t.id === 'tab-' + which);
    t.setAttribute('aria-selected', t.id === 'tab-' + which);
  });
  document.getElementById('panel-login').classList.toggle('hidden', which !== 'login');
  document.getElementById('panel-register').classList.toggle('hidden', which !== 'register');
}

function switchRole(which) {
  document.querySelectorAll('.role-tab').forEach(t => {
    t.classList.toggle('active', t.id === 'rtab-' + which);
    t.setAttribute('aria-selected', t.id === 'rtab-' + which);
  });
  document.getElementById('rp-guardian').classList.toggle('hidden', which !== 'guardian');
  document.getElementById('rp-elderly').classList.toggle('hidden', which !== 'elderly');
}

// ── Login ─────────────────────────────────────────────────────────────────────
document.getElementById('loginForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  clearError('loginError');
  const btn      = document.getElementById('loginBtn');
  const username = document.getElementById('loginUsername').value.trim();
  const password = document.getElementById('loginPassword').value;

  if (!username || !password) {
    setError('loginError', 'Sila isi semua medan.');
    return;
  }

  setLoading(btn, true);
  try {
    const res  = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });
    const data = await res.json();

    if (!res.ok) {
      setError('loginError', data.error || 'Log masuk gagal.');
      return;
    }

    // Save guardian code in sessionStorage for the chat header
    sessionStorage.setItem('sl_username', data.username);
    sessionStorage.setItem('sl_role',     data.role);
    if (data.guardianCode) sessionStorage.setItem('sl_guardianCode', data.guardianCode);

    window.location.href = '/';
  } catch (err) {
    setError('loginError', 'Ralat rangkaian. Cuba lagi.');
    console.error(err);
  } finally {
    setLoading(btn, false);
  }
});

// ── Guardian Register ─────────────────────────────────────────────────────────
document.getElementById('guardianForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  clearError('guardianError');
  const btn      = document.getElementById('guardianBtn');
  const username = document.getElementById('gUsername').value.trim();
  const phone    = document.getElementById('gPhone').value.trim();
  const password = document.getElementById('gPassword').value;

  if (!username || !password) {
    setError('guardianError', 'Nama pengguna dan kata laluan diperlukan.');
    return;
  }
  if (password.length < 8) {
    setError('guardianError', 'Kata laluan mesti sekurang-kurangnya 8 aksara.');
    return;
  }

  setLoading(btn, true);
  try {
    const res  = await fetch('/api/auth/register/guardian', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password, phone: phone || undefined }),
    });
    const data = await res.json();

    if (!res.ok) {
      setError('guardianError', data.error || 'Pendaftaran gagal.');
      return;
    }

    // Show the guardian code
    document.getElementById('guardianForm').style.display = 'none';
    const revealEl = document.getElementById('guardianCodeReveal');
    revealEl.classList.remove('hidden');
    // Display digits with spaces for readability
    document.getElementById('guardianCodeDigits').textContent = data.guardianCode.split('').join(' ');
  } catch (err) {
    setError('guardianError', 'Ralat rangkaian. Cuba lagi.');
    console.error(err);
  } finally {
    setLoading(btn, false);
  }
});

// ── Elderly Register ──────────────────────────────────────────────────────────
document.getElementById('elderlyForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  clearError('elderlyError');
  const btn         = document.getElementById('elderlyBtn');
  const username    = document.getElementById('eUsername').value.trim();
  const phone       = document.getElementById('ePhone').value.trim();
  const password    = document.getElementById('ePassword').value;
  const guardianCode = document.getElementById('eGuardianCode').value.trim();

  if (!username || !password || !guardianCode) {
    setError('elderlyError', 'Sila isi semua medan yang diperlukan.');
    return;
  }
  if (password.length < 8) {
    setError('elderlyError', 'Kata laluan mesti sekurang-kurangnya 8 aksara.');
    return;
  }
  if (!/^\d{6}$/.test(guardianCode)) {
    setError('elderlyError', 'Kod penjaga mesti 6 digit nombor.');
    return;
  }

  setLoading(btn, true);
  try {
    const res  = await fetch('/api/auth/register/elderly', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password, phone: phone || undefined, guardianCode }),
    });
    const data = await res.json();

    if (!res.ok) {
      setError('elderlyError', data.error || 'Pendaftaran gagal.');
      return;
    }

    // Success — redirect to login with a success note
    setError('elderlyError', '');
    alert('✅ Akaun berjaya dibuat! Sila log masuk.');
    switchTab('login');
    document.getElementById('loginUsername').value = username;
    document.getElementById('loginPassword').focus();
  } catch (err) {
    setError('elderlyError', 'Ralat rangkaian. Cuba lagi.');
    console.error(err);
  } finally {
    setLoading(btn, false);
  }
});

// ── Only allow digits in guardian code field ──────────────────────────────────
document.getElementById('eGuardianCode').addEventListener('input', (e) => {
  e.target.value = e.target.value.replace(/\D/g, '').slice(0, 6);
});
