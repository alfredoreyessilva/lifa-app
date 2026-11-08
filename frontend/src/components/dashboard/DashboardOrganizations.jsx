import { useState } from 'react';
import { Link } from 'react-router-dom';
import { RowMenu } from '../admin/AdminKit.jsx';
import { IconChevronRight, IconPlus } from '../admin/AdminIcons.jsx';
import { formatNumber } from '../../utils/adminPanel.js';
import { initials } from '../../utils/matchDisplay.js';

// "Tus organizaciones" en Mi panel: una ficha por liga, equipo u organización que
// administras, con su nombre y con qué rol entras. Antes era un logo de 72 px sin
// nombre (OrgLogoBar, que se queda para el panel de un equipo). README, "Mi panel".

// Las tres puertas de registro. En el menú se leen después de "Registrar"; en el
// recuadro de quien no administra nada, completas.
const REGISTER = [
  { label: 'Liga', full: 'Registrar liga', to: '/registrar-liga' },
  { label: 'Equipo', full: 'Registrar equipo', to: '/registrar-equipo' },
  { label: 'Medio, tienda u otra organización', full: 'Registrar organización', to: '/registrar-organizacion' },
];

export default function DashboardOrganizations({ organizations }) {
  return (
    <section className="dsh-section" aria-labelledby="dsh-orgs-title">
      <header className="dsh-head">
        <h2 id="dsh-orgs-title">
          Tus organizaciones <span className="dsh-count">{formatNumber(organizations.length)}</span>
        </h2>
        <RowMenu
          label="Registrar"
          trigger={<><IconPlus /><span>Registrar</span></>}
          items={REGISTER.map(({ label, to }) => ({ label, to }))}
        />
      </header>

      <ul className="dsh-orgs">
        {organizations.map((org) => (
          <li key={org.key}>
            <Link to={org.href} className="dsh-org">
              <OrgMark org={org} />
              <span className="dsh-org-text">
                <span className="dsh-org-name" title={org.name}>{org.name}</span>
                <span className="dsh-org-what">{org.what}</span>
                {org.role && <span className="dsh-org-role">{org.role}</span>}
              </span>
              <IconChevronRight />
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

// El escudo sobre una placa neutra, como en la barra del panel de una liga. Un logo
// que no carga se cambia por las iniciales en vez de quedar como imagen rota.
function OrgMark({ org }) {
  const [broken, setBroken] = useState(false);
  if (org.logo && !broken) {
    return <img className="dsh-org-mark" src={org.logo} alt="" loading="lazy" onError={() => setBroken(true)} />;
  }
  return <span className="dsh-org-mark is-initials" aria-hidden="true">{initials(org.name) || '–'}</span>;
}

// Quien no administra nada no ve una sección vacía arriba de su cartelera: esto va
// al final, con las tres opciones a la vista porque ahí no hay nada más que hacer.
export function RegisterInvite() {
  return (
    <section className="dsh-invite" aria-labelledby="dsh-invite-title">
      <h2 id="dsh-invite-title">¿Tienes una liga, un equipo o un medio?</h2>
      <p>Regístralo y lo administras desde aquí.</p>
      <div className="dsh-invite-actions">
        {REGISTER.map(({ full, to }) => (
          <Link key={to} to={to} className="btn btn-ws btn-sm">{full}</Link>
        ))}
      </div>
    </section>
  );
}
