import { Link } from 'react-router-dom';

import { LEGAL, PRIVACY_PUBLISHED } from '../config/legal.js';

const LAST_UPDATED = '13 de septiembre de 2026';

export default function TermsOfService() {
  return (
    <div className="container legal-page">
      <div className="section-head">
        <h2>Términos de Servicio</h2>
      </div>
      <p className="legal-updated">Última actualización: {LAST_UPDATED}</p>

      <p>
        Estos Términos de Servicio ("Términos") rigen el uso de CFBAMX — Calendarios de Football
        Americano México (el "Servicio"), operado por {LEGAL.razonSocial}
        ("nosotros"). Al crear una cuenta o usar el Servicio aceptas estos Términos. Si no estás de
        acuerdo, no debes usar el Servicio.
      </p>

      <h3>1. Qué es el Servicio</h3>
      <p>
        CFBAMX es una plataforma para publicar calendarios, resultados, transmisiones y estructura
        (categorías, equipos, sedes) de ligas de fútbol americano en México, y para que ligas,
        equipos, tiendas, marcas y medios administren su información desde un panel propio.
      </p>

      <h3>2. Cuentas</h3>
      <ul>
        <li>Debes dar información veraz al registrarte y mantenerla actualizada.</li>
        <li>Eres responsable de la actividad que ocurra en tu cuenta y de mantener tu contraseña segura.</li>
        <li>
          Una cuenta puede administrar varias organizaciones (ligas, equipos y otros tipos). El
          administrador de una organización es responsable del contenido que publica en su nombre.
        </li>
      </ul>

      <h3>3. Registro y aprobación de ligas</h3>
      <p>
        Una liga nueva queda como <strong>pendiente de aprobación</strong> hasta que el equipo de
        CFBAMX la revisa. Podemos aprobar, rechazar o eliminar una liga a nuestro criterio,
        especialmente si la información publicada es falsa, engañosa o viola estos Términos.
        Mientras esté pendiente, el dueño puede seguir configurando su liga con normalidad, pero no
        aparecerá en el sitio público.
      </p>

      <h3>4. Contenido que tú publicas</h3>
      <p>
        Tú conservas los derechos sobre los logos, fotos, descripciones y demás contenido que subes
        (por ejemplo, a través de nuestro proveedor de imágenes). Al publicarlo, nos das permiso para
        mostrarlo dentro del Servicio (incluyendo vistas previas en redes sociales) con el único fin
        de operar la plataforma. Eres responsable de tener los derechos necesarios sobre lo que
        publicas y de que no infrinja derechos de terceros.
      </p>

      <h3>5. Estado de cuenta / cobranza entre ligas y equipos</h3>
      <p>
        La herramienta de "Cobranza" permite que una liga lleve un registro de cargos y pagos frente
        a sus equipos. <strong>CFBAMX no procesa ni recibe esos pagos</strong>: es únicamente un
        libro de registro entre la liga y sus equipos. Cualquier disputa sobre un cargo, un pago o un
        adeudo es responsabilidad exclusiva de la liga y el equipo involucrados; CFBAMX no es parte
        de esa relación económica ni garantiza la exactitud de lo que cada liga registra.
      </p>

      <h3>6. Planes de pago y funciones de paga</h3>
      <p>
        Algunas funciones (por ejemplo, el asistente de WhatsApp para tiendas) requieren un plan de
        pago. Los términos específicos de cobro, renovación y cancelación de un plan de pago se
        describen al momento de contratarlo. Nos reservamos el derecho de suspender funciones de paga
        si el pago correspondiente no se completa o se revierte.
      </p>

      <h3>7. Enlaces y servicios de terceros</h3>
      <p>
        Algunos botones (por ejemplo, "Hotel" o "Vuelo" en la página de un partido) te llevan a
        sitios de terceros como Booking.com o Aviasales, con quienes podemos tener una relación de
        afiliado que nos genera una comisión si completas una reserva ahí. No somos responsables del
        contenido, precios, disponibilidad ni del servicio que esos terceros te presten — esa relación
        es directamente entre tú y el tercero, bajo sus propios términos y política de privacidad.
      </p>

      <h3>8. Asistente automatizado (bot de WhatsApp)</h3>
      <p>
        Algunas organizaciones pueden ofrecer un asistente automatizado (impulsado por inteligencia
        artificial) para responder preguntas sobre su inventario por WhatsApp. Las respuestas del
        asistente son generadas automáticamente y pueden contener errores; no reemplazan la
        confirmación directa con la organización antes de una compra.
      </p>

      <h3>9. Uso aceptable</h3>
      <p>No puedes usar el Servicio para:</p>
      <ul>
        <li>Publicar información falsa sobre una liga, equipo, partido o resultado a propósito.</li>
        <li>Suplantar a otra persona u organización, o reclamar un equipo/liga que no te corresponde.</li>
        <li>Intentar vulnerar la seguridad del Servicio o acceder a cuentas ajenas.</li>
        <li>Usar el Servicio con fines ilegales o para dañar a terceros.</li>
      </ul>

      <h3>10. Disponibilidad del Servicio</h3>
      <p>
        Hacemos un esfuerzo razonable para mantener el Servicio disponible, pero no garantizamos que
        funcione sin interrupciones o errores. Podemos suspender el Servicio temporalmente por
        mantenimiento o causas fuera de nuestro control.
      </p>

      <h3>11. Suspensión y cancelación</h3>
      <p>
        Podemos suspender o cancelar tu cuenta u organización si incumples estos Términos. Puedes
        dejar de usar el Servicio en cualquier momento; si administras una organización con
        información pública, contáctanos para solicitar su baja.
      </p>

      <h3>12. Limitación de responsabilidad</h3>
      <p>
        El Servicio se ofrece "tal cual". En la medida permitida por la ley, no somos responsables de
        daños indirectos, pérdida de datos o de ingresos derivados del uso del Servicio, ni de
        decisiones tomadas con base en información publicada por otros usuarios (por ejemplo, cargos
        registrados por una liga, o resultados y horarios capturados por terceros).
      </p>

      <h3>13. Cambios a estos Términos</h3>
      <p>
        Podemos actualizar estos Términos conforme el Servicio evolucione. Publicaremos la fecha de
        la última actualización en esta página; el uso continuado del Servicio después de un cambio
        implica tu aceptación de los nuevos Términos.
      </p>

      <h3>14. Ley aplicable</h3>
      <p>
        Estos Términos se rigen por las leyes de México. Cualquier controversia se someterá a los
        tribunales competentes de {LEGAL.jurisdiccion}, salvo que la ley aplicable disponga otra cosa.
      </p>

      <h3>15. Contacto</h3>
      <p>
        Dudas sobre estos Términos:{' '}
        <a href={`mailto:${LEGAL.correoContacto}`}>{LEGAL.correoContacto}</a>.
      </p>

      {PRIVACY_PUBLISHED && (
        <p className="legal-updated">
          Ver también nuestro <Link to="/privacidad">Aviso de Privacidad</Link>.
        </p>
      )}
    </div>
  );
}
