import { useEffect, useState } from 'react';
import { api } from '../api/client.js';
import { caducaEn, linkDeInvitacion, enlaceWhatsApp, mensajeDeInvitacion } from '../utils/invitaciones.js';
import Modal from './Modal.jsx';

// Genera un link de invitación de un solo uso para sumar a alguien a una liga
// o equipo (organization_members), CON UN ROL. A diferencia de
// InviteTeamModal —que entrega el equipo completo y una sola vez—, este link
// agrega a quien lo reclame sin quitarle el acceso a nadie más.
//
// El rol se elige ANTES de generar el link, no después: quien invita es quien
// sabe a qué viene la persona, y quien reclama solo prueba que el link llegó a
// sus manos. Por eso hay un paso de "elegir" y luego uno de "copiar", en vez
// de generar un link al abrir el modal como hacía la versión anterior.
//
// Un link, una persona (README, "Dos links distintos: la entrega y la
// invitación con rol"). Generar otro del mismo rol ya no mata el anterior, así
// que invitar a veinte coaches son veinte vueltas de "Invitar a alguien más"
// sin cerrar el modal. La nota de "para quién" es lo que después los distingue
// en la lista de pendientes.

// Qué hace cada rol, en una línea y en palabras de cancha. El catálogo de qué
// roles existen y cómo se llaman viene del backend (`getOrganizationRoles`);
// esto es solo la explicación que acompaña a cada opción. Si algún día hay un
// rol nuevo, el selector lo pinta igual — se queda sin la línea de ayuda, que
// es exactamente el grado de degradación aceptable.
const QUE_HACE = {
  owner:         'Todo, incluido invitar y quitar a otros dueños.',
  admin:         'Todo lo operativo. No puede invitar ni quitar dueños.',
  treasurer:     'Solo el dinero: cargos, pagos y estados de cuenta.',
  editor:        'Solo partidos que ya existen: marcador, estado, fecha, sede y links. No los crea ni los borra.',
  roster_editor: 'Solo el roster de torneo: altas, bajas, número y posición.',
  coach:         'Solo lectura: perfil, calendario y roster.',
};

// Los dos roles de un equipo que NO ven el padrón del club, dicho de frente en
// el momento de invitar. Es el dato que alguien necesita para elegir bien, y
// es la decisión que más caro sale equivocar.
const NO_VE_PADRON = new Set(['roster_editor', 'coach']);

