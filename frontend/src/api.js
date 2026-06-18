const BASE = '/api';

async function req(method, path, body, token) {
  const headers = {};
  if (body) headers['Content-Type'] = 'application/json';
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(err.detail || `HTTP ${res.status}`);
  }
  return res.json();
}

export const api = {
  get:   (path, token)        => req('GET',   path, null, token),
  post:  (path, body, token)  => req('POST',  path, body, token),
  put:    (path, body, token)  => req('PUT',    path, body, token),
  patch:  (path, body, token)  => req('PATCH',  path, body, token),
  delete: (path, token)        => req('DELETE', path, null, token),

  // Auth (form-encoded for OAuth2PasswordRequestForm)
  login: (email, password) =>
    fetch(`${BASE}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ username: email, password }),
    }).then(async res => {
      if (!res.ok) { const e = await res.json(); throw new Error(e.detail); }
      return res.json();
    }),
};

export const CONF_COLOR = {
  CONMEBOL: 'var(--conf-conmebol)',
  UEFA:     'var(--conf-uefa)',
  CAF:      'var(--conf-caf)',
  AFC:      'var(--conf-afc)',
  CONCACAF: 'var(--conf-concacaf)',
  OFC:      'var(--conf-ofc)',
};

export const CONF_HEX = {
  CONMEBOL: '#2ec980',
  UEFA:     '#4a90e8',
  CAF:      '#e8a030',
  AFC:      '#e85252',
  CONCACAF: '#9b5de8',
  OFC:      '#17c8c8',
};

export function heatClass(prob) {
  if (prob >= 15) return 'heat-3';
  if (prob >= 8)  return 'heat-2';
  if (prob >= 3)  return 'heat-1';
  return 'heat-0';
}
