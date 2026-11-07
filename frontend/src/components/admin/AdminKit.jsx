import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useSearchParams } from 'react-router-dom';
import { initials } from '../../utils/matchDisplay.js';
import { formatNumber, paginate } from '../../utils/adminPanel.js';
import { IconCheck, IconChevronLeft, IconChevronRight, IconMore, IconSearch } from './AdminIcons.jsx';

// Las piezas con las que se arma cada sección de /admin. Todas las secciones tienen
// la misma forma —el marcador arriba y el trabajo abajo— para que moverse de una a
// otra no obligue a volver a aprender dónde está cada cosa.

const MX_DATE = { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'America/Mexico_City' };

export function formatDate(value) {
  return value ? new Date(value).toLocaleDateString('es-MX', MX_DATE) : '—';
}

/* ---------- La banda: el título y el marcador ---------- */

// `actions` va a la derecha del título: es donde vive la acción principal de la
// sección, si la tiene.
export function Band({ title, actions, children }) {
  return (
    <header className="adm-band">
      <div className="adm-band-top">
        <h1>{title}</h1>
        {actions && <div className="adm-band-actions">{actions}</div>}
      </div>
      {children}
    </header>
  );
}

export function Scoreboard({ children, label }) {
  return <div className="adm-score" role="group" aria-label={label}>{children}</div>;
}

// Una celda que solo informa.
export function ScoreCell({ label, value, sub, loading, small }) {
  return (
    <div className="adm-score-cell">
      <span className="adm-score-label">{label}</span>
      <span className={`adm-score-value${small ? ' is-text' : ''}`}>{loading ? '—' : value}</span>
      {sub && <span className="adm-score-sub">{sub}</span>}
    </div>
  );
}

// Las celdas que además filtran la tabla de abajo. Son un solo control a propósito:
// el número de "Públicas" y el filtro "Públicas" eran dos renglones que decían lo
// mismo.
export function FilterScoreboard({ label, filters, active, onChange, loading }) {
  return (
    <Scoreboard label={label}>
      {filters.map((filter) => {
        const needsYou = filter.attention && filter.count > 0;
        return (
          <button
            key={filter.key}
            type="button"
            className={`adm-score-cell is-filter${filter.key === active ? ' is-active' : ''}`}
            aria-pressed={filter.key === active}
            onClick={() => onChange(filter.key)}
          >
            <span className="adm-score-label">{filter.label}</span>
            <span className={`adm-score-value${needsYou ? ' is-attention' : ''}`}>
              {loading ? '—' : formatNumber(filter.count)}
            </span>
          </button>
        );
      })}
    </Scoreboard>
  );
}

// El filtro vive en la dirección, igual que la sección: recargar no te saca de
// donde estabas y "Revisar" en el Resumen puede llegar ya filtrado.
export function useSectionFilter(filters, fallback) {
  const [params, setParams] = useSearchParams();
  const raw = params.get('filtro');
  const filter = filters.some((f) => f.key === raw) ? raw : fallback;

  function setFilter(key) {
    setParams((previous) => {
      const next = new URLSearchParams(previous);
      if (key === fallback) next.delete('filtro');
      else next.set('filtro', key);
      return next;
    }, { replace: true });
  }

  return [filter, setFilter];
}

/* ---------- Tablas ---------- */

export function SearchBox({ value, onChange, placeholder }) {
  return (
    <label className="adm-search">
      <IconSearch />
      <input
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        aria-label={placeholder}
      />
    </label>
  );
}

// Una búsqueda sobre las filas de la tabla, partida en páginas. Cambiar de filtro o
// de búsqueda regresa a la primera página.
export function useTableView(rows, resetKey, size = 25) {
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);

  useEffect(() => { setPage(1); }, [query, resetKey]);

  return { query, setQuery, page: paginate(rows(query), page, size), setPage };
}

export function TableFooter({ view, noun }) {
  const { page, setPage } = view;
  return (
    <footer className="adm-table-foot">
      <span>{formatNumber(page.from)}–{formatNumber(page.to)} de {formatNumber(page.total)} {noun}</span>
      {page.pages > 1 && (
        <div className="adm-pager">
          <button
            type="button"
            aria-label="Página anterior"
            disabled={page.page === 1}
            onClick={() => setPage(page.page - 1)}
          >
            <IconChevronLeft />
          </button>
          <span>{page.page} de {page.pages}</span>
          <button
            type="button"
            aria-label="Página siguiente"
            disabled={page.page === page.pages}
            onClick={() => setPage(page.page + 1)}
          >
            <IconChevronRight />
          </button>
        </div>
      )}
    </footer>
  );
}

export function NoResults({ children, onClear }) {
  return (
    <div className="adm-no-results">
      <p>{children}</p>
      {onClear && <button type="button" className="btn btn-ws btn-sm" onClick={onClear}>Ver todo</button>}
    </div>
  );
}

