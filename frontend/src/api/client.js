const BASE = import.meta.env.VITE_API_URL ? `${import.meta.env.VITE_API_URL}/api` : '/api';

async function request(path, { method = 'GET', body, token } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;

  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error || 'Algo salió mal');
  }
  return data;
}

export const api = {
  // Auth
  register: (payload) => request('/auth/register', { method: 'POST', body: payload }),
  login: (payload) => request('/auth/login', { method: 'POST', body: payload }),
  me: (token) => request('/auth/me', { token }),

  // Ligas públicas
  getLeagues: () => request('/leagues'),
  getLeague: (slug) => request(`/leagues/${slug}`),
  getMatches: (categoryId) => request(`/leagues/categories/${categoryId}/matches`),

  // Crear / editar liga
  createLeague: (payload, token) => request('/leagues', { method: 'POST', body: payload, token }),
  updateLeague: (id, payload, token) => request(`/leagues/${id}`, { method: 'PUT', body: payload, token }),

  // Categorías
  createCategory: (leagueId, payload, token) =>
    request(`/leagues/${leagueId}/categories`, { method: 'POST', body: payload, token }),
  updateCategory: (categoryId, payload, token) =>
    request(`/manage/categories/${categoryId}`, { method: 'PUT', body: payload, token }),
  deleteCategory: (categoryId, token) =>
    request(`/manage/categories/${categoryId}`, { method: 'DELETE', token }),

  // Partidos
  createMatch: (categoryId, payload, token) =>
    request(`/manage/categories/${categoryId}/matches`, { method: 'POST', body: payload, token }),
  updateMatch: (matchId, payload, token) =>
    request(`/manage/matches/${matchId}`, { method: 'PUT', body: payload, token }),
  deleteMatch: (matchId, token) =>
    request(`/manage/matches/${matchId}`, { method: 'DELETE', token }),

  // Importación masiva desde Excel
  importMatches: async (categoryId, file, token) => {
    const formData = new FormData();
    formData.append('file', file);
    const res = await fetch(`${BASE}/manage/categories/${categoryId}/matches/import`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: formData,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'No se pudo importar el archivo');
    return data;
  },

  // Subida de imágenes
  uploadImage: async (file, token) => {
    const formData = new FormData();
    formData.append('file', file);
    const res = await fetch(`${BASE}/upload`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: formData,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'No se pudo subir la imagen');
    return data;
  },

  // Equipos
  getTeams: (slug) => request(`/leagues/${slug}/teams`),
  createTeam: (leagueId, payload, token) =>
    request(`/manage/leagues/${leagueId}/teams`, { method: 'POST', body: payload, token }),
  updateTeam: (teamId, payload, token) =>
    request(`/manage/teams/${teamId}`, { method: 'PUT', body: payload, token }),
  deleteTeam: (teamId, token) =>
    request(`/manage/teams/${teamId}`, { method: 'DELETE', token }),

  // Panel de administración de liga
  getManageLeague: (leagueId, token) =>
    request(`/manage/leagues/${leagueId}/manage`, { token }),

  // Patrocinadores (público — para mostrar en la barra lateral)
  getSponsors: () => request('/admin/sponsors'),

  // Admin — estadísticas
  adminGetStats: (token) => request('/admin/stats', { token }),

  // Admin — patrocinadores
  adminCreateSponsor: (payload, token) =>
    request('/admin/sponsors', { method: 'POST', body: payload, token }),
  adminUpdateSponsor: (id, payload, token) =>
    request(`/admin/sponsors/${id}`, { method: 'PUT', body: payload, token }),
  adminDeleteSponsor: (id, token) =>
    request(`/admin/sponsors/${id}`, { method: 'DELETE', token }),

  // Admin — ligas
  adminGetLeagues: (token) => request('/admin/leagues', { token }),
  adminDeleteLeague: (id, token) =>
    request(`/admin/leagues/${id}`, { method: 'DELETE', token }),

  // Admin — usuarios
  adminGetUsers: (token) => request('/admin/users', { token }),
  adminDeleteUser: (id, token) =>
    request(`/admin/users/${id}`, { method: 'DELETE', token }),
};
