import OrgLogoBar from '../components/OrgLogoBar.jsx';
import MiCartelera from '../components/MiCartelera.jsx';
import PredictionStats from '../components/PredictionStats.jsx';

// "Mi panel" (/panel): el punto de entrada de una cuenta, con los logos de
// todas las ligas y equipos que administras y su contenido de aficionado.
//
// El panel de EQUIPO ya no vive aquí — se fue a pages/TeamPanel.jsx, que lo
// convirtió en un espacio de trabajo con secciones (Resumen, Finanzas,
// Padrón, Con la liga, Perfil, Staff) en vez del editor de perfil
// que era antes. El de liga vive en LeagueStructurePanel.jsx desde antes.
export default function Dashboard() {
  return (
    <div className="container">
      <div className="dashboard-panel">
        <OrgLogoBar />
        <PredictionStats />
        <MiCartelera />
      </div>
    </div>
  );
}
