import { Link } from 'react-router-dom';

export default function RegisterOrganization() {
  return (
    <div className="container">
      <div className="section-head">
        <h2>Panel de registro de organizaciones</h2>
      </div>
      <Link to="/registrar-liga" className="btn btn-flag">Registrar liga</Link>
    </div>
  );
}
