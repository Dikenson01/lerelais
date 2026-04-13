import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';

dotenv.config();

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function repair() {
  console.log('🔧 Starting DB Repair...');
  
  // 1. Get all conversations without contact_id
  const { data: convs, error: convError } = await supabase
    .from('conversations')
    .select('id, external_id, account_id')
    .is('contact_id', null);

  if (convError) {
    console.error('Error fetching convs:', convError);
    return;
  }

  console.log(`🔍 Found ${convs.length} orphan conversations.`);

  let repairedCount = 0;
  for (const conv of convs) {
    if (conv.external_id.endsWith('@g.us')) continue;

    // Try to find the matching contact
    const { data: contact } = await supabase
      .from('contacts')
      .select('id')
      .eq('account_id', conv.account_id)
      .eq('external_id', conv.external_id)
      .single();

    if (contact) {
      const { error: updateError } = await supabase
        .from('conversations')
        .update({ contact_id: contact.id })
        .eq('id', conv.id);
      
      if (!updateError) {
        repairedCount++;
        console.log(`✅ Linked Conv ${conv.external_id} to Contact ${contact.id}`);
      }
    }
  }

  console.log(`🎉 Repair finished. ${repairedCount} conversations linked.`);
  process.exit(0);
}

repair();
