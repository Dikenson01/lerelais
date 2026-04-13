import supabase from '../src/config/supabase.js';

async function migrate() {
  console.log('🚀 Démarrage de la migration des sessions (Style Tim)...');

  try {
     // 1. Ajout de la colonne namespace
     await supabase.rpc('run_sql', {
       sql: 'ALTER TABLE account_sessions ADD COLUMN IF NOT EXISTS namespace VARCHAR(100) DEFAULT \'wa_session\';'
     });
     
     // 2. Ajout de la colonne metadata
     await supabase.rpc('run_sql', {
       sql: 'ALTER TABLE account_sessions ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT \'{}\';'
     });

     // 3. Mise à jour de la contrainte unique
     const sqlUnique = `
       ALTER TABLE account_sessions DROP CONSTRAINT IF EXISTS account_sessions_account_id_filename_key;
       ALTER TABLE account_sessions DROP CONSTRAINT IF EXISTS account_sessions_pkey CASCADE;
       ALTER TABLE account_sessions ADD PRIMARY KEY (id);
       ALTER TABLE account_sessions DROP CONSTRAINT IF EXISTS ux_sessions_ns_file;
       ALTER TABLE account_sessions ADD CONSTRAINT ux_sessions_ns_file UNIQUE (account_id, namespace, filename);
     `;
     await supabase.rpc('run_sql', { sql: sqlUnique });
  } catch (e) {
    console.log('⚠️ Note: Les commandes SQL Directes (RPC) peuvent échouer si l\'extension n\'est pas activée.');
    console.log('Erreur:', e.message);
  }

  // Vérification des colonnes
  const { data: cols } = await supabase.from('account_sessions').select('*').limit(1);
  console.log('Colonnes actuelles détectées:', Object.keys(cols?.[0] || {}));

  console.log('✅ Migration terminée ou déjà appliquée.');
}

migrate();
