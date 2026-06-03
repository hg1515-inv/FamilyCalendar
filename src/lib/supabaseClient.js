import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

let supabase = null;

if (!supabaseUrl || !supabaseAnonKey) {
  console.warn('Supabase credentials missing. Check your .env setup. Database features will not work.');
  
  // Create a chainable mock that resolves to empty data
  const mockChain = {
    select: () => mockChain,
    insert: () => mockChain,
    update: () => mockChain,
    delete: () => mockChain,
    order: () => mockChain,
    eq: () => mockChain,
    then: (onFulfilled, onRejected) => {
      return Promise.resolve({ data: [], error: null }).then(onFulfilled, onRejected);
    },
    catch: (onRejected) => {
      return Promise.resolve({ data: [], error: null }).catch(onRejected);
    },
  };
  
  supabase = {
    from: () => mockChain
  };
} else {
  supabase = createClient(supabaseUrl, supabaseAnonKey);
}

export { supabase };
