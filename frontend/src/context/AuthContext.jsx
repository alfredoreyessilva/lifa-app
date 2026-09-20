import { createContext, useContext, useEffect, useState } from 'react';
import { api } from '../api/client.js';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [token, setToken] = useState(localStorage.getItem('lifa_token'));
  const [user, setUser] = useState(null);
  const [leagues, setLeagues] = useState([]);
  const [teams, setTeams] = useState([]);
  // Nuevo, aditivo: organizaciones del usuario vía organization_members.
  // OrgLogoBar y el resto del panel SIGUEN navegando con "leagues"/"teams"
  // como hasta ahora (esas listas traen league.id / team.id, que es lo que
  // usan los links para armar la ruta). "organizations" no los reemplaza
  // todavía — se deja disponible en el contexto para cuando el panel
  // empiece a mostrar otros tipos de organización (medios, proveedores,
  // tiendas, clínicas), que no tienen fila en "leagues" ni en "teams".
  const [organizations, setOrganizations] = useState([]);
  const [loading, setLoading] = useState(true);

  // La última respuesta de /auth/me, guardada. No es una caché de rendimiento:
  // es lo que deja que la app se abra SIN SEÑAL sabiendo quién eres. El token
  // dura 7 días (middleware/auth.js), así que una jornada entera en una cancha
  // sin internet no lo tumba — lo que sí tumbaba la sesión era esto de aquí.
  const PERFIL = 'lifa_me';

  function guardarPerfil(data) {
    try { localStorage.setItem(PERFIL, JSON.stringify(data)); } catch { /* modo privado */ }
  }

  function perfilGuardado() {
    try { return JSON.parse(localStorage.getItem(PERFIL) || 'null'); } catch { return null; }
  }

  useEffect(() => {
    if (!token) { setLoading(false); return; }
    api.me(token)
      .then((data) => {
        setUser(data.user);
        setLeagues(data.leagues);
        setTeams(data.teams || []);
        setOrganizations(data.organizations || []);
        guardarPerfil(data);
      })
      .catch((e) => {
        // **Sin conexión NO es sesión inválida.** Hasta el 2026-09-20 cualquier
        // fallo aquí borraba el token, así que el visor que abría la app en una
        // cancha sin señal quedaba fuera — justo donde más falta le hacía estar
        // dentro. Ahora solo se cierra la sesión cuando el servidor CONTESTA
        // que el token no sirve.
        if (e.offline) {
          const guardado = perfilGuardado();
          if (guardado) {
            setUser(guardado.user);
            setLeagues(guardado.leagues || []);
            setTeams(guardado.teams || []);
            setOrganizations(guardado.organizations || []);
          }
          return;
        }
        setToken(null);
        localStorage.removeItem('lifa_token');
        try { localStorage.removeItem(PERFIL); } catch { /* modo privado */ }
      })
      .finally(() => setLoading(false));
  }, [token]);

  function login(newToken, newUser) {
    localStorage.setItem('lifa_token', newToken);
    setToken(newToken);
    setUser(newUser);
  }

  function logout() {
    localStorage.removeItem('lifa_token');
    try { localStorage.removeItem(PERFIL); } catch { /* modo privado */ }
    setToken(null);
    setUser(null);
    setLeagues([]);
    setTeams([]);
    setOrganizations([]);
  }

  async function refreshLeagues() {
    if (!token) return;
    const data = await api.me(token);
    setLeagues(data.leagues);
    setTeams(data.teams || []);
    setOrganizations(data.organizations || []);
  }

  // Actualiza al usuario en memoria sin volver a pedir /auth/me completo —
  // se usa justo después de verificar el correo (routes/auth.js ya regresa
  // el usuario actualizado en esa misma respuesta).
  function updateUser(patch) {
    setUser((prev) => (prev ? { ...prev, ...patch } : prev));
  }

  return (
    <AuthContext.Provider value={{ token, user, leagues, teams, organizations, loading, login, logout, refreshLeagues, updateUser }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
