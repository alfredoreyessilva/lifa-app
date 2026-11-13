import { useState } from 'react';
import { api } from '../../api/client.js';
import ConfirmDialog from '../ConfirmDialog.jsx';
import { formatNumber, pluralize, prizesSwitch, switchChangedBy } from '../../utils/adminPanel.js';
import { Band, ScoreCell, Scoreboard, SectionError, SectionLoading, Status, formatDate } from './AdminKit.jsx';

// Panel Admin → Premios: el botón que prende y apaga los premios por acertar para
// toda la plataforma (README, "Premios por acertar" → "El interruptor"). Hasta el
// 2026-11-12 iba a ser una variable de Render; Alfredo lo pidió como un botón aquí.
//
// El estado no vive en esta pantalla: vive en el backend (`platform_switches`), y
// la tienda, la página del partido, la bandeja y "Mis premios" le preguntan a él.
// Este botón no tiene una copia que se pueda quedar atrás.
//
// Junto al botón va lo que ayuda a decidir —cuántos premios hay puestos y cuántas
// tiendas pueden ponerlos—, lo que falta para prenderlos y quién los movió.

const SWITCH_KEY = 'prediction_prizes';

const MX_DATE_TIME = {
  day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
  timeZone: 'America/Mexico_City',
};

function formatDateTime(value) {
  return value ? new Date(value).toLocaleString('es-MX', MX_DATE_TIME) : '—';
}

// Lo que dice la ventana de apagar sobre lo que ya está puesto.
function putBack(active) {
  if (active === 1) return 'No se borra nada: el premio que está puesto vuelve como estaba al prenderlos otra vez.';
  if (active > 1) return `No se borra nada: los ${formatNumber(active)} premios puestos vuelven como estaban al prenderlos otra vez.`;
  return 'No se borra nada: al prenderlos otra vez, todo vuelve como estaba.';
}

