// Date d'arrivée de la personne dans l'application (versions utilisateur ET administrateur).
// Caractéristiques et malus partent de max(1er septembre, date d'arrivée) :
//  - installation déjà existante au moment de cette mise à jour (meta `initialized` présente) : 1er septembre, comme avant ;
//  - nouvelle installation : le jour de la première ouverture.
// meta `joinDate` : 'YYYY-MM-DD', écrite une seule fois. À appeler AVANT initSeed (qui crée `initialized`).
import { dbGet, dbPut } from './db.js';

export let JOIN_DATE = null;

const localKey = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

export async function initJoinDate() {
  let v = (await dbGet('meta', 'joinDate'))?.value;
  if (!v) {
    const existing = !!(await dbGet('meta', 'initialized'))?.value;
    v = existing ? '2026-09-01' : localKey(new Date());
    await dbPut('meta', { key: 'joinDate', value: v });
  }
  JOIN_DATE = v;
  return v;
}
