# Provisionsabrechnung

PWA für Provisionsabrechnungen – Brenztal-Immobilien GmbH.

---

## Authentifizierung einrichten

Die App nutzt [Supabase Auth](https://supabase.com) für sichere E-Mail-/Passwort-Anmeldung.  
Der Supabase **Anon-Key** ist bewusst als Client-Schlüssel konzipiert (wie Firebase's `apiKey`) und darf im Code stehen – die eigentliche Sicherheit kommt aus Supabase's Row Level Security.

### 1. Supabase-Projekt anlegen

1. Konto erstellen auf [supabase.com](https://supabase.com) (kostenloser Free-Tier reicht)
2. **New Project** → Name wählen, Passwort für die Datenbank setzen, Region wählen
3. Warten bis das Projekt bereit ist (~1 Minute)

### 2. API-Zugangsdaten kopieren

Im Supabase-Dashboard:  
**Project Settings → API**

Folgende Werte notieren:
| Wert | Wo zu finden |
|------|-------------|
| `SUPABASE_URL` | „Project URL", z.B. `https://xyzabcde.supabase.co` |
| `SUPABASE_ANON_KEY` | „anon / public" unter „Project API keys" |

### 3. config.js ausfüllen

Datei `config.js` im Projektverzeichnis öffnen und die Platzhalter ersetzen:

```js
const SUPABASE_URL  = 'https://DEINE-PROJECT-ID.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...';
```

### 4. E-Mail-Bestätigung konfigurieren (optional)

Standardmäßig verlangt Supabase eine E-Mail-Bestätigung nach der Registrierung.  
Zum Deaktivieren (z.B. für interne Nutzung):  
**Authentication → Providers → Email → „Confirm email" deaktivieren**

### 5. Redirect-URLs eintragen

Damit der „Passwort vergessen"-Link funktioniert:  
**Authentication → URL Configuration**

| Feld | Wert |
|------|------|
| Site URL | `https://DEIN-GITHUB-USER.github.io/rechnungstool-heidi/` |
| Redirect URLs | `https://DEIN-GITHUB-USER.github.io/rechnungstool-heidi/login.html` |

Für lokale Entwicklung zusätzlich eintragen:
- `http://localhost:8080/login.html`
- `http://127.0.0.1:8080/login.html`

### 6. Lokal starten

Da die App reines HTML/JS ist, genügt ein einfacher HTTP-Server:

```bash
# Python (überall verfügbar)
python3 -m http.server 8080

# oder Node.js
npx serve .
```

Dann im Browser öffnen: `http://localhost:8080`

### 7. Deployment via GitHub Pages

Die App wird automatisch über GitHub Pages bereitgestellt sobald Änderungen auf `main` gepusht werden.

**Wichtig:** `config.js` muss mit den echten Werten **committed** sein, da GitHub Pages keine serverseitigen Umgebungsvariablen unterstützt. Der Anon-Key ist als öffentlicher Schlüssel konzipiert – das ist sicher.

```bash
git add config.js
git commit -m "Supabase-Konfiguration hinterlegen"
git push
```

---

## Geänderte Dateien (Auth-Feature)

| Datei | Änderung |
|-------|----------|
| `config.js` | Neu – Supabase URL und Anon-Key |
| `auth.js` | Neu – Supabase-Client, Session-Check, Logout |
| `login.html` | Neu – Anmelden / Registrieren / Passwort-Reset |
| `index.html` | Auth-Guard (leitet zu login.html weiter), Logout-Button |
| `app.js` | Logout-Event-Handler |

---

## Sicherheitshinweise

- Passwörter werden **niemals** im Klartext gespeichert (Supabase nutzt bcrypt intern)
- Sessions laufen als JWTs mit Ablaufdatum
- Der `SUPABASE_ANON_KEY` ist kein Secret – er erlaubt nur Operationen, die Row Level Security zulässt
- Den **Service Role Key** aus dem Dashboard niemals in Client-Code einfügen