// El logo con su nombre y un renglón de contexto. Sin logo, sus iniciales: una fila
// sin imagen no debe empujar el nombre a otra columna.
export function Identity({ name, sub, title, logo, round }) {
  return (
    <div className="adm-who">
      {logo ? (
        <img className={`adm-who-logo${round ? ' is-round' : ''}`} src={logo} alt="" loading="lazy" />
      ) : (
        <span className={`adm-who-logo is-initials${round ? ' is-round' : ''}`} aria-hidden="true">
          {initials(name) || '–'}
        </span>
      )}
      <span className="adm-who-text">
        <span className="adm-who-name" title={name}>{name}</span>
        {sub && <span className="adm-who-sub" title={title ?? sub}>{sub}</span>}
      </span>
    </div>
  );
}

// Un estado siempre lleva su palabra: el color solo no dice nada a quien no lo
// distingue. `on` verde, `off` apagado, `ask` amarillo (te toca a ti), `bad` rojo.
export function Status({ tone = 'off', check, children, title }) {
  return (
    <span className={`adm-status is-${tone}`} title={title}>
      {check ? <IconCheck /> : <span className="adm-status-dot" aria-hidden="true" />}
      {children}
    </span>
  );
}

// El segundo renglón del estado de una liga u organización: publicar y verificar son
// dos decisiones distintas (README, "Organizaciones: publicar y verificar").
export function Verified({ on }) {
  return on
    ? <span className="adm-verified is-on">✓ Verificada</span>
    : <span className="adm-verified">Sin verificar</span>;
}

/* ---------- El menú "⋯" de una fila ---------- */

// Va en un portal porque la tabla recorta lo que se le sale, y se cierra al
// desplazar la página: un menú fijo que se queda flotando lejos de su fila ya no
// dice de cuál es.
//
// items: [{ label, onSelect } | { label, href } | { divider: true }], con
// `danger` para lo que no se deshace.
export function RowMenu({ label, items, disabled }) {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState(null);
  const button = useRef(null);
  const menu = useRef(null);

  useLayoutEffect(() => {
    if (!open) return;
    const anchor = button.current.getBoundingClientRect();
    const height = menu.current.offsetHeight;
    const roomBelow = window.innerHeight - anchor.bottom;
    setPosition({
      top: roomBelow > height + 12 ? anchor.bottom + 6 : Math.max(8, anchor.top - height - 6),
      right: Math.max(8, window.innerWidth - anchor.right),
    });
    menu.current.querySelector('[role="menuitem"]')?.focus();
  }, [open]);

  useEffect(() => {
    if (!open) return undefined;
    const close = () => setOpen(false);
    const onPointerDown = (e) => {
      if (!menu.current?.contains(e.target) && !button.current?.contains(e.target)) close();
    };
    document.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('scroll', close, true);
    window.addEventListener('resize', close);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('resize', close);
    };
  }, [open]);

  // Un equipo sin verificar, por ejemplo, ya trae su única acción a la vista.
  const entries = items.filter(Boolean);
  if (entries.length === 0) return null;

  function closeAndReturn() {
    setOpen(false);
    button.current?.focus();
  }

  function onKeyDown(e) {
    const links = [...menu.current.querySelectorAll('[role="menuitem"]')];
    const index = links.indexOf(document.activeElement);
    if (e.key === 'Escape') { e.preventDefault(); closeAndReturn(); }
    if (e.key === 'Tab') setOpen(false);
    if (e.key === 'ArrowDown') { e.preventDefault(); links[(index + 1) % links.length]?.focus(); }
    if (e.key === 'ArrowUp') { e.preventDefault(); links[(index - 1 + links.length) % links.length]?.focus(); }
    if (e.key === 'Home') { e.preventDefault(); links[0]?.focus(); }
    if (e.key === 'End') { e.preventDefault(); links[links.length - 1]?.focus(); }
  }

  return (
    <>
      <button
        ref={button}
        type="button"
        className="adm-more"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        disabled={disabled}
        onClick={() => { setPosition(null); setOpen((value) => !value); }}
      >
        <IconMore />
      </button>
      {open && createPortal(
        <div
          ref={menu}
          className="adm-menu"
          role="menu"
          aria-label={label}
          onKeyDown={onKeyDown}
          style={position ?? { top: 0, right: 0, visibility: 'hidden' }}
        >
          {entries.map((item) => {
            if (item.divider) return <div key={item.key} className="adm-menu-divider" role="separator" />;
            const className = `adm-menu-item${item.danger ? ' is-danger' : ''}`;
            return item.href ? (
              <a
                key={item.label}
                className={className}
                role="menuitem"
                href={item.href}
                target="_blank"
                rel="noopener noreferrer"
                onClick={() => setOpen(false)}
              >
                {item.label}
              </a>
            ) : (
              <button
                key={item.label}
                type="button"
                className={className}
                role="menuitem"
                onClick={() => { setOpen(false); item.onSelect(); }}
              >
                {item.label}
              </button>
            );
          })}
        </div>,
        document.body,
      )}
    </>
  );
}

/* ---------- Mientras llega y cuando falla ---------- */

export function SectionError({ messages }) {
  const shown = [...new Set(messages.filter(Boolean))];
  if (shown.length === 0) return null;
  return <div className="form-error">{shown.join(' · ')}</div>;
}

// El servicio puede tardar ~40 s en despertar (PD-03): el marco se pinta de
// inmediato y lo que falta se dice en una sola línea, sin saltos.
export const SectionLoading = () => <div className="adm-loading">Cargando…</div>;