export default function AdminPrizesSection({ data, error, reload, token }) {
  const [confirming, setConfirming] = useState(false);

  const prizes = data ? prizesSwitch(data) : null;
  const on = prizes?.enabled === true;

  async function flip() {
    await api.adminSetSwitch(SWITCH_KEY, !on, token);
    await reload();
    setConfirming(false);
  }

  return (
    <>
      <Band
        title="Premios por acertar"
        actions={prizes && (
          <button type="button" className="btn btn-ws btn-sm" onClick={() => setConfirming(true)}>
            {on ? 'Apagar premios' : 'Prender premios'}
          </button>
        )}
      >
        <Scoreboard label="Los premios por acertar">
          <ScoreCell
            label="Estado"
            small
            loading={!prizes}
            value={prizes && <Status tone={on ? 'on' : 'off'}>{on ? 'Prendidos' : 'Apagados'}</Status>}
            sub={prizes && (prizes.since ? `Desde el ${formatDate(prizes.since)}` : 'Nunca se han prendido')}
          />
          {/* Etiquetas de una palabra: a 320 px el marcador va en tres columnas y una
              etiqueta larga se corta; lo que explica va en el renglón de abajo. */}
          <ScoreCell
            label="Premios"
            value={formatNumber(prizes?.active)}
            loading={!prizes}
            sub="Puestos y sin retirar, de todas las tiendas"
          />
          <ScoreCell
            label="Tiendas"
            value={formatNumber(prizes?.stores)}
            loading={!prizes}
            sub="Pueden ponerlos: publicadas y verificadas"
          />
        </Scoreboard>
      </Band>

      <div className="adm-canvas">
        <SectionError messages={[error]} />

        {!prizes ? !error && <SectionLoading /> : (
          <>
            {/* Lo que falta es lo único amarillo: es lo que espera a Alfredo, como "Por
                atender" en el Resumen. Prendidos, ya se decidió y sobra. */}
            {!on && (
              <div className="adm-prizes-before">
                <h2>Antes de prenderlos</h2>
                <ol>
                  <li>
                    La revisión legal: si un premio por acertar un pronóstico deportivo pide permiso
                    de Gobernación, qué piden las reglas de PROFECO para una promoción y qué pasa con
                    los menores de edad, porque una cuenta no pide edad.
                  </li>
                  <li>
                    Pasar a los Términos la sección de los premios, que quedó redactada en el README:
                    «Premios por acertar» → «Antes de prenderlo».
                  </li>
                </ol>
              </div>
            )}

            <h2 className="adm-canvas-title">Qué cambia</h2>
            <div className="adm-prizes-effects">
              <section className={`adm-prizes-effect${on ? ' is-current' : ''}`} aria-label="Prendidos">
                <div className="adm-prizes-effect-head">
                  <Status tone="on">Prendidos</Status>
                  {on && <span className="adm-prizes-now">Así están ahora</span>}
                </div>
                <ul>
                  <li>Las tiendas publicadas y verificadas tienen la sección Premios en su panel: ponen premios y cobran los códigos.</li>
                  <li>La página de un partido con premio lo anuncia debajo de «¿Quién gana?».</li>
                  <li>Quien acierta lo recibe con su aviso del resultado y en «Mis premios».</li>
                </ul>
              </section>
              <section className={`adm-prizes-effect${on ? '' : ' is-current'}`} aria-label="Apagados">
                <div className="adm-prizes-effect-head">
                  <Status>Apagados</Status>
                  {!on && <span className="adm-prizes-now">Así están ahora</span>}
                </div>
                <ul>
                  <li>Nada de eso se ve, y las rutas de la tienda contestan como si no existieran.</li>
                  <li>No se borra nada: al prenderlos, todo vuelve como estaba.</li>
                  <li>La vigencia de cada premio sigue corriendo, y las tiendas no pueden cobrar los códigos.</li>
                </ul>
              </section>
            </div>

            <h2 className="adm-canvas-title">Quién los movió</h2>
            {prizes.history.length === 0 ? (
              <div className="adm-no-results">
                <p>Nadie los ha movido: están apagados desde que se construyeron.</p>
              </div>
            ) : (
              <div className="adm-table-box">
                <div className="table-wrap">
                  <table className="data-table adm-table adm-prizes-table">
                    <caption className="adm-sr-only">Cada vez que alguien prendió o apagó los premios</caption>
                    <thead>
                      <tr>
                        <th style={{ width: 220 }}>Cuándo</th>
                        <th style={{ width: 160 }}>Qué</th>
                        <th>Quién</th>
                      </tr>
                    </thead>
                    <tbody>
                      {prizes.history.map((change, index) => (
                        <tr key={`${change.changed_at}-${index}`}>
                          <td className="adm-num">{formatDateTime(change.changed_at)}</td>
                          <td>
                            {change.enabled
                              ? <Status tone="on">Los prendió</Status>
                              : <Status>Los apagó</Status>}
                          </td>
                          <td className={change.changed_by_name ? undefined : 'adm-faint'}>
                            {switchChangedBy(change)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
            <p className="adm-note">
              El cambio se ve al instante en toda la plataforma. Aquí salen los últimos 10.
            </p>
          </>
        )}
      </div>

      {confirming && prizes && (on ? (
        <ConfirmDialog
          title="Apagar los premios por acertar"
          message="Dejan de verse en toda la plataforma —en la página de cada partido, en la bandeja y en «Mis premios»— y las tiendas pierden su sección Premios."
          detail={putBack(prizes.active)}
          warning="Mientras estén apagados, las tiendas no pueden cobrar los códigos y la vigencia de cada premio sigue corriendo."
          confirmLabel="Apagar premios"
          onConfirm={flip}
          onClose={() => setConfirming(false)}
        />
      ) : (
        <ConfirmDialog
          title="Prender los premios por acertar"
          message={prizes.stores > 0
            ? `Las tiendas publicadas y verificadas —hoy, ${pluralize(prizes.stores, 'tienda')}— van a poder ponerle un premio a un partido, y quien acierte lo va a recibir con su aviso del resultado.`
            : 'Hoy no hay ninguna tienda publicada y verificada: nadie va a poder poner un premio hasta que verifiques una.'}
          detail="Se ve al instante, en toda la plataforma. Los puedes apagar cuando quieras sin borrar nada."
          warning="Antes de prenderlos para el público van la revisión legal y la sección de los premios en los Términos (README, «Premios por acertar» → «Antes de prenderlo»)."
          confirmLabel="Prender premios"
          onConfirm={flip}
          onClose={() => setConfirming(false)}
        />
      ))}
    </>
  );
}
