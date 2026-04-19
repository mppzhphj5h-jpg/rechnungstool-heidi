'use strict';

// Supabase-Client — wird von login.html und index.html genutzt
if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  console.error('auth.js: SUPABASE_URL oder SUPABASE_ANON_KEY fehlt in config.js');
}
const _sb = (SUPABASE_URL && SUPABASE_ANON_KEY)
  ? supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
  : null;

const AuthClient = {
  supabase: _sb,

  async getSession() {
    if (!_sb) return null;
    const { data: { session } } = await _sb.auth.getSession();
    return session;
  },

  async signIn(email, password) {
    if (!_sb) throw new Error('Supabase nicht konfiguriert');
    return _sb.auth.signInWithPassword({ email, password });
  },

  async signUp(email, password) {
    if (!_sb) throw new Error('Supabase nicht konfiguriert');
    return _sb.auth.signUp({ email, password });
  },

  async signOut() {
    if (_sb) await _sb.auth.signOut();
    window.location.replace('login.html');
  },

  async resetPassword(email) {
    if (!_sb) throw new Error('Supabase nicht konfiguriert');
    return _sb.auth.resetPasswordForEmail(email, {
      redirectTo: window.location.origin + '/login.html'
    });
  },

  // Schützt eine Seite: leitet zu login.html weiter wenn keine Session
  async requireAuth() {
    const session = await this.getSession();
    if (!session) {
      window.location.replace('login.html');
      return null;
    }
    return session;
  }
};
