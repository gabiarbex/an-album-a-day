// Public Supabase browser configuration.
// The publishable key is intentionally client-visible; Row Level Security protects user data.
// Google OAuth is the public sign-in method. Email stays off until public SMTP is configured.
window.ALBUM_AUTH_CONFIG = {
  enabled: true,
  url: 'https://dlgzfcrwxrpqublvyxzn.supabase.co',
  publishableKey: 'sb_publishable_-dEbkKjcLp6JJVWQoWdO4g_2gp7-2yk',
  googleEnabled: true,
  emailEnabled: false,
  redirectTo: 'https://gabiarbex.github.io/an-album-a-day/'
};
