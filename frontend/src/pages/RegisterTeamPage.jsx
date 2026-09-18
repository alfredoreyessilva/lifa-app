import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api/client.js';
import { useAuth } from '../context/AuthContext.jsx';
import TeamForm from '../components/TeamForm.jsx';

// Registro de un equipo INDEPENDIENTE: sin necesidad de pertenecer a
// ninguna liga de la plataforma. Usa el mismo TeamForm que ya usa el panel
// de una liga para sus propios equipos, en modo "independent" (ahí se
// muestran país/descripción y el interruptor de aparecer en el home, que
// no aplican a un equipo de liga). La verificación de identidad la maneja
// un admin después, desde /admin, con el mismo mecanismo que cualquier
// otra organización (medio/tienda/clínica/marca).
export default function RegisterTeamPage() {
  const [countries, setCountries] = useState([]);
  const { token, refreshLeagues } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    api.getCountries().then((d) => setCountries(d.countries)).catch(() => setCountries([]));
  }, []);

  return (
    <div className="container" style={{ maxWidth: 560 }}>
      <h1>Registrar equipo</h1>
      <p style={{ color: 'var(--ink-dim)', fontSize: 14, marginBottom: 20 }}>
        Registra tu equipo sin necesidad de pertenecer a ninguna liga de la plataforma. Vas a poder usar todas las
        herramientas de tu panel desde el primer momento — aparecer en el home es una decisión aparte, que puedes
        activar o desactivar cuando quieras.
      </p>

      <TeamForm
        independent
        countries={countries}
        submitLabel="Registrar equipo"
        onCancel={() => navigate('/panel')}
        onSubmit={async (payload) => {
          await api.createIndependentTeam(payload, token);
          await refreshLeagues(); // también trae "teams" fresco en el contexto
          navigate('/panel');
        }}
      />

      <p style={{ color: 'var(--ink-dim)', fontSize: 12, marginTop: 20 }}>
        ¿Tu equipo pertenece a una liga? Pídele a su representante que te agregue desde su panel, o{' '}
        <a href="/registrar-liga">registra la liga</a> si todavía no existe en CFBAMX.
      </p>
    </div>
  );
}
