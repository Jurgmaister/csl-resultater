# CSL Resultater

Resultatprogram for Club Scandinavia League. Arrangørene setter opp ligaen, importerer resultatfiler
(CSV fra iRaceControl eller iRacing, JSON fra iRacing) og eksporterer resultater og standings til
PDF, PNG (Discord) og Excel/CSV i CSL-designet. Alle kan se standings og resultater uten å logge inn.

Nettsiden kjører på GitHub Pages. Data og innlogging ligger i Supabase.

## Oppsett (én gang)

### 1. Supabase
1. Lag et prosjekt på supabase.com.
2. Åpne **SQL Editor → New query**, lim inn hele `supabase/schema.sql`, bytt ut `DIN-EPOST@eksempel.no`
   nederst med din egen e-post, og trykk **Run**.
3. **Authentication → URL Configuration**:
   - *Site URL*: `https://jurgmaister.github.io/csl-resultater/`
   - *Redirect URLs*: legg til den samme adressen.
4. **Settings → API**: kopier *Project URL* og *publishable key* (eller anon public key) inn i `js/config.js`.

### 2. GitHub Pages
**Settings → Pages → Build and deployment**: *Deploy from a branch*, branch `main`, mappe `/ (root)`.
Siden blir tilgjengelig på `https://jurgmaister.github.io/csl-resultater/`.

## Arrangører og innlogging
Arrangører logger inn med e-post og passord. Første gang trykker de «Ny arrangør? Lag passord».
Kontoen gir redigeringstilgang først når e-posten er lagt til under **Oppsett → Arrangører**
(den første arrangøren legges inn nederst i `supabase/schema.sql`).

I Supabase: **Authentication → Sign In / Providers → Email** – slå av *Confirm email*, så kan nye
arrangører lage passord uten å vente på e-post. «Glemt passord?» sender fortsatt en e-post, og
Supabase sin innebygde e-post tillater bare noen få slike i timen.

## Filer
| Fil | Innhold |
|---|---|
| `index.html` | Siden, stil og oppbygning |
| `js/core.js` | Lesing av CSV/JSON, poeng, Division 2 og standings |
| `js/export.js` | PDF, PNG, Excel og CSV i CSL-design |
| `js/data.js` | Lagring i Supabase |
| `js/app.js` | Brukergrensesnittet |
| `js/config.js` | Supabase-adresse og offentlig nøkkel |
| `supabase/schema.sql` | Tabeller og tilgangsregler |
