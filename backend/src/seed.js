import bcrypt from 'bcryptjs';
import db from './config/db.js';

const hash = bcrypt.hashSync('password123', 10);

const repId = db.prepare(`
  INSERT INTO users (name, email, password_hash, role) VALUES (?, ?, ?, 'rep')
`).run('Representante LFA', 'rep@lfa.mx', hash).lastInsertRowid;

const leagues = [
  { name: 'Liga de Fútbol Americano Profesional (LFA)', slug: 'lfa', state: 'Nacional', logo_url: '', description: 'La liga profesional de fútbol americano más importante de México.' },
  { name: 'Conferencia Nacional ONEFA', slug: 'onefa', state: 'Nacional', logo_url: '', description: 'Fútbol americano universitario.' },
  { name: 'Liga Premier de Tochito Bandera', slug: 'premier-tochito', state: 'CDMX', logo_url: '', description: 'Tochito bandera competitivo en CDMX.' },
];

for (const lg of leagues) {
  const lgId = db.prepare(`
    INSERT INTO leagues (name, slug, logo_url, state, description, owner_user_id, status)
    VALUES (?, ?, ?, ?, ?, ?, 'approved')
  `).run(lg.name, lg.slug, lg.logo_url, lg.state, lg.description, lg.slug === 'lfa' ? repId : null).lastInsertRowid;

  const cats = lg.slug === 'lfa'
    ? ['Tackle Varonil Mayor', 'Tackle Femenil']
    : ['Varonil Mayor', 'Femenil', 'Sub-17'];

  cats.forEach((catName, idx) => {
    const catId = db.prepare(`INSERT INTO categories (league_id, name, sort_order) VALUES (?, ?, ?)`)
      .run(lgId, catName, idx).lastInsertRowid;

    if (lg.slug === 'lfa' && idx === 0) {
      const now = Date.now();
      const matches = [
        { home: 'Mayas CDMX', away: 'Fundidores de Monterrey', daysFromNow: 3, stream: 'https://www.youtube.com/@LigaLFA' },
        { home: 'Dinos de Saltillo', away: 'Mexicas CDMX', daysFromNow: 10, stream: '' },
        { home: 'Raptors de Naucalpan', away: 'Condors UAG', daysFromNow: -4, stream: 'https://www.youtube.com/@LigaLFA' },
      ];
      matches.forEach((m, i) => {
        const date = new Date(now + m.daysFromNow * 86400000);
        db.prepare(`
          INSERT INTO matches (category_id, home_team, away_team, match_date, venue, stream_url, week_label, status)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          catId, m.home, m.away, date.toISOString(), 'Estadio Azteca',
          m.stream, `Jornada ${i + 1}`, m.daysFromNow < 0 ? 'finished' : 'scheduled'
        );
      });
    }
  });
}

console.log('Seed completo. Login de prueba: rep@lfa.mx / password123');
