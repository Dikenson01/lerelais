import { IgApiClient } from 'instagram-private-api';
import logger from '../utils/logger.js';
import supabase from '../config/supabase.js';

export async function connectToInstagram(accountId, username, password, onMessage, onEvents) {
  const ig = new IgApiClient();
  ig.state.generateDevice(username);
  
  try {
    logger.info(`Authenticating Instagram for ${username}...`);
    const auth = await ig.account.login(username, password);
    logger.info(`Instagram connected for ${username}`);
    
    await supabase.from('accounts').update({ 
      status: 'connected',
      account_name: username
    }).eq('id', accountId);

    if (onEvents?.onConnected) onEvents.onConnected();

    // Polling for new messages (Direct Threads)
    let lastThreadCursor = null;
    
    const pollMessages = async () => {
      try {
        const inbox = ig.feed.directInbox();
        const threads = await inbox.items();
        
        for (const thread of threads) {
          const lastMsg = thread.items[0];
          if (!lastMsg || lastMsg.user_id === ig.state.cookieUserId) continue;

          // Check if we already have this message (using its item_id as external ref)
          const { data: existing } = await supabase
            .from('messages')
            .select('id')
            .eq('metadata->item_id', lastMsg.item_id)
            .single();

          if (!existing) {
            const sender = thread.users[0];
            const content = lastMsg.text || '[Media/Other]';

            // 1. Sync Contact
            const { data: contact } = await supabase
              .from('contacts')
              .upsert({
                account_id: accountId,
                external_id: thread.thread_id,
                display_name: sender.full_name || sender.username,
                avatar_url: sender.profile_pic_url,
                metadata: { source: 'instagram', username: sender.username }
              }, { onConflict: 'account_id, external_id' })
              .select().single();

            // 2. Sync Conversation
            const { data: conv } = await supabase
              .from('conversations')
              .upsert({
                account_id: accountId,
                contact_id: contact?.id,
                external_id: thread.thread_id,
                platform: 'instagram',
                title: sender.full_name || sender.username,
                last_message_preview: content,
                updated_at: new Date()
              }, { onConflict: 'account_id, external_id' })
              .select().single();

            if (!conv) continue;

            // 3. Save Message
            await supabase.from('messages').upsert({
              conversation_id: conv.id,
              account_id: accountId,
              remote_id: lastMsg.item_id,
              sender_id: sender.username,
              content: content,
              is_from_me: false,
              timestamp: new Date(lastMsg.timestamp / 1000),
              metadata: { item_id: lastMsg.item_id }
            }, { onConflict: 'remote_id' });

            if (onMessage) {
              onMessage('instagram', sender.username, content);
            }
          }
        }
      } catch (err) {
        logger.error('Instagram polling error:', err.message);
      }
    };

    // Poll every 15 seconds
    const pollInterval = setInterval(pollMessages, 15000);
    
    return {
      sendMessage: async (threadId, content) => {
        const thread = ig.entity.directThread(threadId);
        return await thread.broadcastText(typeof content === 'string' ? content : content.text);
      },
      logout: () => clearInterval(pollInterval)
    };

  } catch (err) {
    logger.error('Instagram Login Failed:', err.message);
    throw err;
  }
}
