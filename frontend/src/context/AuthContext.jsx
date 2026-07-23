import { createContext, useContext, useEffect, useState } from 'react';
import { api } from '../api/client.js';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [token, setToken] = useState(localStorage.getItem('lifa_token'));
  const [user, setUser] = useState(null);
  const [leagues, setLeagues] = useState([]);
  const [teams, setTeams] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!token) { setLoading(false); return; }
    api.me(token)
      .then((data) => { setUser(data.user); setLeagues(data.leagues); setTeams(data.teams || []); })
      .catch(() => { setToken(null); localStorage.removeItem('lifa_token'); })
      .finally(() => setLoading(false));
  }, [token]);

  function login(newToken, newUser) {
    localStorage.setItem('lifa_token', newToken);
    setToken(newToken);
    setUser(newUser);
  }

  function logout() {
    localStorage.removeItem('lifa_token');
    setToken(null);
    setUser(null);
    setLeagues([]);
    setTeams([]);
  }

  async function refreshLeagues() {
    if (!token) return;
    const data = await api.me(token);
    setLeagues(data.leagues);
    setTeams(data.teams || []);
  }

  return (
    <AuthContext.Provider value={{ token, user, leagues, teams, loading, login, logout, refreshLeagues }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
