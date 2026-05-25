import { ChatStore } from "./chatStore.js";
import { SupabaseChatStore } from "./supabaseChatStore.js";

export async function createChatStore(storagePath) {
  if (process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY) {
    const store = new SupabaseChatStore({
      url: process.env.SUPABASE_URL,
      serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY,
    });
    await store.init();
    console.log("Persistencia activa: Supabase");
    return store;
  }

  console.log(`Persistencia activa: archivo local ${storagePath}`);
  return new ChatStore(storagePath);
}
