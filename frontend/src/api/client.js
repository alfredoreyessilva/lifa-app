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
  // Estadísticas de uso (visitas, clics) — no requiere login. Si falla (ej.
  // sin internet un instante) no debe tronar la pantalla del visitante, así
  // que quien la llama la debe envolver en try/catch y simplemente ignorar
  // el error.
  trackEvent: (eventType) => request('/track', { method: 'POST', body: { event_type: eventType } }),

  // Auth
  register: (payload) => request('/auth/register', { method: 'POST', body: payload }),
  login: (payload) => request('/auth/login', { method: 'POST', body: payload }),
  me: (token) => request('/auth/me', { token }),

  // Ligas públicas
  getLeagues: () => request('/leagues'),
  getLeague: (slug) => request(`/leagues/${slug}`),
  getPublicTeams: () => request('/leagues/all-teams'),
  getMatches: (categoryId) => request(`/leagues/categories/${categoryId}/matches`),
  getTournamentPublic: (tournamentId) => request(`/leagues/tournaments/${tournamentId}/public`),
  getMatch: (matchId) => request(`/leagues/matches/${matchId}`),

  // Crear / editar liga
  createLeague: (payload, token) => request('/leagues', { method: 'POST', body: payload, token }),
  updateLeague: (id, payload, token) => request(`/leagues/${id}`, { method: 'PUT', body: payload, token }),
  requestPublishLeague: (id, token) => request(`/leagues/${id}/request-publish`, { method: 'PUT', token }),
  cancelPublishRequest: (id, token) => request(`/leagues/${id}/cancel-request`, { method: 'PUT', token }),
  unpublishOwnLeague: (id, token) => request(`/leagues/${id}/unpublish`, { method: 'PUT', token }),

  // Categorías
  createCategory: (leagueId, payload, token) =>
    request(`/leagues/${leagueId}/categories`, { method: 'POST', body: payload, token }),
  updateCategory: (categoryId, payload, token) =>
    request(`/manage/categories/${categoryId}`, { method: 'PUT', body: payload, token }),
  deleteCategory: (categoryId, token) =>
    request(`/manage/categories/${categoryId}`, { method: 'DELETE', token }),

  // Torneos
  createTournament: (leagueId, payload, token) =>
    request(`/leagues/${leagueId}/tournaments`, { method: 'POST', body: payload, token }),
  getTournaments: (leagueId, year, token) =>
    request(`/leagues/${leagueId}/tournaments${year ? `?year=${year}` : ''}`, { token }),
  deleteTournament: (tournamentId, token) =>
    request(`/manage/tournaments/${tournamentId}`, { method: 'DELETE', token }),

  // Roster de liga: equipos "de la casa" (tabla league_teams). Elegibles
  // automáticamente en cualquier torneo de esa liga, sin inscripción aparte.
  getLeagueRoster: (leagueId, token) =>
    request(`/leagues/${leagueId}/roster`, { token }),
  addTeamToRoster: (leagueId, teamId, token) =>
    request(`/leagues/${leagueId}/roster`, { method: 'POST', body: { team_id: teamId }, token }),
  removeTeamFromRoster: (leagueId, teamId, token) =>
    request(`/leagues/${leagueId}/roster/${teamId}`, { method: 'DELETE', token }),
  syncRosterMatches: (leagueId, token) =>
    request(`/leagues/${leagueId}/roster/sync-matches`, { method: 'PATCH', token }),

  // Pruebas de la nueva jerarquía (Torneo -> Categoría)
  createCategoryForTournament: (tournamentId, payload, token) =>
    request(`/leagues/tournaments/${tournamentId}/categories`, { method: 'POST', body: payload, token }),
  getCategoriesForTournament: (tournamentId, token) =>
    request(`/leagues/tournaments/${tournamentId}/categories`, { token }),

  // Inscripción: equipos de un torneo (de cualquier liga)
  searchTeams: (q, token) =>
    request(`/manage/teams/search?q=${encodeURIComponent(q)}`, { token }),
  getTournamentTeams: (tournamentId, token) =>
    request(`/leagues/tournaments/${tournamentId}/teams`, { token }),
  inscribeTeam: (tournamentId, teamId, token) =>
    request(`/leagues/tournaments/${tournamentId}/teams`, { method: 'POST', body: { team_id: teamId }, token }),
  removeTeamFromTournament: (tournamentId, teamId, token) =>
    request(`/leagues/tournaments/${tournamentId}/teams/${teamId}`, { method: 'DELETE', token }),

  // Pruebas de la nueva jerarquía (Categoría -> Rama)
  createBranch: (categoryId, payload, token) =>
    request(`/manage/categories/${categoryId}/branches`, { method: 'POST', body: payload, token }),
  getBranches: (categoryId, token) =>
    request(`/manage/categories/${categoryId}/branches`, { token }),

  // Pruebas de la nueva jerarquía (Rama -> Conferencia)
  createConference: (branchId, payload, token) =>
    request(`/manage/branches/${branchId}/conferences`, { method: 'POST', body: payload, token }),
  getConferences: (branchId, token) =>
    request(`/manage/branches/${branchId}/conferences`, { token }),

  // Pruebas de la nueva jerarquía (Conferencia -> Grupo)
  createTestGroup: (conferenceId, payload, token) =>
    request(`/manage/conferences/${conferenceId}/groups-test`, { method: 'POST', body: payload, token }),
  getTestGroups: (conferenceId, token) =>
    request(`/manage/conferences/${conferenceId}/groups-test`, { token }),

  // Grupos colgados directo de una Rama (sin conferencia), y el listado
  // combinado (directos + los de todas sus conferencias) para la pestaña
  // "Grupos" del panel.
  createBranchGroup: (branchId, payload, token) =>
    request(`/manage/branches/${branchId}/groups`, { method: 'POST', body: payload, token }),
  getBranchGroups: (branchId, token) =>
    request(`/manage/branches/${branchId}/groups`, { token }),

  // Pruebas de la nueva jerarquía (Rama -> Partido)
  createTestMatch: (branchId, payload, token) =>
    request(`/manage/branches/${branchId}/matches-test`, { method: 'POST', body: payload, token }),
  getTestMatches: (branchId, token) =>
    request(`/manage/branches/${branchId}/matches-test`, { token }),

  // Partidos reales de una rama (todos los campos)
  getBranchMatches: (branchId, token) =>
    request(`/manage/branches/${branchId}/matches`, { token }),

  // Todos los partidos de un torneo completo (para "Partidos del Torneo")
  getTournamentMatches: (tournamentId, token) =>
    request(`/manage/tournaments/${tournamentId}/matches`, { token }),
  publishAllDrafts: (tournamentId, token) =>
    request(`/manage/tournaments/${tournamentId}/publish-drafts`, { method: 'PATCH', token }),

  // Estado manual del partido (nuevo, aislado del PUT general)
  updateMatchStatus: (matchId, status, token) =>
    request(`/manage/matches/${matchId}/status`, { method: 'PATCH', body: { status }, token }),

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

  // Importación a nivel torneo (cada fila trae su propia Categoría/Rama;
  // todo lo que entra queda como borrador, sin publicarse).
  importTournamentMatches: async (tournamentId, file, token) => {
    const formData = new FormData();
    formData.append('file', file);
    const res = await fetch(`${BASE}/manage/tournaments/${tournamentId}/matches/import`, {
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

  // Sedes
  getVenues: (slug) => request(`/leagues/${slug}/venues`),
  createVenue: (leagueId, payload, token) =>
    request(`/manage/leagues/${leagueId}/venues`, { method: 'POST', body: payload, token }),
  updateVenue: (venueId, payload, token) =>
    request(`/manage/venues/${venueId}`, { method: 'PUT', body: payload, token }),
  deleteVenue: (venueId, token) =>
    request(`/manage/venues/${venueId}`, { method: 'DELETE', token }),

  // Grupos (propios de cada categoría, ej. "Conferencia 14 Grandes")
  createGroup: (categoryId, payload, token) =>
    request(`/manage/categories/${categoryId}/groups`, { method: 'POST', body: payload, token }),
  updateGroup: (groupId, payload, token) =>
    request(`/manage/groups/${groupId}`, { method: 'PUT', body: payload, token }),
  deleteGroup: (groupId, token) =>
    request(`/manage/groups/${groupId}`, { method: 'DELETE', token }),

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
  adminPublishLeague: (id, token) =>
    request(`/admin/leagues/${id}/publish`, { method: 'PUT', token }),
  adminUnpublishLeague: (id, token) =>
    request(`/admin/leagues/${id}/unpublish`, { method: 'PUT', token }),
  adminVerifyLeague: (id, token) =>
    request(`/admin/leagues/${id}/verify`, { method: 'PUT', token }),
  adminUnverifyLeague: (id, token) =>
    request(`/admin/leagues/${id}/unverify`, { method: 'PUT', token }),
  adminDeleteLeague: (id, token) =>
    request(`/admin/leagues/${id}`, { method: 'DELETE', token }),

  // Admin — usuarios
  adminGetUsers: (token) => request('/admin/users', { token }),
  adminDeleteUser: (id, token) =>
    request(`/admin/users/${id}`, { method: 'DELETE', token }),

  // Invitaciones (entregar el perfil de un equipo a su representante)
  createTeamInvite: (teamId, token) =>
    request(`/invites/teams/${teamId}`, { method: 'POST', token }),
  removeTeamOwner: (teamId, token) =>
    request(`/invites/teams/${teamId}/owner`, { method: 'DELETE', token }),
  getInvite: (inviteToken) => request(`/invites/${inviteToken}`),
  claimInvite: (inviteToken, token) =>
    request(`/invites/${inviteToken}/claim`, { method: 'POST', token }),
};
