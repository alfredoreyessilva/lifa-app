const BASE = import.meta.env.VITE_API_URL ? `${import.meta.env.VITE_API_URL}/api` : '/api';

// Id anónimo por navegador (no por persona) para poder contar "visitantes
// únicos" en las estadísticas, sin cuentas ni cookies de terceros — solo un
// valor al azar que este mismo navegador se vuelve a mandar en cada evento.
// Si localStorage falla (modo privado, storage bloqueado) simplemente no se
// manda: el evento se sigue registrando, solo no cuenta para "únicos".
function getVisitorId() {
  try {
    const KEY = 'lifa_visitor_id';
    let id = localStorage.getItem(KEY);
    if (!id) {
      id = crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
      localStorage.setItem(KEY, id);
    }
    return id;
  } catch {
    return null;
  }
}

// `keepalive` es para las peticiones que tienen que sobrevivir a que el
// navegador cambie de pestaña o de app en el mismo instante — hoy, la que
// registra el recordatorio de WhatsApp. Sin él, el navegador puede cancelar
// la petición a medias y el recordatorio se pierde. Trae un límite de 64 KB
// de cuerpo, de sobra para lo que lo usamos.
async function request(path, { method = 'GET', body, token, keepalive = false } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;

  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
    keepalive,
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
  trackEvent: (eventType, sponsorId) => {
    const body = { event_type: eventType };
    if (sponsorId) body.sponsor_id = sponsorId;
    const visitorId = getVisitorId();
    if (visitorId) body.visitor_id = visitorId;
    return request('/track', { method: 'POST', body });
  },

  // Juego de predicciones ("¿quién gana?")
  submitPrediction: (matchId, pick, token) =>
    request('/predictions', { method: 'POST', body: { match_id: matchId, pick }, token }),
  getPredictionsSummary: (matchIds, token) =>
    request(`/predictions/summary?matchIds=${matchIds.join(',')}`, { token }),
  getMyPredictionStats: (token) => request('/predictions/my-stats', { token }),
  getCalendarRanking: (matchIds) => request(`/predictions/ranking?matchIds=${matchIds.join(',')}`),

  // Quinielas privadas
  createPool: (name, token) => request('/pools', { method: 'POST', body: { name }, token }),
  getMyPools: (token) => request('/pools/mine', { token }),
  getPoolInfo: (code) => request(`/pools/${code}`),
  joinPool: (code, token) => request(`/pools/${code}/join`, { method: 'POST', token }),
  getPoolRanking: (code, matchIds, token) =>
    request(`/pools/${code}/ranking?matchIds=${matchIds.join(',')}`, { token }),

  // Mi cartelera
  getBoard: (token) => request('/board', { token }),

  // Auth
  register: (payload) => request('/auth/register', { method: 'POST', body: payload }),
  login: (payload) => request('/auth/login', { method: 'POST', body: payload }),
  me: (token) => request('/auth/me', { token }),
  verifyEmail: (code, token) => request('/auth/verify-email', { method: 'POST', body: { code }, token }),
  resendVerificationCode: (token) => request('/auth/resend-code', { method: 'POST', token }),
  googleAuth: (credential) => request('/auth/google', { method: 'POST', body: { credential } }),

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
  updateTournament: (tournamentId, payload, token) =>
    request(`/manage/tournaments/${tournamentId}`, { method: 'PUT', body: payload, token }),
  deleteTournament: (tournamentId, token) =>
    request(`/manage/tournaments/${tournamentId}`, { method: 'DELETE', token }),

  // Árbol completo de una liga (Torneo -> Categoría -> Rama -> Conferencia
  // -> Grupo) para la pantalla "Estructura".
  getLeagueTree: (leagueId, token) =>
    request(`/leagues/${leagueId}/tree`, { token }),

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
  updateBranch: (branchId, payload, token) =>
    request(`/manage/branches/${branchId}`, { method: 'PUT', body: payload, token }),
  deleteBranch: (branchId, token) =>
    request(`/manage/branches/${branchId}`, { method: 'DELETE', token }),

  // Equipos inscritos en una rama (corrección: antes se detectaba por
  // tener partidos ahí, ahora es explícito)
  getBranchTeams: (branchId, token) =>
    request(`/manage/branches/${branchId}/teams`, { token }),
  // scope = { conference_id, group_id } — opcional. Es donde se dice UNA vez a
  // qué conferencia pertenece el equipo; de ahí lo deducen todos sus partidos.
  enrollTeamInBranch: (branchId, teamId, token, scope = {}) =>
    request(`/manage/branches/${branchId}/teams`, {
      method: 'POST',
      body: { team_id: teamId, conference_id: scope.conference_id || null, group_id: scope.group_id || null },
      token,
    }),
  updateBranchTeamScope: (branchId, teamId, scope, token) =>
    request(`/manage/branches/${branchId}/teams/${teamId}`, {
      method: 'PUT',
      body: { conference_id: scope.conference_id || null, group_id: scope.group_id || null },
      token,
    }),
  removeTeamFromBranch: (branchId, teamId, token) =>
    request(`/manage/branches/${branchId}/teams/${teamId}`, { method: 'DELETE', token }),

  // Tabla de posiciones y modelo de competencia.
  //
  // La tabla pública NO viene dentro del payload del torneo: se pide aparte,
  // cuando alguien abre esa pestaña. Calcularla en cada carga del calendario
  // le costaría a todos los visitantes un trabajo que casi ninguno pidió.
  getBranchStandings: (branchId) => request(`/leagues/branches/${branchId}/standings`),
  getBranchStandingsAdmin: (branchId, token) =>
    request(`/manage/branches/${branchId}/standings`, { token }),

  // Catálogo de criterios de desempate, reglamentos preconfigurados y tipos
  // de fase. Sale del código del backend para que el panel no tenga que
  // repetir la lista: un criterio nuevo aparece solo, sin tocar el frontend.
  getStandingsCatalog: (token) => request('/manage/standings-catalog', { token }),
  updateStandingsConfig: (branchId, payload, token) =>
    request(`/manage/branches/${branchId}/standings-config`, { method: 'PUT', body: payload, token }),

  // Fases del calendario (temporada regular, playoffs, amistosos…)
  getPhases: (branchId, token) => request(`/manage/branches/${branchId}/phases`, { token }),
  createPhase: (branchId, payload, token) =>
    request(`/manage/branches/${branchId}/phases`, { method: 'POST', body: payload, token }),
  updatePhase: (phaseId, payload, token) =>
    request(`/manage/phases/${phaseId}`, { method: 'PUT', body: payload, token }),
  deletePhase: (phaseId, token) =>
    request(`/manage/phases/${phaseId}`, { method: 'DELETE', token }),
  // Clasificación: de esta fase pasan los primeros N de cada grupo/conferencia.
  setPhaseQualification: (phaseId, payload, token) =>
    request(`/manage/phases/${phaseId}/qualification`, { method: 'PUT', body: payload, token }),
  clearPhaseQualification: (phaseId, token) =>
    request(`/manage/phases/${phaseId}/qualification`, { method: 'DELETE', token }),

  // Títulos: a qué nivel se corona campeón esta rama
  getTitles: (branchId, token) => request(`/manage/branches/${branchId}/titles`, { token }),
  createTitle: (branchId, payload, token) =>
    request(`/manage/branches/${branchId}/titles`, { method: 'POST', body: payload, token }),
  updateTitle: (titleId, payload, token) =>
    request(`/manage/titles/${titleId}`, { method: 'PUT', body: payload, token }),
  deleteTitle: (titleId, token) =>
    request(`/manage/titles/${titleId}`, { method: 'DELETE', token }),
  // Campeón puesto a mano — la excepción, no la regla: normalmente se deriva.
  setTitleWinner: (titleId, payload, token) =>
    request(`/manage/titles/${titleId}/winner`, { method: 'PUT', body: payload, token }),
  clearTitleWinner: (titleId, scopeId, token) =>
    request(`/manage/titles/${titleId}/winner${scopeId ? `?scope_id=${scopeId}` : ''}`, { method: 'DELETE', token }),

  // Roster de un equipo DENTRO DE UNA RAMA (reemplaza el roster genérico
  // de equipo, corrección roster-por-rama)
  getBranchTeamRoster: (branchId, teamId, token) =>
    request(`/players/branches/${branchId}/teams/${teamId}/roster`, { token }),
  addPlayerToBranchRoster: (branchId, teamId, payload, token) =>
    request(`/players/branches/${branchId}/teams/${teamId}/roster`, { method: 'POST', body: payload, token }),
  movePlayerToBranchTeam: (branchId, teamId, playerId, payload, token) =>
    request(`/players/branches/${branchId}/teams/${teamId}/roster/${playerId}/move`, { method: 'POST', body: payload, token }),
  // Quita a un jugador del roster de esta rama. Por default lo da de baja
  // (cierra la membresía y el paso por el equipo queda en su historial); con
  // `hard` borra la membresía sin dejar rastro, para el alta mal capturada.
  removePlayerFromBranchRoster: (branchId, teamId, playerId, { hard = false } = {}, token) =>
    request(
      `/players/branches/${branchId}/teams/${teamId}/roster/${playerId}${hard ? '?hard=true' : ''}`,
      { method: 'DELETE', token },
    ),

  // Roster por plantilla de Excel: descarga la plantilla ya personalizada
  // (membrete de liga + equipo + torneo/categoría/rama) y sube la plantilla
  // llena. La subida solo agrega los jugadores que no estén ya en la rama.
  downloadBranchRosterTemplate: async (branchId, teamId, token) => {
    const res = await fetch(`${BASE}/players/branches/${branchId}/teams/${teamId}/roster/template`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error || 'No se pudo generar la plantilla');
    }
    const blob = await res.blob();
    const match = /filename="(.+?)"/.exec(res.headers.get('Content-Disposition') || '');
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = match ? match[1] : 'roster.xlsx';
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  },
  importBranchRoster: async (branchId, teamId, file, token) => {
    const formData = new FormData();
    formData.append('file', file);
    const res = await fetch(`${BASE}/players/branches/${branchId}/teams/${teamId}/roster/import`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: formData,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'No se pudo importar el archivo');
    return data;
  },
  updateBranchRosterPlayer: (branchId, teamId, playerId, payload, token) =>
    request(`/players/branches/${branchId}/teams/${teamId}/roster/${playerId}`, { method: 'PATCH', body: payload, token }),

  // Organizaciones nuevas (medio, proveedor, tienda, clínica, marca)
  getOrganizationTypes: () => request('/organizations/types'),
  getCountries: () => request('/organizations/countries'),
  createOrganization: (payload, token) =>
    request('/organizations', { method: 'POST', body: payload, token }),
  getOrganization: (id) => request(`/organizations/${id}`),
  getPublicOrganizations: (type) => request(`/organizations${type ? `?type=${type}` : ''}`),
  updateOrganization: (id, payload, token) =>
    request(`/organizations/${id}`, { method: 'PUT', body: payload, token }),

  // Inventario de tienda (products)
  getPublicProducts: (organizationId) =>
    request(`/products/organization/${organizationId}`),
  getManagedProducts: (organizationId, token) =>
    request(`/products/organization/${organizationId}/manage`, { token }),
  createProduct: (organizationId, payload, token) =>
    request(`/products/organization/${organizationId}`, { method: 'POST', body: payload, token }),
  updateProduct: (id, payload, token) =>
    request(`/products/${id}`, { method: 'PUT', body: payload, token }),
  deleteProduct: (id, token) =>
    request(`/products/${id}`, { method: 'DELETE', token }),

  // Pruebas de la nueva jerarquía (Rama -> Conferencia)
  createConference: (branchId, payload, token) =>
    request(`/manage/branches/${branchId}/conferences`, { method: 'POST', body: payload, token }),
  getConferences: (branchId, token) =>
    request(`/manage/branches/${branchId}/conferences`, { token }),
  updateConference: (conferenceId, payload, token) =>
    request(`/manage/conferences/${conferenceId}`, { method: 'PUT', body: payload, token }),
  deleteConference: (conferenceId, token) =>
    request(`/manage/conferences/${conferenceId}`, { method: 'DELETE', token }),

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

  // Importación masiva desde Excel. Si se pasa branchId, los partidos entran
  // directo a esa rama (modelo nuevo); si no, quedan solo a nivel categoría.
  importMatches: async (categoryId, file, token, branchId) => {
    const formData = new FormData();
    formData.append('file', file);
    if (branchId) formData.append('branch_id', branchId);
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
  // Equipo independiente: sin liga, se registra directo desde /registrar-equipo.
  createIndependentTeam: (payload, token) =>
    request('/manage/teams', { method: 'POST', body: payload, token }),
  updateTeam: (teamId, payload, token) =>
    request(`/manage/teams/${teamId}`, { method: 'PUT', body: payload, token }),
  deleteTeam: (teamId, token) =>
    request(`/manage/teams/${teamId}`, { method: 'DELETE', token }),

  // Jugadores / roster. El roster vive SIEMPRE a nivel rama, así que aquí solo
  // hay funciones con branchId; las tres que pegaban a /players/teams/:id/roster
  // y /move-to-team se borraron junto con sus endpoints (ver README).
  getPlayerCard: (playerId) =>
    request(`/players/${playerId}/card`),
  getMatchStats: (matchId, token) =>
    request(`/players/matches/${matchId}/stats`, { token }),
  savePlayerMatchStats: (matchId, playerId, payload, token) =>
    request(`/players/matches/${matchId}/stats/${playerId}`, { method: 'PUT', body: payload, token }),

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

  // Admin — salud del cron externo (¿sigue vivo? ¿cada cuánto corre?)
  adminGetCron: (token) => request('/admin/cron', { token }),

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
  // Rechaza la solicitud de publicación: apaga publish_requested y le manda al
  // dueño el motivo a su bandeja. El motivo es obligatorio del lado del backend.
  adminDeclineLeaguePublish: (id, reason, token) =>
    request(`/admin/leagues/${id}/decline-publish`, { method: 'PUT', body: { reason }, token }),
  adminVerifyLeague: (id, token) =>
    request(`/admin/leagues/${id}/verify`, { method: 'PUT', token }),
  adminUnverifyLeague: (id, token) =>
    request(`/admin/leagues/${id}/unverify`, { method: 'PUT', token }),
  adminDeleteLeague: (id, token) =>
    request(`/admin/leagues/${id}`, { method: 'DELETE', token }),
  adminGetOrganizations: (token) =>
    request('/admin/organizations', { token }),
  adminVerifyOrganization: (id, token) =>
    request(`/admin/organizations/${id}/verify`, { method: 'PUT', token }),
  adminUnverifyOrganization: (id, token) =>
    request(`/admin/organizations/${id}/unverify`, { method: 'PUT', token }),
  adminUpdateOrganizationPlan: (id, payload, token) =>
    request(`/admin/organizations/${id}/plan`, { method: 'PUT', body: payload, token }),

  // Medios transmitiendo partidos (autoasignación)
  getMatchBroadcasts: (matchId) =>
    request(`/broadcasts/match/${matchId}`),
  getOrganizationBroadcasts: (organizationId, token) =>
    request(`/broadcasts/organization/${organizationId}`, { token }),
  createBroadcast: (payload, token) =>
    request('/broadcasts', { method: 'POST', body: payload, token }),
  deleteBroadcast: (id, token) =>
    request(`/broadcasts/${id}`, { method: 'DELETE', token }),

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

  // Invitaciones con rol. `role` decide con qué acceso entra quien reclame el
  // link, y se valida contra el TIPO de organización en el backend. Sin él, el
  // backend entrega 'admin' — que es lo que esta ruta hacía antes de que los
  // roles existieran.
  createOrgAdminInvite: (organizationId, role, token) =>
    request(`/invites/organizations/${organizationId}/admins`, { method: 'POST', body: { role }, token }),
  // Los roles que se pueden repartir en ESTA organización, ya con su etiqueta
  // y ya sabiendo cuáles puede repartir quien pregunta (`grantable`). No se
  // arma en el frontend a propósito: los roles válidos y sus nombres dependen
  // del tipo de organización, y esa tabla vive en el backend (regla 6).
  getOrganizationRoles: (organizationId, token) =>
    request(`/organizations/${organizationId}/roles`, { token }),
  getOrganizationMembers: (organizationId, token) =>
    request(`/organizations/${organizationId}/members`, { token }),
  // Sirve para quitar a alguien más y para retirarse uno mismo: es el mismo
  // endpoint, la diferencia la hace el userId que se le pase.
  removeOrganizationMember: (organizationId, userId, token) =>
    request(`/organizations/${organizationId}/members/${userId}`, { method: 'DELETE', token }),
  transferOrganizationOwner: (organizationId, userId, token) =>
    request(`/organizations/${organizationId}/transfer-owner`, { method: 'POST', body: { userId }, token }),

  // Bandeja de notificaciones (pantalla "Notificaciones")
  getLeagueNotifications: (leagueId, token) => request(`/notifications/league/${leagueId}`, { token }),
  getTeamNotifications: (teamId, token) => request(`/notifications/team/${teamId}`, { token }),
  markLeagueNotificationRead: (leagueId, notifId, token) =>
    request(`/notifications/league/${leagueId}/${notifId}/read`, { method: 'POST', token }),
  markTeamNotificationRead: (teamId, notifId, token) =>
    request(`/notifications/team/${teamId}/${notifId}/read`, { method: 'POST', token }),
  getFollowedMatches: (token) => request('/notifications/followed-matches', { token }),
  unfollowMatch: (matchId, token) =>
    request('/notifications/unfollow-match', { method: 'POST', body: { match_id: matchId }, token }),

  // Cobranza / estado de cuenta (liga → equipos)
  getBillingOverview: (leagueId, token) =>
    request(`/billing/leagues/${leagueId}/overview`, { token }),
  getBillingMatchCounts: (leagueId, { tournamentId, weekLabel } = {}, token) => {
    const qs = new URLSearchParams();
    if (tournamentId) qs.set('tournament_id', tournamentId);
    if (weekLabel) qs.set('week_label', weekLabel);
    const suffix = qs.toString() ? `?${qs}` : '';
    return request(`/billing/leagues/${leagueId}/match-counts${suffix}`, { token });
  },
  getTeamLedger: (leagueId, teamId, token) =>
    request(`/billing/leagues/${leagueId}/teams/${teamId}/entries`, { token }),
  createCharges: (leagueId, payload, token) =>
    request(`/billing/leagues/${leagueId}/charges`, { method: 'POST', body: payload, token }),
  repeatCharges: (leagueId, payload, token) =>
    request(`/billing/leagues/${leagueId}/charges/repeat`, { method: 'POST', body: payload, token }),
  recordPayment: (leagueId, teamId, payload, token) =>
    request(`/billing/leagues/${leagueId}/teams/${teamId}/payments`, { method: 'POST', body: payload, token }),
  voidLedgerEntry: (entryId, reason, token) =>
    request(`/billing/entries/${entryId}/void`, { method: 'POST', body: { reason }, token }),
  updateBillingSettings: (leagueId, payload, token) =>
    request(`/billing/leagues/${leagueId}/settings`, { method: 'PATCH', body: payload, token }),
  getTeamStatement: (teamId, token) =>
    request(`/billing/teams/${teamId}/statement`, { token }),
  // El equipo le reporta a su liga un pago que ya hizo; nace pendiente y la
  // liga lo confirma. Espejo de lo que el papá hace con su club.
  reportTeamPayment: (teamId, payload, token) =>
    request(`/billing/teams/${teamId}/report-payment`, { method: 'POST', body: payload, token }),
  confirmTeamPayment: (entryId, token) =>
    request(`/billing/entries/${entryId}/confirm`, { method: 'POST', token }),
  withdrawTeamPayment: (teamId, token) =>
    request(`/billing/teams/${teamId}/withdraw-payment`, { method: 'POST', token }),

  getTeamBranches: (teamId, token) => request(`/players/teams/${teamId}/branches`, { token }),

  // Cuotas del club (equipo → jugadores). Los dos últimos NO llevan token: el
  // papá abre su estado de cuenta sin cuenta, el share_token es la credencial.
  getPlayerBillingOverview: (teamId, token) =>
    request(`/player-billing/teams/${teamId}/overview`, { token }),
  getMemberLedger: (teamId, memberId, token) =>
    request(`/player-billing/teams/${teamId}/members/${memberId}/entries`, { token }),
  createPlayerCharges: (teamId, payload, token) =>
    request(`/player-billing/teams/${teamId}/charges`, { method: 'POST', body: payload, token }),
  recordMemberPayment: (teamId, memberId, payload, token) =>
    request(`/player-billing/teams/${teamId}/members/${memberId}/payments`, { method: 'POST', body: payload, token }),
  confirmPlayerPayment: (entryId, token) =>
    request(`/player-billing/entries/${entryId}/confirm`, { method: 'POST', token }),
  voidPlayerLedgerEntry: (entryId, reason, token) =>
    request(`/player-billing/entries/${entryId}/void`, { method: 'POST', body: { reason }, token }),
  // Padrón del club: independiente de los rosters de torneo. Un equipo sin
  // liga da de alta aquí a su gente y ya puede cobrarle.
  addTeamMember: (teamId, payload, token) =>
    request(`/player-billing/teams/${teamId}/members`, { method: 'POST', body: payload, token }),
  removeTeamMember: (teamId, memberId, token) =>
    request(`/player-billing/teams/${teamId}/members/${memberId}`, { method: 'DELETE', token }),
  importRosterToMembers: (teamId, payload, token) =>
    request(`/player-billing/teams/${teamId}/members/import-roster`, { method: 'POST', body: payload, token }),
  // Edita persona y ficha de cobranza en una sola llamada. Mismo recurso que
  // el DELETE de arriba: lo que los separa es el método.
  updateTeamMember: (teamId, memberId, payload, token) =>
    request(`/player-billing/teams/${teamId}/members/${memberId}`, { method: 'PATCH', body: payload, token }),
  // Marca "ya le recordé" y nada más. Va aparte de updateTeamMember por el
  // `keepalive`: quien la llama acaba de abrir WhatsApp en otra pestaña, y
  // esta petición tiene que sobrevivir a ese cambio (ver TeamFinancesSection).
  markMemberReminded: (teamId, memberId, token) =>
    request(`/player-billing/teams/${teamId}/members/${memberId}`,
      { method: 'PATCH', body: { mark_reminded: true }, token, keepalive: true }),
  rotateMemberShareToken: (teamId, memberId, token) =>
    request(`/player-billing/teams/${teamId}/members/${memberId}/rotate-token`, { method: 'POST', token }),
  updatePlayerBillingSettings: (teamId, payload, token) =>
    request(`/player-billing/teams/${teamId}/settings`, { method: 'PATCH', body: payload, token }),
  getPublicPlayerStatement: (shareToken) =>
    request(`/player-billing/statement/${shareToken}`),
  reportPlayerPayment: (shareToken, payload) =>
    request(`/player-billing/statement/${shareToken}/report-payment`, { method: 'POST', body: payload }),
  withdrawPlayerPayment: (shareToken) =>
    request(`/player-billing/statement/${shareToken}/withdraw-payment`, { method: 'POST' }),

  // Subida del comprobante por el papá — sin sesión, el share_token de la URL
  // hace de credencial. No puede usar uploadImage(): ese manda Authorization.
  uploadPaymentProof: async (shareToken, file) => {
    const formData = new FormData();
    formData.append('file', file);
    const res = await fetch(`${BASE}/player-billing/statement/${shareToken}/upload-proof`, {
      method: 'POST',
      body: formData,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'No se pudo subir el comprobante');
    return data;
  },
};
