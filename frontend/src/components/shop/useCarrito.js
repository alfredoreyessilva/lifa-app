import { useCallback, useEffect, useRef, useState } from 'react';
import {
  agregarAlCarrito, cambiarCantidad, claveDelCarrito, guardarCarrito, leerCarrito, quitarDelCarrito,
} from '../../utils/compras.js';

// El carrito de una tienda, guardado en este navegador (README, "Compras en la
// vitrina" → "El carrito"). Sobrevive a recargar y a ir a pagar; otra pestaña
// abierta en la misma tienda lo ve cambiar. Sin almacenamiento (modo privado),
// vive mientras la página esté abierta.
const almacen = () => {
  try { return window.localStorage; } catch { return null; }
};

export default function useCarrito(organizationId) {
  const [carrito, setCarrito] = useState(() => leerCarrito(organizationId, almacen()));

  useEffect(() => { setCarrito(leerCarrito(organizationId, almacen())); }, [organizationId]);

  useEffect(() => {
    const onStorage = (e) => {
      if (e.key === claveDelCarrito(organizationId)) setCarrito(leerCarrito(organizationId, almacen()));
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, [organizationId]);

  // Se guarda en el navegador en el momento, no dentro de setCarrito: React tira
  // las actualizaciones de un componente que se desmonta, y «Pagar» vacía el
  // carrito justo antes de irse a la página del pedido. Guardado adentro, el
  // carrito se quedaba lleno con un pedido ya hecho.
  const ultimo = useRef(carrito);
  ultimo.current = carrito;
  const cambiar = useCallback((siguiente) => {
    const nuevo = typeof siguiente === 'function' ? siguiente(ultimo.current) : siguiente;
    ultimo.current = nuevo;
    guardarCarrito(organizationId, nuevo, almacen());
    setCarrito(nuevo);
  }, [organizationId]);

  return {
    carrito,
    agregar: (producto, talla, cantidad) => cambiar((c) => agregarAlCarrito(c, producto, talla, cantidad)),
    cambiarCantidad: (pieza, cantidad) => cambiar((c) => cambiarCantidad(c, pieza, cantidad)),
    quitar: (pieza) => cambiar((c) => quitarDelCarrito(c, pieza)),
    reemplazar: (nuevo) => cambiar(nuevo),
    vaciar: () => cambiar([]),
  };
}
