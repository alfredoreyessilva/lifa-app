import { Link } from 'react-router-dom';

const LAST_UPDATED = '13 de septiembre de 2026';

export default function PrivacyPolicy() {
  return (
    <div className="container legal-page">
      <div className="section-head">
        <h2>Aviso de Privacidad</h2>
      </div>
      <p className="legal-updated">Última actualización: {LAST_UPDATED}</p>

      <p>
        [Razón social / nombre de quien opera CFBAMX], responsable de CFBAMX — Calendarios de
        Football Americano México (el "Servicio"), con domicilio en [domicilio fiscal o de
        contacto], es responsable del tratamiento de tus datos personales conforme a la Ley Federal
        de Protección de Datos Personales en Posesión de los Particulares.
      </p>

      <h3>1. Datos que recabamos</h3>
      <ul>
        <li><strong>Datos de cuenta:</strong> nombre, correo electrónico y contraseña (guardada de forma cifrada); si inicias sesión con Google, tu nombre, correo y foto de perfil públicos de esa cuenta.</li>
        <li><strong>Datos de tus organizaciones:</strong> nombre, descripción, logo/fotos, redes sociales y correo de contacto que tú mismo cargas para tu liga, equipo u otra organización.</li>
        <li><strong>Notificaciones push:</strong> el identificador técnico de suscripción de tu navegador, para poder enviarte avisos de partidos que sigues.</li>
        <li><strong>Registro de cobranza:</strong> si administras o representas un equipo, los cargos y pagos que la liga registra en el estado de cuenta correspondiente a ese equipo.</li>
        <li><strong>Mensajes de WhatsApp:</strong> si escribes al número de WhatsApp de una organización con asistente automatizado, tu número y el contenido de tu mensaje se procesan para generar una respuesta.</li>
        <li><strong>Datos de uso:</strong> vistas y clics agregados (por ejemplo, en anuncios de patrocinador) para entender el uso del sitio; no incluyen tu nombre ni correo.</li>
      </ul>

      <h3>2. Para qué usamos tus datos</h3>
      <ul>
        <li>Crear y operar tu cuenta, y verificar tu identidad al iniciar sesión.</li>
        <li>Publicar y mostrar la información de las organizaciones que administras.</li>
        <li>Enviarte notificaciones (correo o push) sobre partidos, aprobaciones, cargos de cobranza u otra actividad relevante de tu cuenta.</li>
        <li>Responder tus mensajes a través del asistente automatizado, cuando aplique.</li>
        <li>Mantener la seguridad del Servicio (por ejemplo, limitar intentos de inicio de sesión sospechosos).</li>
        <li>Entender el uso general del sitio para mejorarlo.</li>
      </ul>
      <p>No usamos tus datos para venderlos a terceros ni para publicidad dirigida fuera del Servicio.</p>

      <h3>3. Con quién compartimos datos</h3>
      <p>
        No vendemos tus datos personales. Los compartimos únicamente con proveedores que nos ayudan a
        operar el Servicio, bajo las obligaciones de confidencialidad correspondientes:
      </p>
      <ul>
        <li><strong>Cloudinary</strong> — almacenamiento de imágenes que subes (logos, fotos).</li>
        <li><strong>Resend</strong> — envío de correos (verificación de cuenta, avisos).</li>
        <li><strong>Google</strong> — inicio de sesión con cuenta de Google, si eliges usarlo.</li>
        <li><strong>Meta / WhatsApp Business</strong> — si escribes a un número de WhatsApp con asistente automatizado.</li>
        <li><strong>Anthropic</strong> — procesamiento del texto de tu mensaje para generar la respuesta del asistente automatizado.</li>
        <li><strong>Neon</strong> y <strong>Render</strong> — hospedaje de la base de datos y del servidor del Servicio.</li>
        <li><strong>Sentry</strong> — reporte automático de errores técnicos (por ejemplo, en qué pantalla y bajo qué condiciones ocurrió una falla), para poder corregirlos.</li>
      </ul>
      <p>
        Cuando usas un botón de Hotel o Vuelo, sales de CFBAMX hacia Booking.com o Aviasales
        respectivamente; a partir de ese momento aplica la política de privacidad de esos terceros,
        no la nuestra.
      </p>
      <p>
        Podemos también compartir datos si la ley lo exige o para proteger los derechos, la
        seguridad o la propiedad de CFBAMX o de terceros.
      </p>

      <h3>4. Dónde se almacenan tus datos</h3>
      <p>
        Nuestros proveedores de hospedaje e infraestructura pueden almacenar y procesar datos fuera
        de México. Al usar el Servicio, aceptas esta transferencia internacional necesaria para
        operarlo.
      </p>

      <h3>5. Cómo protegemos tus datos</h3>
      <p>
        Tu contraseña se guarda cifrada (nunca en texto plano). El acceso a la API está protegido por
        autenticación y limita los intentos de inicio de sesión para frenar ataques de fuerza bruta.
        Ningún sistema es 100% seguro; si detectamos un incidente que comprometa tus datos, te lo
        notificaremos conforme lo exige la ley.
      </p>

      <h3>6. Cuánto tiempo guardamos tus datos</h3>
      <p>
        Conservamos tu información mientras tu cuenta esté activa o sea necesaria para los fines
        descritos en este aviso. El registro de cobranza (cargos y pagos) es un libro que no se
        edita ni se borra, incluso si un cargo se cancela, para mantener un historial confiable entre
        la liga y sus equipos.
      </p>

      <h3>7. Tus derechos (ARCO)</h3>
      <p>
        Puedes solicitar Acceso, Rectificación, Cancelación u Oposición (derechos ARCO) sobre tus
        datos personales, así como revocar tu consentimiento, escribiendo a{' '}
        <a href="mailto:[correo de contacto de CFBAMX]">[correo de contacto de CFBAMX]</a>. Podemos
        pedirte información para verificar tu identidad antes de atender la solicitud. Algunos datos
        (como el registro de cobranza de una liga en la que participas) pueden estar sujetos a
        conservación mientras la organización correspondiente los necesite para su propio registro
        contable.
      </p>

      <h3>8. Cookies y almacenamiento local</h3>
      <p>
        El Servicio guarda tu sesión (token de acceso) en el almacenamiento local de tu navegador,
        no en una cookie, para mantenerte con la sesión iniciada. No usamos cookies de publicidad de
        terceros.
      </p>

      <h3>9. Menores de edad</h3>
      <p>
        El Servicio no está dirigido a menores de edad para la creación de cuentas. La información
        pública de partidos y calendarios puede incluir nombres de jugadores menores de edad
        capturados por la liga o el equipo correspondiente, bajo su propia responsabilidad.
      </p>

      <h3>10. Cambios a este aviso</h3>
      <p>
        Podemos actualizar este Aviso de Privacidad conforme el Servicio evolucione. Publicaremos la
        fecha de la última actualización en esta misma página.
      </p>

      <p className="legal-updated">
        Ver también nuestros <Link to="/terminos">Términos de Servicio</Link>.
      </p>
    </div>
  );
}