export default function InviteAdminModal({ organizationId, organizationName, organizationType, token, onClose, onDone }) {
  const [roles, setRoles] = useState(null);
  const [rol, setRol] = useState('admin');
  const [nota, setNota] = useState('');
  const [link, setLink] = useState(null);
  const [generada, setGenerada] = useState(null);
  const [etiqueta, setEtiqueta] = useState('');
  const [cuantas, setCuantas] = useState(0);
  const [error, setError] = useState('');
  const [generando, setGenerando] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    api.getOrganizationRoles(organizationId, token)
      .then((d) => {
        setRoles(d.roles);
        // Preseleccionar el primero que de verdad se pueda repartir: un
        // administrador no puede nombrar dueños, así que arrancar en "Dueño"
        // sería arrancar en un error.
        const primero = d.roles.find((r) => r.grantable && r.value !== 'owner') ?? d.roles.find((r) => r.grantable);
        if (primero) setRol(primero.value);
      })
      .catch(() => {
        // El backend viejo no tiene esta ruta. Pasa en los minutos entre el
        // despliegue de Vercel y el de Render, y en vez de dejar el modal
        // inservible se cae a lo único que ese backend sabe entregar: un
        // administrador, que es exactamente lo que hacía antes de los roles.
        setRoles([{ value: 'admin', label: 'Administrador', grantable: true }]);
        setRol('admin');
      });
  }, [organizationId]);

  async function generar() {
    setError('');
    setGenerando(true);
    try {
      const nueva = await api.createOrgAdminInvite(organizationId, rol, token, nota);
      setLink(linkDeInvitacion(nueva.token));
      setGenerada(nueva);
      setEtiqueta(nueva.role_label || '');
      setCuantas((n) => n + 1);
    } catch (e) {
      setError(e.message);
    } finally {
      setGenerando(false);
    }
  }

  // Vuelve al paso de elegir, con el mismo rol ya marcado: lo normal es que la
  // siguiente persona venga a lo mismo que la anterior. La nota sí se limpia,
  // porque es de otra persona.
  function otraPersona() {
    setLink(null);
    setGenerada(null);
    setNota('');
    setCopied(false);
    setError('');
  }

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Si el navegador no deja copiar solo, la persona puede seleccionar el texto a mano.
    }
  }

  const esEquipo = organizationType === 'team';

  return (
    <Modal title={`Invitar a ${organizationName}`} onClose={onClose}>
      {error && <div className="form-error">{error}</div>}

      {!link && (
        <>
          <p style={{ fontSize: 13, color: 'var(--ink-dim)', marginTop: 0 }}>
            Elige con qué acceso entra esta persona. El link es para ella sola: sirve una vez, ya
            lleva el rol adentro y caduca en 7 días.
          </p>

          {roles === null ? (
            <p style={{ color: 'var(--ink-dim)', fontSize: 13 }}>Cargando roles…</p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {roles.map((r) => (
                <label
                  key={r.value}
                  style={{
                    display: 'flex', gap: 10, alignItems: 'flex-start', padding: '10px 12px',
                    border: '1px solid var(--line)', borderRadius: 8,
                    borderColor: rol === r.value ? 'var(--flag)' : 'var(--line)',
                    opacity: r.grantable ? 1 : 0.5,
                    cursor: r.grantable ? 'pointer' : 'not-allowed',
                  }}
                  title={r.grantable ? undefined : 'Solo un dueño puede invitar a otro dueño'}
                >
                  <input
                    type="radio"
                    name="rol-invitacion"
                    value={r.value}
                    checked={rol === r.value}
                    disabled={!r.grantable}
                    onChange={() => setRol(r.value)}
                    style={{ marginTop: 3 }}
                  />
                  <span>
                    <span style={{ fontWeight: 600 }}>{r.label}</span>
                    {!r.grantable && (
                      <span style={{ fontSize: 11, color: 'var(--ink-dim)', marginLeft: 6 }}>
                        — solo un dueño puede repartirlo
                      </span>
                    )}
                    {QUE_HACE[r.value] && (
                      <span style={{ display: 'block', fontSize: 12, color: 'var(--ink-dim)', marginTop: 2 }}>
                        {QUE_HACE[r.value]}
                        {esEquipo && NO_VE_PADRON.has(r.value) && ' No ve el padrón del club.'}
                      </span>
                    )}
                  </span>
                </label>
              ))}
            </div>
          )}

          {/* Para distinguir este link de los demás en la lista de pendientes.
              Solo lo ve la organización: quien recibe el link no lo ve. */}
          <div className="field" style={{ marginTop: 12 }}>
            <label>Para quién <span style={{ color: 'var(--ink-dim)', fontWeight: 400 }}>(opcional)</span></label>
            <input
              value={nota}
              maxLength={80}
              placeholder="Ej. Yayo, coach de línea ofensiva"
              onChange={(e) => setNota(e.target.value)}
            />
          </div>

          <div className="modal-actions">
            <button className="btn btn-ghost" onClick={onClose}>Cancelar</button>
            <button className="btn btn-primary" onClick={generar} disabled={!roles || generando}>
              {generando ? 'Generando…' : 'Generar link'}
            </button>
          </div>
        </>
      )}

      {link && (
        <>
          <p style={{ fontSize: 13, color: 'var(--ink-dim)', marginTop: 0 }}>
            Link {generada?.note ? <>para <strong>{generada.note}</strong></> : 'listo'}. Mándaselo por
            WhatsApp con el botón, o cópialo para mandarlo por otro lado. Al abrirlo va a crear su
            cuenta o iniciar sesión, y va a entrar a {organizationName} como <strong>{etiqueta || rol}</strong>.
            Sirve una sola vez y {caducaEn(generada?.seconds_left)}.
          </p>
          <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
            <input readOnly value={link} onFocus={(e) => e.target.select()} style={{ flex: 1 }} />
            <button type="button" className="btn btn-outline btn-sm" onClick={copyLink}>
              {copied ? '✓ Copiado' : 'Copiar'}
            </button>
          </div>
          {/* El link viaja completo dentro del mensaje, al final y en su propia
              línea (ver enlaceWhatsApp). Es un <a> y no un window.open: así el
              navegador no lo bloquea (ver el botón "Recordar"). */}
          <a
            className="btn btn-accent"
            style={{ display: 'block', textAlign: 'center', marginTop: 10 }}
            href={enlaceWhatsApp(mensajeDeInvitacion(organizationName, etiqueta || rol), link)}
            target="_blank"
            rel="noopener noreferrer"
          >
            Enviar por WhatsApp
          </a>
          <p style={{ fontSize: 12, color: 'var(--ink-dim)', marginTop: 10 }}>
            Cada link es para una persona. Puedes generar los que necesites, del rol que sea, sin que
            uno cancele a otro; los que nadie ha usado los ves y los cancelas en "Invitaciones pendientes".
            {cuantas > 1 && <> Llevas <strong>{cuantas}</strong> en esta vuelta.</>}
          </p>

          <div className="modal-actions">
            <button className="btn btn-ghost" onClick={otraPersona}>Invitar a alguien más</button>
            <button className="btn btn-flag" onClick={onDone}>Listo</button>
          </div>
        </>
      )}
    </Modal>
  );
}
